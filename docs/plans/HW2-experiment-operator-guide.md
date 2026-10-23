# HW2 controlled experiments — operator guide

How to run the Homework 2 skill experiments (criteria 17 and 18) on a disposable
stack, and what each gate authorizes. Plan: rev. 4.3. Nothing here may run
against the development database or demo PR #3.

| Gate | What it authorizes | Spend |
| --- | --- | --- |
| 1 | Implementation and unpaid checks (this tooling) | none |
| 2 | You create the **dedicated** OpenRouter key, set its spending limit (~USD 2) in the OpenRouter dashboard, and confirm it | none |
| 3 | Paid exploration on the disposable stack | ≤ USD 0.50 |
| 4 | Confirmatory runs, after the preregistration is committed | ≤ USD 1.00 |
| 5 | Acceptance walkthrough (reuses a Gate 4 trace for the token label) | none planned |

Each gate needs its own explicit authorization. The runner enforces the caps
(0.50 / 1.00 / 1.50 total) itself; the key limit is the outer control.

## Unpaid (Gate 1)

### 1. The dedicated key file (prepared at Gate 2)

An experiment stack reads **only** `~/.devdigest/hw2-experiments/secrets.json`
(mode 0600) and never falls back to `process.env`, so it cannot use the
everyday key in `~/.devdigest/secrets.json`.

```bash
mkdir -p ~/.devdigest/hw2-experiments && chmod 700 ~/.devdigest/hw2-experiments
printf '{ "OPENROUTER_API_KEY": "<dedicated key>" }\n' > ~/.devdigest/hw2-experiments/secrets.json
chmod 600 ~/.devdigest/hw2-experiments/secrets.json
```

### 2. Start a disposable stack

```bash
DEVDIGEST_EXPERIMENT_PROVIDER=<routing slug> \
DEVDIGEST_EXPERIMENT_MODEL=deepseek/deepseek-v4-flash \
DEVDIGEST_EXPERIMENT_MAX_OUTPUT_TOKENS=<cap> \
DEVDIGEST_EXPERIMENT_PRICE_INPUT=<USD per input token> \
DEVDIGEST_EXPERIMENT_PRICE_OUTPUT=<USD per output token> \
scripts/e2e.sh --serve
```

Optional: `DEVDIGEST_EXPERIMENT_PROVIDER_NAME` (the serving provider's display
name, frozen after exploration), `DEVDIGEST_EXPERIMENT_PRICE_REQUEST`,
`DEVDIGEST_EXPERIMENT_GENERATION_LOOKUP=0|1` (default 1). A partial set fails
the server's startup.

`--serve` prints the stack id, database (`devdigest_hw2f_<nonce>`), container,
API URL, clone directory (empty, per stack) and ledger directory
(`~/.devdigest/hw2-experiments/<stack-id>/`). It seeds the fixture PRs #501 and
#502 (with fresh cached intents) and the labelled synthetic convention
candidates. Ctrl-C tears everything down.

The stack listens on loopback only:
- Postgres is published on `127.0.0.1`.
- The experiment-mode API binds `127.0.0.1` (not configurable).
- The UI starts with `next dev -H 127.0.0.1`.

Before printing that it is up, `--serve` reads the kernel's listening sockets
with `ss`, not the URLs. It tears the stack down if any listener on the API or
web port is not `127.0.0.1`. Whether a browser on the Windows host still
reaches it through WSL's localhost forwarding is not yet verified: check it on
the next stack before the row 19/20 screenshots.

### 3. Unpaid runner commands

Run from `server/`; `$ID` is the printed stack id.

```bash
pnpm exec tsx src/experiments/hw2/cli.ts check --api http://127.0.0.1:3251 --stack $ID --database devdigest_hw2f_${ID#hw2f-} --container devdigest-hw2f-${ID#hw2f-}
```

