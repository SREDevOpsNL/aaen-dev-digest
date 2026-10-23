#!/usr/bin/env bash
#
# DevDigest hermetic e2e — run the browser flows against a fully isolated,
# freshly-seeded stack on ALTERNATE ports, so it never touches your dev DB and
# can run alongside a dev stack that's already up.
#
#   ./scripts/e2e.sh
#   E2E_PG_PORT=5440 E2E_API_PORT=3201 E2E_WEB_PORT=3200 ./scripts/e2e.sh
#
# Mirrors what .github/workflows/e2e-web.yml does, but with an ephemeral
# Postgres (no persistent volume → empty every run, so the seeded demo repo
# acme/payments-api is the ONLY repo and the home redirect lands on it).
#
# Exits with the e2e run's status. On success, failure, or Ctrl-C it tears down
# the API/web child processes AND removes the isolated Postgres container.
#
# NOTE: this is a LOCAL convenience. CI brings up its own stack and calls the
# pure runner (`cd e2e && npm test`) directly — this script is not used in CI.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# --serve: start a HW2 experiment stack instead of running the flows. It gets a
# fresh stack id, a database and container named after it, Docker labels the
# experiment runner checks, an empty per-stack clone directory, and the server
# in experiment mode (DEVDIGEST_EXPERIMENT_* must be set by the operator; see
# docs/plans/HW2-experiment-operator-guide.md). It blocks until Ctrl-C, then
# tears down like a normal run. No model is called by this script.
SERVE=0
for arg in "$@"; do
  case "$arg" in
    --serve) SERVE=1 ;;
    *) echo "unknown argument: $arg (only --serve is supported)"; exit 2 ;;
  esac
done

# --- config (all overridable; defaults dodge the dev stack on 5432/3000/3001) ---
PG_CONTAINER="${E2E_PG_CONTAINER:-devdigest-e2e-postgres}"
PG_PORT="${E2E_PG_PORT:-5433}"
PG_IMAGE="${E2E_PG_IMAGE:-pgvector/pgvector:pg16}"
# A disposable database name (server/src/db/disposable.ts); the dev DB is `devdigest`.
PG_DB="${E2E_PG_DB:-devdigest_e2e}"
PG_USER="${E2E_PG_USER:-devdigest}"
PG_PASS="${E2E_PG_PASS:-devdigest}"
API_PORT="${E2E_API_PORT:-3101}"
WEB_PORT="${E2E_WEB_PORT:-3100}"
PG_LABELS=(--label devdigest.disposable=true)
# Extra `next dev` arguments; --serve binds the UI to loopback only.
WEB_HOST_ARGS=()

if [ "$SERVE" -eq 1 ]; then
  NONCE="$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
  STACK_ID="hw2f-${NONCE}"
  PG_CONTAINER="devdigest-hw2f-${NONCE}"
  PG_DB="devdigest_hw2f_${NONCE}"
  PG_PORT="${E2E_PG_PORT:-5450}"
  API_PORT="${E2E_API_PORT:-3251}"
  WEB_PORT="${E2E_WEB_PORT:-3250}"
  PG_LABELS+=(--label "devdigest.stack-id=${STACK_ID}" --label "devdigest.database=${PG_DB}")
  # Loopback only, like Postgres and the experiment-mode API (config.apiHost):
  # the UI's server side calls the API, so an exposed UI would expose it too.
  WEB_HOST_ARGS=(-H 127.0.0.1)
  for var in DEVDIGEST_EXPERIMENT_PROVIDER DEVDIGEST_EXPERIMENT_MODEL DEVDIGEST_EXPERIMENT_MAX_OUTPUT_TOKENS \
             DEVDIGEST_EXPERIMENT_PRICE_INPUT DEVDIGEST_EXPERIMENT_PRICE_OUTPUT; do
    [ -n "${!var:-}" ] || { echo "--serve needs $var (see docs/plans/HW2-experiment-operator-guide.md)"; exit 2; }
  done
  export DEVDIGEST_EXPERIMENT_STACK_ID="$STACK_ID"
  # Empty per-stack clone directory: a clone would replace the frozen fixture patches.
  EXPERIMENT_DIR="${HOME}/.devdigest/hw2-experiments/${STACK_ID}"
  mkdir -p "${EXPERIMENT_DIR}/clones"
  chmod 700 "${HOME}/.devdigest/hw2-experiments" "${EXPERIMENT_DIR}"
  export DEVDIGEST_CLONE_DIR="${EXPERIMENT_DIR}/clones"
fi

# Exported BEFORE any tsx/next spawn. dotenv (used by migrate/seed/config) does
# not override already-set env, so these win over server/.env's :5432 / :3001
# without touching the file. WEB_PORT must be exported too: the API derives its
# CORS allow-origin (config.webOrigin) from it. 127.0.0.1 (not localhost) avoids
# an IPv6 ::1 vs published-IPv4 mismatch against the container.
export DATABASE_URL="postgres://${PG_USER}:${PG_PASS}@127.0.0.1:${PG_PORT}/${PG_DB}"
export API_PORT WEB_PORT
export NEXT_PUBLIC_API_BASE="http://localhost:${API_PORT}"
export E2E_BASE_URL="http://localhost:${WEB_PORT}"

log()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }

# --- prerequisites -----------------------------------------------------------
command -v docker >/dev/null || { echo "docker not found"; exit 1; }
command -v pnpm   >/dev/null || { echo "pnpm not found (npm i -g pnpm)"; exit 1; }
command -v agent-browser >/dev/null || \
  warn "agent-browser not found — install once: npm i -g agent-browser && agent-browser install"
[ "$SERVE" -eq 0 ] || command -v ss >/dev/null || { echo "ss not found (iproute2): --serve checks its listeners with it"; exit 1; }

# Every listener on these ports must be 127.0.0.1 only. Reads the kernel's
# listening sockets, not the URLs the clients use; returns 1 otherwise.
assert_loopback_listeners() {
  local port addrs addr bad=0
  for port in "$@"; do
    addrs="$(ss -Hltn "sport = :$port" | awk '{print $4}')"
    [ -n "$addrs" ] || { echo "no listener on :$port"; bad=1; continue; }
    while read -r addr; do
      [ "$addr" = "127.0.0.1:$port" ] || { echo "listener $addr is not loopback-only"; bad=1; }
    done <<<"$addrs"
  done
  return "$bad"
}

# --- teardown trap (installed before we start anything) ----------------------
SERVER_PID=""
WEB_PID=""
# Recursively kill a process and all its descendants. `pnpm exec tsx` / `next dev`
# spawn the real listener as a GRANDCHILD, so a plain `kill $PID` + `pkill -P`
# leaves it orphaned (port stays bound). Walk the tree leaves-first instead.
kill_tree() {
  local pid="$1"
  [ -n "$pid" ] || return 0
  local kid
  for kid in $(pgrep -P "$pid" 2>/dev/null || true); do kill_tree "$kid"; done
  kill "$pid" 2>/dev/null || true
}
cleanup() {
  local code=$?
  log "tearing down hermetic e2e stack"
  kill_tree "$WEB_PID"
  kill_tree "$SERVER_PID"
  # Backstop: reap whatever still holds the ISOLATED ports (never the dev stack's
  # 3000/3001 — only the alt ports this script started).
  for port in "$WEB_PORT" "$API_PORT"; do
    local pids
    pids="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null || true)"
    [ -n "$pids" ] && kill $pids 2>/dev/null || true
  done
  docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
  exit "$code"
}
trap cleanup EXIT INT TERM

# --- fresh isolated Postgres (ephemeral: --rm, no named volume) --------------
log "starting isolated Postgres '$PG_CONTAINER' on :$PG_PORT (ephemeral)"
docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
docker run -d --rm --name "$PG_CONTAINER" "${PG_LABELS[@]}" \
  -e POSTGRES_USER="$PG_USER" \
  -e POSTGRES_PASSWORD="$PG_PASS" \
  -e POSTGRES_DB="$PG_DB" \
  -p "127.0.0.1:${PG_PORT}:5432" \
  --health-cmd="pg_isready -U $PG_USER -d $PG_DB" \
  --health-interval=5s --health-timeout=5s --health-retries=10 \
  "$PG_IMAGE" >/dev/null

log "waiting for Postgres to be healthy"
status="starting"
for _ in $(seq 1 60); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$PG_CONTAINER" 2>/dev/null || echo "starting")"
  [ "$status" = "healthy" ] && break
  sleep 1
done
[ "$status" = "healthy" ] || { echo "isolated Postgres did not become healthy in time"; exit 1; }
log "Postgres healthy"