`check` verifies the stack identity and fails closed on any mismatch: stack id,
disposable database name, a single repository, fixtures present, no PR #3, no
clone of the fixture repo, container labels, a loopback non-development API
port, and the dedicated key file. It also confirms both fixture intents are
fresh and prints the frozen diff hashes.

```bash
if [[ "$ID" =~ ^hw2f-[a-z0-9]{4,32}$ ]] && docker inspect "$CONTAINER" >/dev/null 2>&1; then echo "stack $ID: container $CONTAINER is running"; else echo "FAILED: $ID is not a running hw2f stack (check ID)"; false; fi
```

```bash
pnpm exec tsx src/experiments/hw2/cli.ts check "${STACK[@]}"
```

`check` verifies the stack identity and fails closed on any mismatch:
- the stack id and the disposable database name;
- a single repository, the fixtures present, and no PR #3;
- no clone of the fixture repo;
- the container labels;
- a loopback, non-development API port (the bind itself is checked by
  `--serve`, above);
- that the stack reads the dedicated key file. It checks the file's path only.
  Whether a key is present is the `openrouter_key_configured` flag of
  `GET /experiments/identity`, and `run` refuses without one.

It also confirms both fixture intents are fresh and prints the frozen diff
hashes.

```bash
pnpm exec tsx src/experiments/hw2/cli.ts endpoints --api "$API"
```

Set the schedule seed, the expected-finding rules file and the per-slot
reservation, then validate them:

```bash
SEED=20261020                                          # EXAMPLE: the seed recorded in the preregistration
RULES="$HOME/.devdigest/hw2-experiments/rules.json"    # EXAMPLE path: the rules file written into the preregistration
RESERVATION=0.04                                       # EXAMPLE: USD per confirmatory slot; 20 × RESERVATION must be ≤ 1.00
MANIFEST="$HOME/.devdigest/hw2-experiments/$ID/manifest.json"
```

```bash
python3 -I - "$SEED" "$RULES" "$RESERVATION" <<'EOF'
import json, re, sys
seed, rules, reservation = sys.argv[1:4]
problems = []
if not re.fullmatch(r"\d+", seed):
    problems.append(f"SEED={seed!r} is not a non-negative integer")
try:
    usd = float(reservation)
    if not (usd > 0 and 20 * usd <= 1.00 + 1e-9):
        problems.append(f"RESERVATION={reservation} must be > 0 and 20 x RESERVATION <= USD 1.00")
except ValueError:
    problems.append(f"RESERVATION={reservation!r} is not a number")
try:
    data = json.load(open(rules))
    if not (isinstance(data, dict) and data and all(isinstance(r, dict) and r.get("anchors") and r.get("keywords") for r in data.values())):
        problems.append(f"{rules} is not an object of {{anchors, keywords}} rules per experiment")
except (OSError, ValueError) as err:
    problems.append(f"RULES: {err}")
if problems:
    sys.exit("FAILED:\n" + "\n".join(problems))
print("seed, rules and reservation are valid")
EOF
```

```bash
pnpm exec tsx src/experiments/hw2/cli.ts plan --seed "$SEED"
```

```bash
pnpm exec tsx src/experiments/hw2/cli.ts manifest "${STACK[@]}" --seed "$SEED" --rules "$RULES" --reservation "$RESERVATION" --out "$MANIFEST"
```

- `endpoints` lists the model's live provider endpoints: prices, limits, tags.
  It is OpenRouter metadata, not a generation, but needs the key file.
- `plan` prints the 20-slot balanced, seeded schedule.
- `manifest` builds the canonical manifest and its fingerprint. It refuses
  unless 20 × the per-slot reservation fits USD 1.00. The manifest freezes:
  - the **implementation fingerprint**: committed blob ids of `server/src`,
    `reviewer-core/src`, their package and lock files, and `scripts/e2e.sh`.
    Unlike `HEAD`, it does not change when the preregistration is committed,
    and it refuses uncommitted implementation changes;
  - **each experiment's non-Skill fingerprint**, from the free
    `POST /experiments/preview`. The preview performs a slot's checks and
    preflight without a model request, a run or a trace.