# --- install deps (only if missing) ------------------------------------------
install_if_needed() {
  if [ ! -d "$1/node_modules" ]; then
    log "installing deps in $1"
    (cd "$1" && pnpm install)
  fi
}
install_if_needed server
install_if_needed client
# reviewer-core's RAW source is imported by the API at runtime (tsconfig alias);
# without its deps the API crashes at boot with ERR_MODULE_NOT_FOUND. It uses npm.
[ -d reviewer-core/node_modules ] || { log "installing deps in reviewer-core"; (cd reviewer-core && npm ci); }

# --- migrate + seed the ISOLATED db ------------------------------------------
# Hard guard: never let migrate/seed run against anything but the isolated port.
case "$DATABASE_URL" in
  *":${PG_PORT}/"*) : ;;
  *) echo "refusing: DATABASE_URL is not on :$PG_PORT ($DATABASE_URL)"; exit 1 ;;
esac
log "applying migrations (isolated db)"
(cd server && pnpm db:migrate)
log "seeding demo data + HW2 experiment fixtures (isolated db)"
# The fixtures (PRs #501/#502, flow 13) are opt-in, and the seed refuses unless
# the database is demonstrably disposable.
# --serve also seeds the labelled synthetic convention candidates for the final
# Conventions walkthrough; the flow run does not (flow 09 expects no candidates).
SYNTHETIC=0
[ "$SERVE" -eq 1 ] && SYNTHETIC=1
(cd server && DEVDIGEST_SEED_EXPERIMENT_FIXTURES=1 DEVDIGEST_SEED_SYNTHETIC_CONVENTIONS="$SYNTHETIC" pnpm db:seed)

# --- API on :$API_PORT -------------------------------------------------------
# tsx directly (not `pnpm start`, which needs a build; not `tsx watch`, to avoid
# a mid-suite watcher restart).
log "starting API on :$API_PORT"
(cd server && pnpm exec tsx src/server.ts) &
SERVER_PID=$!
log "waiting for API /health"
api_up=0
for _ in $(seq 1 60); do
  curl -fsS "http://localhost:${API_PORT}/health" >/dev/null 2>&1 && { api_up=1; break; }
  kill -0 "$SERVER_PID" 2>/dev/null || { echo "API process exited before becoming healthy"; exit 1; }
  sleep 1
done
[ "$api_up" -eq 1 ] || { echo "API never became healthy on :$API_PORT"; exit 1; }
log "API healthy"

# --- web on :$WEB_PORT (next dev → reads NEXT_PUBLIC_API_BASE from env) -------
log "starting web on :$WEB_PORT"
(cd client && pnpm exec next dev -p "$WEB_PORT" "${WEB_HOST_ARGS[@]}") &
WEB_PID=$!
log "waiting for web :$WEB_PORT"
web_up=0
for _ in $(seq 1 60); do
  curl -fsS "http://localhost:${WEB_PORT}" >/dev/null 2>&1 && { web_up=1; break; }
  kill -0 "$WEB_PID" 2>/dev/null || { echo "web process exited before becoming reachable"; exit 1; }
  sleep 1
done
[ "$web_up" -eq 1 ] || { echo "web never became reachable on :$WEB_PORT"; exit 1; }
log "web up"

# --- --serve: print the identity the runner checks, then wait ---------------
if [ "$SERVE" -eq 1 ]; then
  assert_loopback_listeners "$API_PORT" "$WEB_PORT" || { echo "refusing to serve: the stack is reachable beyond loopback"; exit 1; }
  log "listeners on :$API_PORT and :$WEB_PORT are loopback-only"
  log "HW2 experiment stack is up (Ctrl-C tears it down)"
  cat <<IDENTITY
  stack id   ${STACK_ID}
  database   ${PG_DB}  (127.0.0.1:${PG_PORT})
  container  ${PG_CONTAINER}
  api        http://127.0.0.1:${API_PORT}
  web        http://localhost:${WEB_PORT}
  clones     ${DEVDIGEST_CLONE_DIR}
  ledger     ${EXPERIMENT_DIR}
  key file   ${HOME}/.devdigest/hw2-experiments/secrets.json
IDENTITY
  wait "$SERVER_PID"
  exit $?
fi

# --- run the flows; propagate the exit code through the trap -----------------
log "running e2e flows against $E2E_BASE_URL"
set +e
(cd e2e && npm test)
E2E_CODE=$?
set -e
exit "$E2E_CODE"