### Authorizing a paid phase (server-side capability)

The server refuses every slot unless the operator's capability authorizes it. A
direct API call therefore cannot bypass the gate. After a gate is explicitly
authorized:

```bash
pnpm exec tsx src/experiments/hw2/cli.ts authorize --phase exploration --authorized-gate 3 --confirm-spend --budget 0.15 --hours 12 "${STACK[@]}"
```

- `--budget 0.15` is the capability budget of the approved
  [Gate 3 plan](HW2-gate3-plan.md#schedule-and-costs). USD 0.50 is the formal
  Gate 3 ceiling that `authorize` and the server enforce, not a budget to
  authorize. A different budget needs a new approval.
- This writes `~/.devdigest/hw2-experiments/<stack-id>/capability.json`
  (0600): the stack id, phase, gate, budget, expiry and the **sha256** of a
  random token. The token itself goes to `capability.token` (0600), which
  `run` sends as `x-hw2-capability`.
- On every slot the server rereads the capability. It refuses (403):
  - a missing, expired or wrong-stack capability;
  - a phase or gate mismatch;
  - a wrong token, compared timing-safe.
- The server also enforces its own budget, recomputed from the stored
  experiment runs: known cost, zero for refusals, the full reservation for
  anything unknown. It caps each phase at min(phase cap, capability budget)
  and the total at USD 1.50, and returns 409 when a slot would exceed either.
- Slot ids carry their phase (`x-` exploration, `c-` confirmatory).
- Deleting `capability.json` revokes the authorization.

## Paid

Each paid phase runs on its own disposable stack:

| Stack | Phase | Rule |
| --- | --- | --- |
| X | Gate 3, exploration | Started per §2 with provisional or candidate settings. Its evidence is exported before it stops. |
| E | Gate 4, confirmatory | A **new** stack with the final settings. The manifest, the preregistration commit and the confirmatory run all happen on E, and E is **not restarted** in between. |

Why one E:
- The manifest freezes `stack.database`.
- Every `scripts/e2e.sh --serve` start creates a new database, `devdigest_hw2f_<nonce>`.
- A manifest generated on any other stack, or before a restart, never matches the one `run` recomputes, so `run` refuses before any request.

`server/test/hw2-manifest-identity.test.ts` shows both halves of this:
- a different database identity changes the fingerprint;
- a preregistration-only commit on the same stack does not.

### Gate 3: exploration on stack X (≤ USD 0.50)

The schedule, the cost figures from real free previews, and the stop rules are
in the [Gate 3 plan](HW2-gate3-plan.md). The approved plan uses only part of the
USD 0.50 ceiling, and every command below uses these values:

| Value | Approved | Formal limit (unchanged) |
| --- | --- | --- |
| Capability budget (`authorize --budget`) | USD 0.15 | Gate 3 ceiling USD 0.50 |
| Per-slot reservation (`X_RESERVATION`) | USD 0.01 | — |
| Slots | 4 initial, 2 optional | — |
| Output cap (`DEVDIGEST_EXPERIMENT_MAX_OUTPUT_TOKENS`) | 16,000 tokens | endpoint maximum completion |
| Dedicated key limit | — | USD 2, never resets |

Changing any approved value needs a new approval before a paid slot.

1. **Start X** (§2) with `DEVDIGEST_EXPERIMENT_MAX_OUTPUT_TOKENS=16000` and
   the slug's live prices from the endpoint check below. Set
   `DEVDIGEST_EXPERIMENT_PROVIDER` to an **endpoint-specific** routing slug,
   `provider/variant[/region][/tier]` such as `deepinfra/fp8`, that you have
   confirmed from the provider's copy button on the model page.
   - A provider-wide selector such as `deepinfra` matches **every** endpoint
     of that provider, including ones added later. Gate 3 never uses one, and
     the checks below refuse it.
   - If the copy button gives no endpoint-specific slug, or a slug that does
     not match exactly one live endpoint, stop: that is a blocker that needs a
     decision, not a reason to fall back to a broader selector.

   In the runner terminal, set the §3 variables for X and run its checks. Then
   set the approved values:

```bash
X_RESERVATION=0.01; X_CAP=16000   # APPROVED Gate 3 plan values: USD reserved per slot, output cap in tokens
```

2. **Phase 0, free: the provider's endpoint.** The slug must be
   endpoint-specific and match exactly one live endpoint, which must advertise
   `structured_outputs` (the request
   requires every parameter it sends, see
   [One request](#one-request)) and be up. This reads OpenRouter's public
   model metadata; no key is sent.

```bash
SLUG=   # required: the endpoint-specific slug you confirmed from the copy button and started X with, e.g. deepinfra/fp8
```

```bash
python3 -I - "$SLUG" <<'EOF'
import json, sys, urllib.request
slug = sys.argv[1]
if not slug:
    sys.exit("FAILED: SLUG is not set; confirm the endpoint-specific slug from the model page's copy button")
if "/" not in slug:
    sys.exit(f"FAILED: {slug!r} is a provider-wide selector; Gate 3 needs a confirmed endpoint-specific slug. BLOCKER: request a decision")
request = urllib.request.Request("https://openrouter.ai/api/v1/models/deepseek/deepseek-v4-flash/endpoints", headers={"User-Agent": "devdigest-hw2-phase0"})
endpoints = json.load(urllib.request.urlopen(request, timeout=30))["data"]["endpoints"]
matching = [e for e in endpoints if e.get("tag") == slug]
problems = []
if len(matching) != 1:
    problems.append(f"{len(matching)} live endpoints match {slug}, not exactly 1. BLOCKER: request a decision")
for e in matching:
    if "structured_outputs" not in (e.get("supported_parameters") or []):
        problems.append(f"{e.get('tag')} does not advertise structured_outputs")
    if e.get("status") != 0:
        problems.append(f"{e.get('tag')} status is {e.get('status')}")
    print(f"{e.get('tag')}: max completion {e.get('max_completion_tokens')}, context {e.get('context_length')}, uptime 30m {e.get('uptime_last_30m')}")
if problems:
    sys.exit("FAILED:\n" + "\n".join(problems))
print(f"{slug}: endpoint ready")
EOF
```

   Then confirm that X runs the approved settings against that live endpoint:
   the slug, the model, the 16,000 cap (within the endpoint's maximum
   completion), the live prices, and a configured key.

```bash
python3 -I - "$API" "$SLUG" "$X_RESERVATION" "$X_CAP" <<'EOF'
import json, sys, urllib.request
api, slug, reservation, cap = sys.argv[1:5]
problems = []
if reservation != "0.01":
    problems.append(f"X_RESERVATION={reservation!r}: the approved Gate 3 plan reserves 0.01 per slot")
if cap != "16000":
    problems.append(f"X_CAP={cap!r}: the approved Gate 3 plan caps output at 16000 tokens")
try:
    identity = json.load(urllib.request.urlopen(f"{api}/experiments/identity", timeout=30))
except (OSError, ValueError) as err:
    sys.exit(f"FAILED: cannot read {api}/experiments/identity: {err}")
if "/" not in slug:
    problems.append(f"SLUG={slug!r} is not an endpoint-specific slug")
if identity.get("provider") != slug:
    problems.append(f"X routes to {identity.get('provider')!r}, not {slug!r}")
if identity.get("model") != "deepseek/deepseek-v4-flash":
    problems.append(f"X uses the model {identity.get('model')!r}")
if str(identity.get("max_output_tokens")) != cap:
    problems.append(f"X caps output at {identity.get('max_output_tokens')}, not {cap}")
if not identity.get("openrouter_key_configured"):
    problems.append("X has no OpenRouter key (start it after the dedicated key file exists)")
request = urllib.request.Request("https://openrouter.ai/api/v1/models/deepseek/deepseek-v4-flash/endpoints", headers={"User-Agent": "devdigest-hw2-phase0"})
endpoints = json.load(urllib.request.urlopen(request, timeout=30))["data"]["endpoints"]
matching = [e for e in endpoints if e.get("tag") == slug]
if len(matching) != 1:
    problems.append(f"{len(matching)} live endpoints match {slug}, not exactly 1")
prices = identity.get("prices") or {}
for e in matching:
    live = e.get("pricing") or {}
    for field, key in (("input", "prompt"), ("output", "completion")):
        if float(live.get(key) or "nan") != prices.get(field):
            problems.append(f"{e.get('tag')}: live {field} price {live.get(key)} differs from X's {prices.get(field)}")
    if int(cap) > (e.get("max_completion_tokens") or 0):
        problems.append(f"{e.get('tag')}: cap {cap} exceeds the maximum completion {e.get('max_completion_tokens')}")
if problems:
    sys.exit("FAILED:\n" + "\n".join(problems))
print(f"X {identity.get('stack_id', '')} matches the approved Gate 3 settings on {slug}: cap {cap}, prices {prices.get('input')} / {prices.get('output')} USD per token")
EOF
```

3. **Phase 0, free: condition-faithful previews.** The preview API builds the
   prompt from the reviewer's **current** links, and its `condition` is only a
   label. The runner's `preview` command therefore does the following, and
   returns nonzero on any mismatch:
   - links exactly what a slot of that condition links (the target skill, or
     none);
   - checks the links, and that the Skill fingerprint is the target skill's
     own (recomputed from its current body) or that of no Skills;
   - prints the input bound and the worst case;
   - always restores the original links.

   First prove that X holds no spending capability. The previews are free only
   while neither file exists:

```bash
CAPDIR="$HOME/.devdigest/hw2-experiments/$ID"; if [ ! -d "$CAPDIR" ] || [ ! -x "$CAPDIR" ]; then echo "FAILED: $CAPDIR is not a readable stack directory (check ID)"; false; elif [ -e "$CAPDIR/capability.json" ] || [ -L "$CAPDIR/capability.json" ] || [ -e "$CAPDIR/capability.token" ] || [ -L "$CAPDIR/capability.token" ]; then echo "FAILED: a spending capability exists for $ID before Phase 0; stop and investigate"; ls -l "$CAPDIR"/capability.*; false; else echo "no spending capability for $ID"; fi
```

   Each preview runs at the approved reservation and saves its result into a
   new directory, so an older preview can never be counted:

```bash
PV=$(mktemp -d "$HOME/.devdigest/hw2-experiments/$ID/previews.XXXXXX") && echo "previews: $PV" || { echo "FAILED: cannot create a preview directory for $ID"; false; }
```

```bash
pnpm exec tsx src/experiments/hw2/cli.ts preview "${STACK[@]}" --experiment 18 --condition with --reservation "$X_RESERVATION" > "$PV/18-with.json"; status=$?; cat "$PV/18-with.json"; [ "$status" -eq 0 ] || { echo "FAILED: preview 18 / with"; false; }
```

```bash
pnpm exec tsx src/experiments/hw2/cli.ts preview "${STACK[@]}" --experiment 18 --condition without --reservation "$X_RESERVATION" > "$PV/18-without.json"; status=$?; cat "$PV/18-without.json"; [ "$status" -eq 0 ] || { echo "FAILED: preview 18 / without"; false; }
```

```bash
pnpm exec tsx src/experiments/hw2/cli.ts preview "${STACK[@]}" --experiment 17 --condition with --reservation "$X_RESERVATION" > "$PV/17-with.json"; status=$?; cat "$PV/17-with.json"; [ "$status" -eq 0 ] || { echo "FAILED: preview 17 / with"; false; }
```

```bash
pnpm exec tsx src/experiments/hw2/cli.ts preview "${STACK[@]}" --experiment 17 --condition without --reservation "$X_RESERVATION" > "$PV/17-without.json"; status=$?; cat "$PV/17-without.json"; [ "$status" -eq 0 ] || { echo "FAILED: preview 17 / without"; false; }
```

   Then check the four previews together. `phase0-check` fails unless:
   - each preview is `ok`, at the approved reservation and output cap, for its
     own experiment and condition, with exactly its condition's links;
   - each Skill fingerprint equals the one recomputed from the stack's current
     target skill (`with`) or from no Skills (`without`);
   - within each experiment, the non-Skill fingerprint is the same for `with`
     and `without`;
   - the reservation covers 1.2 × the largest worst case.

   If it fails, stop: raising the reservation needs a new approval.

```bash
if [ "$X_RESERVATION" = 0.01 ] && [ "$X_CAP" = 16000 ]; then pnpm exec tsx src/experiments/hw2/cli.ts phase0-check "${STACK[@]}" --dir "$PV" --reservation "$X_RESERVATION" --cap "$X_CAP"; else echo "FAILED: X_RESERVATION=$X_RESERVATION and X_CAP=$X_CAP are not the approved 0.01 and 16000"; false; fi
```

4. **Authorize.** Only after Gate 3 is explicitly authorized, create the
   exploration capability with `--budget 0.15`
   ([Authorizing a paid phase](#authorizing-a-paid-phase-server-side-capability)).
5. **Run.** Before **every** slot, check the capability and the reservation:

```bash
python3 -I - "$HOME/.devdigest/hw2-experiments/$ID/capability.json" "$ID" "$X_RESERVATION" <<'EOF'
import datetime, json, sys
path, stack, reservation = sys.argv[1:4]
try:
    cap = json.load(open(path))
except (OSError, ValueError) as err:
    sys.exit(f"FAILED: no readable capability: {err}")
problems = []
if cap.get("stack_id") != stack:
    problems.append(f"capability is for {cap.get('stack_id')!r}, not {stack!r}")
if cap.get("phase") != "exploration" or cap.get("gate") != 3:
    problems.append(f"capability is for {cap.get('phase')} / Gate {cap.get('gate')}, not exploration / Gate 3")
if cap.get("budget_usd") != 0.15:
    problems.append(f"capability budget is {cap.get('budget_usd')}, not the approved 0.15")
try:
    if datetime.datetime.fromisoformat(cap["expires_at"].replace("Z", "+00:00")) <= datetime.datetime.now(datetime.timezone.utc):
        problems.append(f"capability expired at {cap['expires_at']}")
except (KeyError, ValueError) as err:
    problems.append(f"capability expiry is unreadable: {err}")
if reservation != "0.01":
    problems.append(f"X_RESERVATION={reservation!r}, not the approved 0.01")
if problems:
    sys.exit("FAILED:\n" + "\n".join(problems))
print(f"capability: exploration, Gate 3, budget $0.15, expires {cap['expires_at']}; reservation ${reservation}")
EOF
```

   Then run one slot per invocation, in this order, and judge each from the
   ledger and the trace, never from the exit code
   ([Gate 3 plan](HW2-gate3-plan.md#per-slot-checks)). Stop at the first
   operational stop.

   If a slot fails with a provider error:
   - read the sanitized `errorDetail` of its attempt. The runner's failure
     line prints its origin, provider, `error_type`, `provider_code`,
     `retry-after` and request id;
   - never send a request to diagnose it, and never retry the slot id;
   - remember that an endpoint `status` of 0 does not mean the provider has
     capacity.

```bash
pnpm exec tsx src/experiments/hw2/cli.ts run --phase exploration --authorized-gate 3 --confirm-spend "${STACK[@]}" --experiment 18 --condition with --count 1 --reservation "$X_RESERVATION"
```

```bash
pnpm exec tsx src/experiments/hw2/cli.ts run --phase exploration --authorized-gate 3 --confirm-spend "${STACK[@]}" --experiment 18 --condition without --count 1 --reservation "$X_RESERVATION"
```

```bash
pnpm exec tsx src/experiments/hw2/cli.ts run --phase exploration --authorized-gate 3 --confirm-spend "${STACK[@]}" --experiment 17 --condition with --count 1 --reservation "$X_RESERVATION"
```

```bash
pnpm exec tsx src/experiments/hw2/cli.ts run --phase exploration --authorized-gate 3 --confirm-spend "${STACK[@]}" --experiment 17 --condition without --count 1 --reservation "$X_RESERVATION"
```

   Only if the first four leave the output cap or provenance in doubt, the two
   optional slots (`x-18-with-2`, `x-17-with-2`; `run` picks the next free
   trial):

```bash
pnpm exec tsx src/experiments/hw2/cli.ts run --phase exploration --authorized-gate 3 --confirm-spend "${STACK[@]}" --experiment 18 --condition with --count 1 --reservation "$X_RESERVATION"
```

```bash
pnpm exec tsx src/experiments/hw2/cli.ts run --phase exploration --authorized-gate 3 --confirm-spend "${STACK[@]}" --experiment 17 --condition with --count 1 --reservation "$X_RESERVATION"
```

Exploration confirms what the implementation must not assume:
- the live `openrouter_metadata` shape;
- which generation id `/generation` accepts;
- the provider's display name (from the slug);
- endpoint prices and limits;
- whether one-item `order` + `only` + `allow_fallbacks: false` routes as intended;
- a viable output cap.

Fixtures and settings may be refined only here.

6. Preserve the exploration evidence before stopping X. Follow
   [Export the evidence before teardown](#export-the-evidence-before-teardown-gate-4)
   with these changes:
   - skip steps 2 and 5 (the report and the screenshots belong to Gate 4);
   - give step 7 `exploration` as its last argument instead of `confirmatory`.

1. Fill `docs/plans/HW2-experiment-preregistration.md`, paste the manifest into
   its ```` ```json manifest ```` block, and **commit** it.
2. Restart the stack with the frozen values (`…_PROVIDER_NAME` set).
3. Authorize the confirmatory phase (`authorize --phase confirmatory --authorized-gate 4 --confirm-spend --budget 1.00 …`), then run:

```bash
pnpm exec tsx src/experiments/hw2/cli.ts run --phase confirmatory --authorized-gate 4 --confirm-spend \
  --prereg ../docs/plans/HW2-experiment-preregistration.md --rules <rules.json> \
  --api … --stack … --database … --container …
```

The run refuses unless:
- the preregistration is committed and unmodified;
- its manifest fingerprint equals the one recomputed from the current code, stack and content.

It runs the frozen 20 slots in order, one at a time, and never replays a slot.
Each slot carries its experiment's frozen non-Skill fingerprint. The server
refuses a confirmatory slot without it, or one that does not reproduce it,
before any model request, and the runner stops on any mismatch.
Confirmatory slots also need a known max-completion-tokens limit.

### Report

```bash
pnpm exec tsx src/experiments/hw2/cli.ts report --prereg ../docs/plans/HW2-experiment-preregistration.md \
  --api … --stack … --database … --container … --out report.md
```

The report covers **all 20 scheduled slots**, including those never
dispatched. For each slot it retrieves the run's actual findings
(`GET /pulls/:id/reviews`) and applies the frozen rules. It shows:
- the raw finding titles, and the matching titles with their anchors;
- whether the slot counts. A slot counts only when it is strict
  single-generation evidence **and** reproduces the frozen non-Skill
  fingerprint.

It never infers what ran from the scheduled label. Before counting a slot, it
checks its persisted trace against the preregistration:
- slot id, experiment, condition, phase and manifest fingerprint;
- the expected reviewer and fixture PR;
- the **actual Skills section**: none for *without*; exactly the target skill
  for *with*, by structure and by the Skill fingerprint of the frozen skill
  body.

A mismatch makes the slot ineligible and the experiment *invalid*, with the
reason in the report.

Per experiment it gives the with and without detections and counts, and the
outcome: success, negative, inconclusive, incomplete, or *invalid* when any
otherwise eligible slot broke the frozen fingerprint or did not execute its
preregistered slot, condition or Skills.

## Safety rules the code enforces

### Per slot, before any model request (zero cost on refusal)

The server refuses a slot unless all of these hold:
- the agent is openrouter on the frozen model, single-pass, with repo intel off;
- the runtime diff sha256 equals the frozen fixture hash;
- the intent is the fresh cached one (no derivation);
- no clone of the fixture repo exists;
- a live endpoint matches the frozen provider;
- the preflight's worst case fits the slot reservation.

The **preflight** works like this:
- **Input upper bound:** the larger of the tokenizer count and the UTF-8 bytes of the exact serialized request, plus a 512-token template allowance.
- **Prices:** the more expensive of the frozen and live ones; the context and completion limits are respected.
- **Worst case:** ×1.5.

### One door to paid generation

In experiment mode every LLM provider is wrapped at the shared boundary
(`container.llm`). Generation is refused **before it reaches the provider**
unless it is the experiment request of the one slot the experiments service
opened after its capability, budget and isolation checks, and then only once.
That covers ordinary reviews, intent derivation, conventions extraction,
free-text completions and embeddings. Model and endpoint listing, and the
preview, are free metadata and still work. Normal mode is unaffected.

### One request

The request carries:
- SDK retries 0 and no reprompt;
- `provider.order` = `provider.only` = [slug], with `allow_fallbacks: false`;
- `provider.require_parameters: true`: OpenRouter never routes it to an
  endpoint that would ignore one of its parameters, above all the strict
  `json_schema` response format;
- `max_tokens` = the cap;
- `X-OpenRouter-Metadata: enabled`.

### Evidence

Each run's `trace.experiment` records:
- slot id and condition;
- diff hash;
- non-Skill fingerprint (Skill slot replaced by a sentinel) and Skill fingerprint;
- preflight figures;
- every attempt as OpenRouter reported it: router metadata, served model, ids, finish reason, tokens, cost, generation metadata.

A failed dispatched run stores unknown usage as null, never zero.

### Crash safety

- The ledger is `~/.devdigest/hw2-experiments/<stack-id>/ledger.jsonl`: append-only, fsync per line.
- An exclusive runner lock is never stolen.
- The server allows one experiment run in flight (409) and refuses a used slot id (409).
- After a crash, `reconcile` (or the next `run`) settles every unresolved slot before spending. An unresolved slot becomes `ambiguous`: charged in full and never replayed.

### Strict evidence

A slot counts only if all of these hold:
- exactly one upstream attempt, on the frozen provider and model, shown by router metadata and/or generation metadata with no conflict and no fallback;
- the frozen intent and diff;
- a valid outcome.

A single upstream attempt must be **shown**, never assumed: either router
metadata reporting `attempt` = 1 **and** `attempts` = 1, or exactly one
generation `provider_responses` entry. Missing fields, or an empty list, prove
nothing. `finish_reason: length` is always truncation, even when the JSON
parses.

Ineligible slots stay in the report.

## Not claimed

- The requested provider is intent, not evidence.
- Live response shapes are confirmed only at Gate 3.
- Temperature 0 and a pinned provider do not make outputs deterministic.
- Five trials per condition is a small sample.
