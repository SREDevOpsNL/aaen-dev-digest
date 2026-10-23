# HW2 controlled experiments — operator guide

How to run the Homework 2 skill experiments (criteria 17 and 18) on a disposable
stack, and what each gate authorizes. Plan: rev. 4.3. Nothing here may run
against the development database or demo PR #3.

| Gate | What it authorizes | Spend |
| --- | --- | --- |
| 1 | Implementation and unpaid checks (this tooling) | none |
| 2 | You create the **dedicated** OpenRouter key, set its spending limit (~USD 2) in the OpenRouter dashboard, and confirm it ([checklist](HW2-gate2-checklist.md)) | none |
| 3 | Paid exploration on the disposable stack | ≤ USD 0.50 |
| 4 | Confirmatory runs, after the preregistration is committed | ≤ USD 1.00 |
| 5 | Acceptance walkthrough (reuses a Gate 4 trace for the token label) | none planned |

Each gate needs its own explicit authorization. The runner enforces the caps
(0.50 / 1.00 / 1.50 total) itself; the key limit is the outer control.

## Unpaid (Gate 1)

### 1. The dedicated key file (prepared at Gate 2)

An experiment stack reads **only** `~/.devdigest/hw2-experiments/secrets.json`
(mode 0600) and never falls back to `process.env`, so it cannot use the
everyday key in `~/.devdigest/secrets.json`. The server reads the file once at
startup, so create it **before** starting the stack.

The key requirements, the commands that write the file without exposing the
key, and the checks are in the [Gate 2 checklist](HW2-gate2-checklist.md).

### 2. Start a disposable stack

Every command below runs in bash. Values marked **EXAMPLE** must be replaced;
values left empty must be filled in. A validation step follows each group and
fails fast: it prints `FAILED` and returns a nonzero status. Do not continue
past a `FAILED`.

In the terminal that will run the stack, at the repository root, set the
experiment settings:
- Before Gate 3, provisional values are allowed. No slot can run without a
  spending capability.
- At Gate 4, use the values frozen in the manifest.

```bash
export DEVDIGEST_EXPERIMENT_MODEL=deepseek/deepseek-v4-flash
export DEVDIGEST_EXPERIMENT_PROVIDER=           # required: lowercase routing slug from `endpoints`, e.g. deepinfra/fp8
export DEVDIGEST_EXPERIMENT_MAX_OUTPUT_TOKENS=  # required: output cap in tokens, 1–200000, e.g. 4000
export DEVDIGEST_EXPERIMENT_PRICE_INPUT=        # required: USD per input token, e.g. 0.00000027
export DEVDIGEST_EXPERIMENT_PRICE_OUTPUT=       # required: USD per output token, e.g. 0.0000011
```

Optional:
- `DEVDIGEST_EXPERIMENT_PROVIDER_NAME`: the serving provider's display name,
  frozen after exploration and required at Gate 4;
- `DEVDIGEST_EXPERIMENT_PRICE_REQUEST`;
- `DEVDIGEST_EXPERIMENT_GENERATION_LOOKUP=0|1` (default 1).

A partial set fails the server's startup. Validate the settings with the same
rules the server applies:

```bash
python3 -I - <<'EOF'
import os, re, sys
env, problems = os.environ, []
def need(name, ok, hint):
    value = env.get(name, "")
    if not value:
        problems.append(f"{name} is not set ({hint})")
    elif not ok(value):
        problems.append(f"{name}={value!r} is invalid ({hint})")
def usd(value):
    return re.fullmatch(r"\d+(\.\d+)?([eE]-?\d+)?", value) is not None and float(value) > 0
need("DEVDIGEST_EXPERIMENT_MODEL", bool, "the model id")
need("DEVDIGEST_EXPERIMENT_PROVIDER", lambda v: re.fullmatch(r"[a-z0-9][a-z0-9._/-]*", v), "a lowercase routing slug")
need("DEVDIGEST_EXPERIMENT_MAX_OUTPUT_TOKENS", lambda v: v.isdigit() and 0 < int(v) <= 200000, "an integer from 1 to 200000")
need("DEVDIGEST_EXPERIMENT_PRICE_INPUT", usd, "a positive USD amount per token")
need("DEVDIGEST_EXPERIMENT_PRICE_OUTPUT", usd, "a positive USD amount per token")
if "DEVDIGEST_EXPERIMENT_PROVIDER_NAME" in env and not env["DEVDIGEST_EXPERIMENT_PROVIDER_NAME"]:
    problems.append("DEVDIGEST_EXPERIMENT_PROVIDER_NAME is set but empty")
if problems:
    sys.exit("FAILED:\n" + "\n".join(problems))
print("experiment settings are valid")
EOF
```

Then start the stack in this terminal and leave it running:

```bash
scripts/e2e.sh --serve
```

`--serve` prints:
- the stack id;
- the database (`devdigest_hw2f_<nonce>`) and container;
- the API URL;
- the clone directory (empty, per stack);
- the ledger directory (`~/.devdigest/hw2-experiments/<stack-id>/`).

It seeds the fixture PRs #501 and #502 (with fresh cached intents) and the
labelled synthetic convention candidates. Ctrl-C tears everything down.

### 3. Unpaid runner commands

Run the runner from `server/` in a second terminal. First set the stack
variables. Every later command uses them, including the paid ones and the
Gate 4 export.

```bash
ID=hw2f-0a1b2c3d   # EXAMPLE: replace with the stack id that --serve printed
```

```bash
API=http://127.0.0.1:3251; DB="devdigest_hw2f_${ID#hw2f-}"; CONTAINER="devdigest-hw2f-${ID#hw2f-}"; STACK=(--api "$API" --stack "$ID" --database "$DB" --container "$CONTAINER"); EV="$HOME/.devdigest/hw2-experiments/$ID/evidence"; LEDGER="$HOME/.devdigest/hw2-experiments/$ID/ledger.jsonl"
```

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
- a loopback, non-development API port;
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
  unless 20 × the per-slot reservation fits USD 1.00. The manifest that is
  pre-registered must be generated on the Gate 4 stack E itself (see
  [Paid](#paid)); one generated on any other stack never matches. The manifest
  freezes:
  - the **stack settings and identity**: database name, provider, provider name,
    model, output cap, prices and generation lookup;
  - the **implementation fingerprint**: committed blob ids of `server/src`,
    `reviewer-core/src`, their package and lock files, and `scripts/e2e.sh`.
    Unlike `HEAD`, it does not change when the preregistration is committed,
    and it refuses uncommitted implementation changes;
  - **each experiment's non-Skill fingerprint**, from the free
    `POST /experiments/preview`. The preview performs a slot's checks and
    preflight without a model request, a run or a trace.

### Authorizing a paid phase (server-side capability)

The server refuses every slot unless the operator's capability authorizes it,
so a direct API call cannot bypass the gate. Run this only **after Gate 3 is
explicitly authorized**:

```bash
pnpm exec tsx src/experiments/hw2/cli.ts authorize --phase exploration --authorized-gate 3 --confirm-spend --budget 0.15 --hours 12 "${STACK[@]}"
```

- `--budget 0.15` is the capability budget stack X used under the approved
  [Gate 3 plan](HW2-gate3-plan.md#schedule-and-costs). On stack X2, each slot
  gets a capability sized for that one slot instead
  ([Gate 3 on stack X2](#gate-3-on-stack-x2-addendum)). USD 0.50 is the formal
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
- `authorize` itself refuses a budget above the phase cap (0.50 exploration,
  1.00 confirmatory).
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
in the [Gate 3 plan](HW2-gate3-plan.md). This is the procedure stack X
(`hw2f-f53ed971`) ran. On stack X2, steps 1–3 apply unchanged, and the
[X2 addendum](#gate-3-on-stack-x2-addendum) replaces steps 4–5. The approved plan uses only part of the
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
- the provider's display name (from the slug), which becomes
  `DEVDIGEST_EXPERIMENT_PROVIDER_NAME` for E;
- endpoint prices and limits;
- whether one-item `order` + `only` + `allow_fallbacks: false` routes as intended;
- a viable output cap.

Fixtures and settings may be refined only here.

6. Preserve the exploration evidence before stopping X. Follow
   [Export the evidence before teardown](#export-the-evidence-before-teardown-gate-4)
   with these changes:
   - skip steps 2 and 5 (the report and the screenshots belong to Gate 4);
   - give step 7 `exploration` as its last argument instead of `confirmatory`.

   Stop X only after steps 1, 3, 4, 6 and 7 succeeded. Keep its ledger: its
   spend counts toward the USD 1.50 total.

### Gate 3 on stack X2 (addendum)

Stack X (`hw2f-f53ed971`) ran Gate 3 under the procedure above, with a $0.15
capability per slot. That record stays as it was. From stack X2 on, this
addendum replaces the authorization and slot steps (4 and 5) of that
procedure. Phase 0 (steps 1–3) applies to X2 unchanged.

| Rule | Value |
| --- | --- |
| X2 planning maximum | **USD 0.13**: X2's own conservative charge, over all its slots |
| Stack X | its final conservative charge, **USD 0.01022896**, stays counted separately against the original USD 0.15 exploration envelope |
| Per-slot capability | X2's current conservative charge **plus exactly one USD 0.01 reservation**, never above USD 0.13. The amount written in the slot's authorization must equal it, and so must the capability checked before the slot |
| Reservation, output cap, routing | unchanged: USD 0.01, 16,000 tokens, `order = only = [slug]`, no fallbacks, `require_parameters` |
| Who enforces what | an X2 server counts only X2's own runs, and knows nothing about X. The cross-stack check below is the operator's: before every X2 authorization, and again immediately before dispatch |

A capability sized this way bounds **spend, not attempts**: it covers one more
$0.01 reservation beyond X2's charge at authorization.
- A slot that completes or fails adds its cost, or its full reservation when
  the cost is unknown. Another reservation then no longer fits, and the server
  refuses (409) before any request.
- A slot **refused at zero cost** adds nothing, so the same capability would
  admit another attempt.

One attempt per authorization therefore comes from the procedure, not the
capability. Step 6 is a single guarded block: it authorizes, checks, runs one
`run --count 1`, and revokes the capability on every exit after authorizing,
including a failed check. Steps 2–6 run in **one shell**: step 2 defines the
cross-stack check, and step 6 runs it again before authorizing and before
dispatch.

**Slot identifiers are scoped to a stack.** The runner numbers a slot from its
stack's own ledger, and the server refuses a used slot id only within its own
database. In every Gate 3 record, a slot is therefore named by
**`(stack_id, slot_id)`**:

| Global attempt | `(stack_id, slot_id)` | Outcome | Conservative charge |
| --- | --- | --- | --- |
| 18 / with, 1st | `(hw2f-f53ed971, x-18-with-1)` | completed | USD 0.00022896 (known) |
| 18 / without, 1st | `(hw2f-f53ed971, x-18-without-1)` | failed, HTTP 429, cost unknown | USD 0.01 (full reservation) |
| 18 / without, 2nd | `(<X2 stack id>, x-18-without-1)` | not authorized | — |

The second without-Skill attempt is `x-18-without-1` again locally, on X2.

1. **After Phase 0 passed on X2**, with `ID` set to X2's stack id (§3), set the
   approved values:

```bash
X2_PLAN_MAX=0.13; X_STACK=hw2f-f53ed971; X_CHARGE_RECORDED=0.01022896   # APPROVED: X2 planning maximum (USD), stack X and its final conservative charge (USD)
```

2. **Before every X2 authorization**, check the conservative spending across X
   and X2, and compute the next capability. The block defines
   `x2_cross_stack_check`, which step 6 runs again, and runs it once.
   The check prints every slot of both stacks by its `(stack_id, slot_id)`.
   It fails when:
   - `ID` is not an X2 stack id, or the `LEDGER`, `DB` or API identity is not
     that of `ID` (X2's ledger path is derived from `ID`, not taken on trust);
   - X's ledger is missing, or no longer adds up to its recorded charge;
   - an X2 slot is unresolved;
   - the next slot would exceed the X2 maximum or the original envelope.

```bash
x2_cross_stack_check() {
python3 -I - "$HOME/.devdigest/hw2-experiments" "$X_STACK" "${ID:-}" "${LEDGER:-}" "${API:-}" "${DB:-}" "$X_CHARGE_RECORDED" "$X2_PLAN_MAX" "$X_RESERVATION" <<'EOF'
import json, os, re, sys, urllib.request
from decimal import ROUND_CEILING, Decimal
base, x_stack, x2_stack, ledger_var, api, db, x_recorded, plan_max, reservation = sys.argv[1:10]
if (x_recorded, plan_max, reservation) != ("0.01022896", "0.13", "0.01"):
    sys.exit(f"FAILED: X_CHARGE_RECORDED={x_recorded!r}, X2_PLAN_MAX={plan_max!r}, X_RESERVATION={reservation!r} are not the approved 0.01022896, 0.13 and 0.01")
if not re.fullmatch(r"hw2f-[a-z0-9]{4,32}", x2_stack) or x2_stack == x_stack:
    sys.exit(f"FAILED: ID={x2_stack!r} must be X2's own stack id, not {x_stack}")
# The X2 ledger and database follow from ID itself; the §3 variables must agree with them.
x2_ledger = os.path.join(base, x2_stack, "ledger.jsonl")
if not ledger_var or os.path.normpath(ledger_var) != os.path.normpath(x2_ledger):
    sys.exit(f"FAILED: LEDGER={ledger_var!r} is not {x2_ledger}, the ledger of ID={x2_stack}: set the §3 variables again")
if db != "devdigest_hw2f_" + x2_stack[len("hw2f-"):]:
    sys.exit(f"FAILED: DB={db!r} is not the database of {x2_stack}: set the §3 variables again")
try:
    identity = json.load(urllib.request.urlopen(f"{api}/experiments/identity", timeout=30))
except (OSError, ValueError) as err:
    sys.exit(f"FAILED: cannot read {api}/experiments/identity: {err}")
if identity.get("stack_id") != x2_stack or identity.get("database") != db:
    sys.exit(f"FAILED: the API at {api} serves {identity.get('stack_id')!r} / {identity.get('database')!r}, not {x2_stack} / {db}")
TERMINAL = {"completed", "failed", "refused", "ambiguous"}
def slots(path, required):
    if not os.path.isfile(path):
        if required:
            sys.exit(f"FAILED: no ledger at {path}")
        return {}
    records = {}
    for line in open(path):
        if not line.strip():
            continue
        event = json.loads(line)
        current = records.get(event["slot_id"])
        if current and current["state"] in TERMINAL:
            continue  # a slot never leaves a terminal state
        records[event["slot_id"]] = {"state": event["state"], "reservation": Decimal(str(event["reservation_usd"])), "cost": event.get("cost_usd")}
    return records
def charge(slot):
    if slot["state"] == "refused":
        return Decimal(0)
    if slot["state"] in ("completed", "failed") and slot["cost"] is not None:
        return Decimal(str(slot["cost"]))
    return slot["reservation"]  # reserved, dispatched, ambiguous, or unknown cost
try:
    x, x2 = slots(os.path.join(base, x_stack, "ledger.jsonl"), True), slots(x2_ledger, False)
except (OSError, ValueError, KeyError) as err:
    sys.exit(f"FAILED: unreadable ledger: {err}")
for stack, records in ((x_stack, x), (x2_stack, x2)):
    for slot_id, slot in sorted(records.items()):
        print(f"({stack}, {slot_id}) {slot['state']}, charge ${charge(slot)}", file=sys.stderr)
x_charge, x2_charge, res = sum(map(charge, x.values()), Decimal(0)), sum(map(charge, x2.values()), Decimal(0)), Decimal(reservation)
problems = []
if x_charge != Decimal(x_recorded):
    problems.append(f"stack X's ledger now charges ${x_charge}, not the recorded ${x_recorded}: investigate before any authorization")
unresolved = [s for s, slot in x2.items() if slot["state"] not in TERMINAL]
if unresolved:
    problems.append(f"X2 slots {unresolved} are not terminal: reconcile first")
nxt = (x2_charge + res).quantize(Decimal("0.00000001"), rounding=ROUND_CEILING)
if nxt > Decimal(plan_max):
    problems.append(f"X2 would be charged ${nxt}, above the ${plan_max} X2 maximum")
if x_charge + nxt > Decimal("0.15"):
    problems.append(f"X and X2 together would be charged ${x_charge + nxt}, above the original $0.15 envelope")
if problems:
    sys.exit("FAILED:\n" + "\n".join(problems))
print(f"X ${x_charge} + X2 ${x2_charge} + one reservation ${res}: within the ${plan_max} X2 maximum and the $0.15 envelope", file=sys.stderr)
print(format(nxt.normalize(), "f"))
EOF
}
X2_NEXT_BUDGET=$(x2_cross_stack_check) && echo "next X2 capability: \$$X2_NEXT_BUDGET" || { echo "FAILED: cross-stack budget check"; false; }
```

3. **Set the authorized amount**, exactly as the slot's written authorization
   states it:

```bash
AUTHORIZED_BUDGET=   # required: the USD amount in the slot's written authorization, e.g. 0.01
```

```bash
python3 -I - "$AUTHORIZED_BUDGET" "${X2_NEXT_BUDGET:-}" "$X2_PLAN_MAX" <<'EOF'
import re, sys
from decimal import Decimal
authorized, computed, plan_max = sys.argv[1:4]
if not re.fullmatch(r"\d+(\.\d{1,8})?", authorized):
    sys.exit(f"FAILED: AUTHORIZED_BUDGET={authorized!r} is not a USD amount (set it from the written authorization)")
if not re.fullmatch(r"\d+(\.\d{1,8})?", computed):
    sys.exit("FAILED: no computed X2_NEXT_BUDGET: run the cross-stack check first")
if Decimal(authorized) != Decimal(computed):
    sys.exit(f"FAILED: the authorization says ${authorized}, but the next X2 capability is ${computed}: they must be equal")
if not Decimal(0) < Decimal(authorized) <= Decimal(plan_max):
    sys.exit(f"FAILED: ${authorized} is outside (0, ${plan_max}]")
print(f"authorized budget ${authorized} equals the next X2 capability")
EOF
```

4. **Check the capability files.** An active `capability.json` fails the
   check. A revoked slot's `capability.token` is kept under a dated name, so
   `authorize` does not overwrite it.

```bash
CAPDIR="$HOME/.devdigest/hw2-experiments/$ID"; if [ ! -d "$CAPDIR" ] || [ ! -x "$CAPDIR" ]; then echo "FAILED: $CAPDIR is not a readable stack directory (check ID)"; false; elif [ -e "$CAPDIR/capability.json" ] || [ -L "$CAPDIR/capability.json" ]; then echo "FAILED: an active capability exists for $ID; stop and investigate"; false; elif [ -L "$CAPDIR/capability.token" ]; then echo "FAILED: $CAPDIR/capability.token is a symlink; stop and investigate"; false; elif [ -e "$CAPDIR/capability.token" ]; then KEPT="$CAPDIR/capability.token.revoked-$(date -u +%Y%m%dT%H%M%SZ)"; if [ ! -e "$KEPT" ] && mv -n -- "$CAPDIR/capability.token" "$KEPT" && chmod 600 "$KEPT" && [ ! -e "$CAPDIR/capability.token" ]; then echo "kept the revoked token as $KEPT"; else echo "FAILED: could not keep the old capability.token"; false; fi; else echo "no capability files for $ID"; fi
```

5. **Set the authorized slot, and define the preflight checks** that step 6
   runs with the capability in place. The two functions are the step 2
   endpoint and settings checks of the procedure above, unchanged (they need
   its `SLUG`):

```bash
X2_EXPERIMENT=   # required: 17 or 18, as authorized
X2_CONDITION=    # required: with or without, as authorized
```

```bash
x2_endpoint_check() {
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
}
x2_settings_check() {
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
}
echo "slot ${X2_EXPERIMENT:-?} / ${X2_CONDITION:-?}; preflight checks defined for ${SLUG:-<SLUG not set>}"
```

6. **Authorize, check, run once and revoke: one guarded block.** Run it only
   after the slot's explicit written authorization. It uses the amount in
   `AUTHORIZED_BUDGET` (step 3) and the slot from step 5.
   - **Before authorizing**, it refuses if:
     - a capability exists: it is never replaced, and is left in place for
       investigation;
     - an old `capability.token` was not kept (step 4);
     - the cross-stack check, run fresh, does not equal the authorized amount.
   - **The revocation trap is installed before `authorize` runs.** Every exit
     after authorizing revokes the capability: normal completion, any failed
     check or command, Ctrl-C, `TERM` or a closed terminal (`HUP`). The
     operator never has to continue to a later step to clean up.
   - **With the capability in place**, it checks:
     - the capability: amount, stack, phase, gate, expiry;
     - the reservation and the slot;
     - the cross-stack check, run fresh again, still equal to the authorized
       amount;
     - the endpoint and the settings, with the step 5 functions.
   - **Only then** it runs exactly one `run --count 1`. Nothing is retried.
     Judge the slot from the ledger and the trace, never from the block's
     status.

```bash
(
  CAP="$HOME/.devdigest/hw2-experiments/$ID/capability.json"; OWN=
  revoke() { if [ -L "$CAP" ]; then echo "FAILED: $CAP is a symlink; revoke it by hand and investigate"; return 1; elif [ -f "$CAP" ]; then if rm -- "$CAP" && [ ! -e "$CAP" ]; then date -u +"capability revoked %FT%TZ"; else echo "FAILED: could not revoke $CAP"; return 1; fi; else echo "no capability to revoke"; fi; }
  finish() { status=$?; trap - EXIT INT TERM HUP; if [ -n "$OWN" ]; then revoke || status=1; fi; echo "lifecycle finished with status $status: judge any slot from the ledger and the trace"; exit "$status"; }
  trap finish EXIT; trap 'exit 130' INT; trap 'exit 143' TERM; trap 'exit 129' HUP
  if [ -e "$CAP" ] || [ -L "$CAP" ]; then echo "FAILED: a capability already exists for $ID; it is not replaced: stop and investigate"; exit 1; fi
  if [ -e "${CAP%.json}.token" ] || [ -L "${CAP%.json}.token" ]; then echo "FAILED: an old capability.token is still in place: run step 4 first"; exit 1; fi
  NOW=$(x2_cross_stack_check) || { echo "FAILED: cross-stack check before authorizing; nothing was authorized"; exit 1; }
  python3 -I -c 'import re, sys; from decimal import Decimal; a, n = sys.argv[1:3]; sys.exit(0 if re.fullmatch(r"\d+(\.\d{1,8})?", a) and Decimal(a) == Decimal(n) else 1)' "${AUTHORIZED_BUDGET:-}" "$NOW" || { echo "FAILED: the authorization says ${AUTHORIZED_BUDGET:-<not set>}, the next X2 capability is $NOW; nothing was authorized"; exit 1; }
  OWN=1   # from here on, every exit revokes
  pnpm exec tsx src/experiments/hw2/cli.ts authorize --phase exploration --authorized-gate 3 --confirm-spend --budget "$AUTHORIZED_BUDGET" --hours 12 "${STACK[@]}" || { echo "FAILED: authorize"; exit 1; }
  NOW=$(x2_cross_stack_check) || { echo "FAILED: cross-stack check before dispatch; nothing was dispatched"; exit 1; }
  python3 -I - "$CAP" "$ID" "$X_RESERVATION" "${AUTHORIZED_BUDGET:-}" "${X2_EXPERIMENT:-}" "${X2_CONDITION:-}" "$NOW" "$X2_PLAN_MAX" <<'EOF' || { echo "nothing was dispatched"; exit 1; }
import datetime, json, re, sys
from decimal import Decimal
path, stack, reservation, authorized, experiment, condition, fresh, plan_max = sys.argv[1:9]
amount = re.compile(r"\d+(\.\d{1,8})?")
problems = []
if not amount.fullmatch(authorized):
    problems.append(f"AUTHORIZED_BUDGET={authorized!r} is not set")
elif not amount.fullmatch(fresh) or Decimal(fresh) != Decimal(authorized):
    problems.append(f"the cross-stack check now sizes the next X2 capability at ${fresh}, not the authorized ${authorized}")
elif plan_max != "0.13" or Decimal(authorized) > Decimal("0.13"):
    problems.append(f"${authorized} must be within the approved $0.13 X2 maximum (X2_PLAN_MAX={plan_max!r})")
try:
    cap = json.load(open(path))
except (OSError, ValueError) as err:
    sys.exit(f"FAILED: no readable capability: {err}")
if cap.get("stack_id") != stack:
    problems.append(f"capability is for {cap.get('stack_id')!r}, not {stack!r}")
if cap.get("phase") != "exploration" or cap.get("gate") != 3:
    problems.append(f"capability is for {cap.get('phase')} / Gate {cap.get('gate')}, not exploration / Gate 3")
if amount.fullmatch(authorized) and (not isinstance(cap.get("budget_usd"), (int, float)) or Decimal(str(cap["budget_usd"])) != Decimal(authorized)):
    problems.append(f"capability budget is {cap.get('budget_usd')}, not the authorized {authorized}")
try:
    if datetime.datetime.fromisoformat(cap["expires_at"].replace("Z", "+00:00")) <= datetime.datetime.now(datetime.timezone.utc):
        problems.append(f"capability expired at {cap['expires_at']}")
except (KeyError, ValueError) as err:
    problems.append(f"capability expiry is unreadable: {err}")
if reservation != "0.01":
    problems.append(f"X_RESERVATION={reservation!r}, not the approved 0.01")
if experiment not in ("17", "18") or condition not in ("with", "without"):
    problems.append(f"X2_EXPERIMENT={experiment!r} / X2_CONDITION={condition!r} is not 17|18 / with|without")
if problems:
    sys.exit("FAILED:\n" + "\n".join(problems))
print(f"capability: exploration, Gate 3, budget ${authorized} as authorized and as sized now, expires {cap['expires_at']}; slot {experiment} / {condition}")
EOF
  x2_endpoint_check || { echo "FAILED: endpoint check; nothing was dispatched"; exit 1; }
  x2_settings_check || { echo "FAILED: settings check; nothing was dispatched"; exit 1; }
  pnpm exec tsx src/experiments/hw2/cli.ts run --phase exploration --authorized-gate 3 --confirm-spend "${STACK[@]}" --experiment "$X2_EXPERIMENT" --condition "$X2_CONDITION" --count 1 --reservation "$X_RESERVATION"
)
```

7. **Recovery, only if that block was killed before its cleanup ran.** That
   means `SIGKILL`, a crash or a power loss: none of them can be caught, and
   they can leave an active capability. In a new terminal, set the §3
   variables for X2, then:
   1. revoke by hand at once:

```bash
CAP="$HOME/.devdigest/hw2-experiments/$ID/capability.json"; if [ -L "$CAP" ]; then echo "FAILED: $CAP is a symlink; revoke it by hand and investigate"; false; elif [ -f "$CAP" ]; then if rm -- "$CAP" && [ ! -e "$CAP" ]; then date -u +"capability revoked %FT%TZ"; else echo "FAILED: could not revoke $CAP"; false; fi; else echo "no capability to revoke"; fi
```

   2. settle any slot without a new request:

```bash
pnpm exec tsx src/experiments/hw2/cli.ts reconcile "${STACK[@]}"
```

   - `reconcile` only reads the server. A slot whose outcome it cannot show
     becomes `ambiguous`, stays charged at its full reservation, and is never
     replayed.
   - If it reports that another runner holds the lock, make sure no runner
     still runs (`pgrep -af 'cli.ts'` prints nothing). Only then is the lock
     stale: remove `runner.lock` from the stack directory by hand and rerun
     `reconcile`.
   - Report the interruption, then go on with step 8.

8. **Reconcile** under the approved policy:
    - poll the generation lookup and the key's usage for up to about 10 minutes;
    - the key's usage must equal its previous cumulative usage plus the slot's
      ledger charge, within reporting precision;
    - if attribution stays uncertain, stop and report it; never retry a
      generation.

    Record the slot by its `(stack_id, slot_id)`, with its global attempt
    number, in the Gate 3 plan's execution log.

### A further exploration stack, e.g. X3 (PROPOSED, NOT APPROVED)

**Do not use this until it is approved in writing.** These are proposed
values, not a spending authorization.

The proposal:
- the exploration stacks together stay within USD 0.15 of conservative
  charge;
- X3's own maximum is USD 0.10;
- each X3 slot gets a capability of X3's current charge plus one USD 0.01
  reservation, named in that slot's own written authorization;
- slots are identified by `(stack_id, slot_id)`, with one guarded invocation
  per authorization, immediate revocation and no automatic retry.

Steps 4, 5, 7 and 8 of the [X2 addendum](#gate-3-on-stack-x2-addendum) do not
depend on the stack, and apply with `ID` set to X3. Steps 1–3 and 6 below
replace X2's, whose constants belong to X2.

1. **After Phase 0 passed on X3**, with the §3 variables set for X3:

```bash
XS_MAX=0.10; XS_ENVELOPE=0.15; X_RESERVATION=0.01   # PROPOSED, not approved: X3 maximum, exploration envelope, per-slot reservation (USD)
```

2. **The cross-stack check.** The block defines `xs_cross_stack_check`, which
   step 6 runs again, and runs it once.
   - **Identity.** It checks `ID`, `LEDGER`, `DB` and the API's identity
     against each other, and that no slot is in flight.
   - **First use.** The runner writes a stack's ledger only when it reserves
     the stack's first slot, so a fresh X3 has none. Without a ledger, X3
     counts as new only if both hold:
     - the server shows no run for any slot `run` could take next;
     - [`hw2-settle.py`](hw2-settle.py) finds the stack's directory with no
       kept token of an earlier slot and no runner lock. The capability of the
       lifecycle in progress is allowed, because step 6 refuses to start while
       any capability or unkept token exists.

     Otherwise the ledger may be lost, and the check fails.
   - **Settlement.** It then settles every ledger, with X and X2 pinned, and
     prints the next capability: X3's charge plus one reservation, within
     `XS_MAX` and the envelope.

```bash
xs_cross_stack_check() {
python3 -I - "$HOME/.devdigest/hw2-experiments" "${ID:-}" "${LEDGER:-}" "${API:-}" "${DB:-}" <<'EOF' >&2 || return 1
import json, os, re, sys, urllib.error, urllib.request
base, stack, ledger_var, api, db = sys.argv[1:6]
if not re.fullmatch(r"hw2f-[a-z0-9]{4,32}", stack) or stack in ("hw2f-f53ed971", "hw2f-39febf41"):
    sys.exit(f"FAILED: ID={stack!r} must be the new stack's own id, not X's or X2's")
ledger = os.path.join(base, stack, "ledger.jsonl")
if not ledger_var or os.path.normpath(ledger_var) != os.path.normpath(ledger):
    sys.exit(f"FAILED: LEDGER={ledger_var!r} is not {ledger}, the ledger of ID={stack}: set the §3 variables again")
if db != "devdigest_hw2f_" + stack[len("hw2f-"):]:
    sys.exit(f"FAILED: DB={db!r} is not the database of {stack}")
def get(path):
    try:
        return json.load(urllib.request.urlopen(f"{api}{path}", timeout=30))
    except (OSError, ValueError) as err:
        sys.exit(f"FAILED: cannot read {api}{path}: {err}")
identity = get("/experiments/identity")
if identity.get("stack_id") != stack or identity.get("database") != db:
    sys.exit(f"FAILED: the API at {api} serves {identity.get('stack_id')!r} / {identity.get('database')!r}, not {stack} / {db}")
if identity.get("in_flight_slot"):
    sys.exit(f"FAILED: slot {identity['in_flight_slot']} is in flight on {stack}")
if not os.path.exists(ledger):
    used = [s for s in (f"x-{e}-{c}-{n}" for e in ("17", "18") for c in ("with", "without") for n in (1, 2, 3, 4)) if get(f"/experiments/slots/{s}").get("runs")]
    if used:
        sys.exit(f"FAILED: {stack} has no ledger, but its server has runs for {', '.join(used)}: the ledger may be lost; investigate")
    print(f"{stack}: no ledger and no run on its server: first use")
else:
    print(f"{stack}: ledger present")
EOF
local mode=SETTLE_EXPECT out
[ -e "$HOME/.devdigest/hw2-experiments/$ID/ledger.jsonl" ] || mode=SETTLE_NEW
out=$(env "$mode=$ID" SETTLE_NEXT_STACK="$ID" SETTLE_STACK_MAX="$XS_MAX" SETTLE_ENVELOPE="$XS_ENVELOPE" SETTLE_RESERVATION="$X_RESERVATION" \
  python3 -I "$(git rev-parse --show-toplevel)/docs/plans/hw2-settle.py" "$HOME/.devdigest/hw2-experiments") || { printf '%s\n' "$out" >&2; return 1; }
printf '%s\n' "$out" >&2
printf '%s\n' "$out" | sed -n "s/^next capability for $ID: \$\([0-9.]*\) .*/\1/p"
}
XS_NEXT_BUDGET=$(xs_cross_stack_check) && echo "next X3 capability: \$$XS_NEXT_BUDGET" || { echo "FAILED: cross-stack check"; false; }
```

3. **Set the authorized amount**, exactly as the slot's written authorization
   states it. It must equal the computed next capability:

```bash
AUTHORIZED_BUDGET=   # required: the USD amount in the slot's written authorization, e.g. 0.01
```

```bash
python3 -I -c 'import re, sys; from decimal import Decimal; a, n, m = sys.argv[1:4]; usd = re.compile(r"\d+(\.\d{1,8})?"); ok = bool(usd.fullmatch(a) and usd.fullmatch(n)) and Decimal(a) == Decimal(n) and 0 < Decimal(a) <= Decimal(m); print("authorized budget $" + a + " equals the next X3 capability" if ok else "FAILED: the authorization says " + (a or "<not set>") + ", the next X3 capability is " + (n or "<not computed>") + " (maximum $" + m + ")"); sys.exit(0 if ok else 1)' "${AUTHORIZED_BUDGET:-}" "${XS_NEXT_BUDGET:-}" "$XS_MAX"
```

6. **Authorize, check, run once and revoke: one guarded, locked block.** It is
   X2's step 6, with three changes:
   - **Lock.** It first takes the stack's lifecycle lock (an atomic `mkdir`)
     and gives it back on every exit. A second lifecycle on the same stack,
     started at the same time, stops before it checks or authorizes anything.
   - **Cross-stack check.** It uses `xs_cross_stack_check` and `XS_MAX`.
   - **Slot.** The slot comes from step 5's variables.

```bash
(
  DIR="$HOME/.devdigest/hw2-experiments/$ID"; CAP="$DIR/capability.json"; LOCK="$DIR/lifecycle.lock"; OWN=; LOCKED=
  revoke() { if [ -L "$CAP" ]; then echo "FAILED: $CAP is a symlink; revoke it by hand and investigate"; return 1; elif [ -f "$CAP" ]; then if rm -- "$CAP" && [ ! -e "$CAP" ]; then date -u +"capability revoked %FT%TZ"; else echo "FAILED: could not revoke $CAP"; return 1; fi; else echo "no capability to revoke"; fi; }
  finish() { status=$?; trap - EXIT INT TERM HUP; if [ -n "$OWN" ]; then revoke || status=1; fi; if [ -n "$LOCKED" ]; then rmdir -- "$LOCK" || status=1; fi; echo "lifecycle finished with status $status: judge any slot from the ledger and the trace"; exit "$status"; }
  trap finish EXIT; trap 'exit 130' INT; trap 'exit 143' TERM; trap 'exit 129' HUP
  if [ ! -d "$DIR" ] || ! mkdir -- "$LOCK" 2>/dev/null; then echo "FAILED: another lifecycle holds $LOCK (or $DIR is missing): nothing was authorized"; exit 1; fi
  LOCKED=1
  if [ -e "$CAP" ] || [ -L "$CAP" ]; then echo "FAILED: a capability already exists for $ID; it is not replaced: stop and investigate"; exit 1; fi
  if [ -e "${CAP%.json}.token" ] || [ -L "${CAP%.json}.token" ]; then echo "FAILED: an old capability.token is still in place: run step 4 first"; exit 1; fi
  NOW=$(xs_cross_stack_check) || { echo "FAILED: cross-stack check before authorizing; nothing was authorized"; exit 1; }
  python3 -I -c 'import re, sys; from decimal import Decimal; a, n = sys.argv[1:3]; sys.exit(0 if re.fullmatch(r"\d+(\.\d{1,8})?", a) and re.fullmatch(r"\d+(\.\d{1,8})?", n) and Decimal(a) == Decimal(n) else 1)' "${AUTHORIZED_BUDGET:-}" "$NOW" || { echo "FAILED: the authorization says ${AUTHORIZED_BUDGET:-<not set>}, the next X3 capability is ${NOW:-<none>}; nothing was authorized"; exit 1; }
  OWN=1   # from here on, every exit revokes
  pnpm exec tsx src/experiments/hw2/cli.ts authorize --phase exploration --authorized-gate 3 --confirm-spend --budget "$AUTHORIZED_BUDGET" --hours 12 "${STACK[@]}" || { echo "FAILED: authorize"; exit 1; }
  NOW=$(xs_cross_stack_check) || { echo "FAILED: cross-stack check before dispatch; nothing was dispatched"; exit 1; }
  python3 -I -c 'import datetime, json, sys; from decimal import Decimal; p, s, a, n, m = sys.argv[1:6]; c = json.load(open(p)); bad = [x for x, ok in (("stack", c.get("stack_id") == s), ("phase/gate", c.get("phase") == "exploration" and c.get("gate") == 3), ("budget", Decimal(str(c.get("budget_usd"))) == Decimal(a) == Decimal(n) and Decimal(a) <= Decimal(m)), ("expiry", datetime.datetime.fromisoformat(c["expires_at"].replace("Z", "+00:00")) > datetime.datetime.now(datetime.timezone.utc))) if not ok]; print("FAILED: capability " + ", ".join(bad) if bad else f"capability: exploration, Gate 3, budget ${a} as authorized and as sized now, for {s}"); sys.exit(1 if bad else 0)' "$CAP" "$ID" "${AUTHORIZED_BUDGET:-}" "$NOW" "$XS_MAX" || { echo "nothing was dispatched"; exit 1; }
  x2_endpoint_check || { echo "FAILED: endpoint check; nothing was dispatched"; exit 1; }
  x2_settings_check || { echo "FAILED: settings check; nothing was dispatched"; exit 1; }
  pnpm exec tsx src/experiments/hw2/cli.ts run --phase exploration --authorized-gate 3 --confirm-spend "${STACK[@]}" --experiment "$X2_EXPERIMENT" --condition "$X2_CONDITION" --count 1 --reservation "$X_RESERVATION"
)
```

   **Recovery** (X2's step 7) is unchanged. After a `SIGKILL` the lifecycle
   lock can also remain. Remove `lifecycle.lock` by hand only when no
   lifecycle and no runner still runs (`pgrep -af 'cli.ts'` prints nothing).

### Gate 4: confirmatory on a new stack E (≤ USD 1.00)

1. **Prepare E.**
   - In a new terminal at the repository root, set the §2 settings to the final
     values established at Gate 3, including
     `DEVDIGEST_EXPERIMENT_PROVIDER_NAME`.
   - Run the §2 validation, then confirm that the provider name is set:

```bash
if [ -n "${DEVDIGEST_EXPERIMENT_PROVIDER_NAME:-}" ]; then echo "provider name: $DEVDIGEST_EXPERIMENT_PROVIDER_NAME"; else echo "FAILED: DEVDIGEST_EXPERIMENT_PROVIDER_NAME is required for stack E"; false; fi
```

   - Start E with `scripts/e2e.sh --serve` (§2). Leave this terminal and E
     running until the evidence export has succeeded.

2. **Check E.** In the runner terminal:
   - set `ID` to E's stack id;
   - set the §3 variables;
   - run the stack check and `check`.
3. **Generate the confirmatory manifest on E.**
   - Set `SEED`, `RULES` and `RESERVATION`, then validate them (§3).
   - Run `manifest` (§3). It computes the non-Skill previews on E and writes
     `$MANIFEST`.
4. **Pre-register while E keeps running.**
   - Paste `$MANIFEST` into the ```` ```json manifest ```` block of
     `docs/plans/HW2-experiment-preregistration.md`. Fill in the rest of the
     document and commit it.
   - Commit nothing under the implementation paths: `server/src`,
     `reviewer-core/src`, their package and lock files, and `scripts/e2e.sh`.
     The implementation fingerprint refuses uncommitted changes there, and a
     committed change there invalidates the manifest.
   - Then confirm that the committed preregistration holds exactly E's
     manifest:

```bash
python3 -I - ../docs/plans/HW2-experiment-preregistration.md "$MANIFEST" "$DB" <<'EOF'
import json, re, subprocess, sys
prereg, manifest_file, database = sys.argv[1:4]
if subprocess.run(["git", "status", "--porcelain", "--", prereg], capture_output=True, text=True).stdout.strip():
    sys.exit("FAILED: the preregistration has uncommitted changes")
fence = "`" * 3  # the manifest block's fence, built here so this snippet holds no literal fence
block = re.search(fence + r"json manifest\n([\s\S]*?)\n" + fence, open(prereg).read())
if not block:
    sys.exit("FAILED: the preregistration has no json manifest block")
committed, generated = json.loads(block.group(1)), json.load(open(manifest_file))
if committed != generated:
    sys.exit("FAILED: the committed manifest is not the one generated on this stack")
if committed.get("stack", {}).get("database") != database:
    sys.exit(f"FAILED: the manifest was generated on {committed.get('stack', {}).get('database')}, not on {database}")
print(f"preregistered manifest matches stack E ({database})")
EOF
```

5. **Do not restart E.** The manifest is bound to E's database. If E stops
   for any reason, follow [If stack E stops unexpectedly](#if-stack-e-stops-unexpectedly).
6. **Run, only after Gate 4 is separately authorized.** On the same E, with the
   same variables, create the confirmatory capability, then run the frozen
   schedule:

```bash
pnpm exec tsx src/experiments/hw2/cli.ts authorize --phase confirmatory --authorized-gate 4 --confirm-spend --budget 1.00 --hours 12 "${STACK[@]}"
```

```bash
pnpm exec tsx src/experiments/hw2/cli.ts run --phase confirmatory --authorized-gate 4 --confirm-spend --prereg ../docs/plans/HW2-experiment-preregistration.md --rules "$RULES" "${STACK[@]}"
```

The run refuses unless:
- the preregistration is committed and unmodified;
- its manifest fingerprint equals the one recomputed from the current code, stack and content.

It runs the frozen 20 slots in order, one at a time, and never replays a slot.
Each slot carries its experiment's frozen non-Skill fingerprint. The server
refuses a confirmatory slot without it, or one that does not reproduce it,
before any model request, and the runner stops on any mismatch.
Confirmatory slots also need a known max-completion-tokens limit.

7. **Export the evidence, then stop E.** Follow
   [Export the evidence before teardown](#export-the-evidence-before-teardown-gate-4).

### If stack E stops unexpectedly

Only the ledger directory `~/.devdigest/hw2-experiments/<stack-id>/` survives.
E's database, runs and traces are gone, and so is the server-side budget
computed from them. A replacement stack starts with a new database, a new
ledger and zero recorded spend.

1. **Stop all paid commands.** Do not run `run` against another stack with
   this preregistration: it refuses anyway, because the database identity
   differs. Do not run `authorize` again.
2. **Never replay a slot that may have cost money:**
   - a slot recorded as `reserved`, `dispatched` or `ambiguous` is unresolved;
     without E's API it cannot be reconciled, so it is treated as `ambiguous`
     and charged its full reservation;
   - a `completed` or `failed` slot keeps its recorded outcome;
   - none of these is ever run again.
3. **Settle the spend offline.** This uses the same rule as the runner's
   `charge()`, and reads the ledgers only.
   - **Every stack:** it settles every stack's ledger under
     `~/.devdigest/hw2-experiments/`, so a later exploration stack or E cannot
     be left out. A ledger exists only once its stack reserved a slot, so
     unpaid stacks add nothing.
   - **No stack can silently disappear.** The closed stacks X and X2 are
     pinned: their ledgers must exist and keep their recorded charges. Every
     open stack named in `SETTLE_EXPECT` must exist as well.
   - **Stack-scoped slots:** every slot is settled by its
     `(stack_id, slot_id)`, the stack id being the name of the ledger's
     directory. X and X2 both have an `x-18-without-1`, and two stacks' slots
     are never merged. As in the runner, a slot's first terminal event wins;
     later events are counted and reported.
   - **Fails closed** (`FAILED`, exit 1) when:
     - a ledger is missing, unreadable or holds a line that is not a ledger
       event;
     - a pinned charge changed;
     - the key's usage does not fit the ledgers.

   Set the stacks that must be present (E's `$ID`, and any later exploration
   stack) and, optionally, the dedicated key's `usage` from `GET /api/v1/key`.
   With a usage, the script checks that the key spent at least every known
   cost, and no more than those plus the reservations of the slots whose cost
   is unknown. The script is
   [`hw2-settle.py`](hw2-settle.py), shared with the X3 procedure.

```bash
export SETTLE_EXPECT="$ID"     # space-separated stack ids that must be present
export SETTLE_KEY_USAGE=       # optional: the key's usage in USD, e.g. 0.00040788
```

```bash
python3 -I "$(git rev-parse --show-toplevel)/docs/plans/hw2-settle.py" "$HOME/.devdigest/hw2-experiments"
```

4. **Preserve what survived.**
   - Run the secret scan (export step 6) and the checksums (export step 8)
     over whatever was exported.
   - Record the stop time, the ledger states and the output above in the
     results document. A lost or ambiguous slot stays in the evidence as such;
     it is never silently replaced.
5. **Report and wait.** Continuing needs:
   - a new preregistration revision, committed before any further paid call,
     that documents the lost and ambiguous slots and says which slots, if any,
     the new stack runs;
   - a new stack E with its own manifest (Gate 4 steps 1–5);
   - a separate, explicit authorization.

   On that stack, `authorize --budget` must not exceed the remaining budget
   printed above, because the new stack's server and ledger start from zero.
   The OpenRouter key limit remains the outer control.

### Report

```bash
pnpm exec tsx src/experiments/hw2/cli.ts report --prereg ../docs/plans/HW2-experiment-preregistration.md "${STACK[@]}" --out "$HOME/.devdigest/hw2-experiments/$ID/report.md"
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

### Export the evidence before teardown (Gate 4)

Stopping the stack deletes its database and every trace in it (`docker rm -f`).
Only `~/.devdigest/hw2-experiments/<stack-id>/` survives. Before the row 19/20
browser check and **before stopping E**, export the evidence into that
directory.

- Run the stack itself in your own terminal: an agent's background task ends
  with the agent session.
- Run these steps from `server/` in a second terminal.
- The export reads only the local API on loopback (no credentials), the
  stack's own database (which never holds keys) and the ledger. It never copies
  `secrets.json`, `capability.json` or `capability.token`, and no step prints a
  key.
- Steps 1, 3, 4, 6 and 7 **fail closed**: on any problem they print `FAILED`
  and return a nonzero status. Stop E only after all of them have succeeded.

1. In a new terminal, set the stack variables exactly as in §3. The id is **an
   example**: replace it with the `stack id` that `--serve` printed. Then
   create the evidence directory.

```bash
ID=hw2f-0a1b2c3d   # EXAMPLE: replace with the stack id that --serve printed
```

```bash
API=http://127.0.0.1:3251; DB="devdigest_hw2f_${ID#hw2f-}"; CONTAINER="devdigest-hw2f-${ID#hw2f-}"; STACK=(--api "$API" --stack "$ID" --database "$DB" --container "$CONTAINER"); EV="$HOME/.devdigest/hw2-experiments/$ID/evidence"; LEDGER="$HOME/.devdigest/hw2-experiments/$ID/ledger.jsonl"
```

```bash
if [[ "$ID" =~ ^hw2f-[a-z0-9]{4,32}$ ]] && test -s "$LEDGER" && (umask 077 && mkdir -p "$EV/traces"); then echo "evidence directory ready for $ID"; else echo "FAILED: no ledger at $LEDGER (check ID)"; false; fi
```

2. Write the final report:

```bash
pnpm exec tsx src/experiments/hw2/cli.ts report --prereg ../docs/plans/HW2-experiment-preregistration.md "${STACK[@]}" --out "$EV/report.md" > /dev/null
```

3. Export the trace of every run the ledger names, one file per slot.
   - Each trace must be a JSON object whose `experiment.slot_id` is that slot.
   - Anything else (an HTTP error, an empty body, invalid JSON, the wrong slot)
     is listed in `traces/MISSING.txt`.
   - The export continues past a failure, then fails at the end.

```bash
python3 -I - "$EV" "$LEDGER" "$API" <<'EOF'
import json, pathlib, sys, urllib.error, urllib.request
ev, ledger, api = sys.argv[1:4]
runs = {}
for line in open(ledger):
    event = json.loads(line)
    if event.get("run_id"):
        runs[event["slot_id"]] = event["run_id"]
missing = []
for slot, run in sorted(runs.items()):
    target = pathlib.Path(ev, "traces", f"{slot}.json")
    try:
        with urllib.request.urlopen(f"{api}/runs/{run}/trace", timeout=30) as response:
            body = response.read()
        trace = json.loads(body)
        if not isinstance(trace, dict) or (trace.get("experiment") or {}).get("slot_id") != slot:
            raise ValueError("not this slot's trace")
        target.write_bytes(body)
    except (urllib.error.URLError, ValueError) as err:
        target.unlink(missing_ok=True)
        missing.append(f"{slot} {run} {err}")
pathlib.Path(ev, "traces", "MISSING.txt").write_text("".join(m + "\n" for m in missing))
print(f"{len(runs) - len(missing)} of {len(runs)} traces exported")
if not runs:
    sys.exit("FAILED: the ledger names no run, so there is nothing to export")
if missing:
    sys.exit(f"FAILED: {len(missing)} trace(s) not exported, see traces/MISSING.txt. Do not stop the stack.")
EOF
```

4. Dump the run, trace, review and finding rows (data only):

```bash
(umask 077 && docker exec "$CONTAINER" pg_dump -U devdigest -d "$DB" --data-only -t agent_runs -t run_traces -t reviews -t findings -t agents -t agent_skills -t skills > "$EV/db-data.sql") || { echo "FAILED: pg_dump"; false; }
```

5. Rows 19 and 20, by hand, on `http://localhost:3250`. Save two PNG
   screenshots under these exact names:
   - `$EV/with-skill-trace.png`: a completed **with**-skill trace, whose Skills
     block shows `~N tokens` and only the target skill;
   - `$EV/without-skill-trace.png`: a completed **without**-skill trace, with no
     Skills block.
6. Check that no secret was exported.
   - The script reads the dedicated key into memory and prints only file names
     and what was found, never the key.
   - It prints `clean` and exits 0 only when the evidence directory exists, is
     not empty, and nothing was found; otherwise it exits 1.

```bash
python3 -I - "$EV" <<'EOF'
import json, pathlib, sys
ev = pathlib.Path(sys.argv[1])
if not ev.is_dir() or not any(ev.rglob("*")):
    sys.exit(f"FAILED: no exported evidence in {ev}")
secrets = pathlib.Path.home() / ".devdigest" / "hw2-experiments" / "secrets.json"
key = json.loads(secrets.read_text()).get("OPENROUTER_API_KEY", "") if secrets.exists() else ""
needles = {"the experiment key": key, "an sk-or- key": "sk-or-", "a bearer header": "Bearer "}
hits = [f"{p.relative_to(ev)}: {label}" for p in sorted(ev.rglob("*")) if p.is_file()
        for label, needle in needles.items() if needle and needle in p.read_text(errors="replace")]
if hits:
    sys.exit("FAILED: secret material found:\n" + "\n".join(hits))
print("clean")
EOF
```

7. Check that the export is complete. The last argument is `confirmatory` at
   Gate 4, or `exploration` for stack X, where the report and screenshots do
   not apply. All of these must hold:
   - the report exists and is not empty (confirmatory);
   - the dump holds at least one `run_traces` **record** per exported slot,
     not only the empty `COPY` statement;
   - every required trace exists and is not empty;
   - `traces/MISSING.txt` is empty;
   - both named screenshots exist and are PNG files (confirmatory).

```bash
python3 -I - "$EV" "$LEDGER" confirmatory <<'EOF'
import json, pathlib, sys
ev, ledger, phase = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
if phase not in ("confirmatory", "exploration"):
    sys.exit(f"FAILED: unknown phase {phase!r}; use confirmatory or exploration")
slots = sorted({e["slot_id"] for e in map(json.loads, open(ledger)) if e.get("run_id")})
problems = []
report = ev / "report.md"
if phase == "confirmatory" and (not report.is_file() or report.stat().st_size == 0):
    problems.append("report.md is missing or empty")
dump = ev / "db-data.sql"
trace_rows = 0
if not dump.is_file() or dump.stat().st_size == 0:
    problems.append("db-data.sql is missing or empty")
else:
    in_traces = False
    for line in dump.read_text(errors="replace").splitlines():
        if line.startswith("COPY public.run_traces "):
            in_traces = True
        elif in_traces and line == "\\.":
            in_traces = False
        elif in_traces and line.strip():
            trace_rows += 1
    if trace_rows == 0 or trace_rows < len(slots):
        problems.append(f"db-data.sql holds {trace_rows} run_traces record(s); expected at least {max(len(slots), 1)}")
if not slots:
    problems.append("the ledger names no run")
for slot in slots:
    trace = ev / "traces" / f"{slot}.json"
    if not trace.is_file() or trace.stat().st_size == 0:
        problems.append(f"traces/{slot}.json is missing or empty")
missing = ev / "traces" / "MISSING.txt"
if missing.is_file() and missing.read_text().strip():
    problems.append("traces/MISSING.txt lists traces that were not exported")
for name in ("with-skill-trace.png", "without-skill-trace.png") if phase == "confirmatory" else ():
    shot = ev / name
    if not shot.is_file() or shot.read_bytes()[:8] != b"\x89PNG\r\n\x1a\n":
        problems.append(f"{name} is missing or not a PNG screenshot")
print(f"{phase}: checked {trace_rows} run_traces record(s) and {len(slots)} trace file(s)" + (", the report and 2 screenshots" if phase == "confirmatory" else ""))
if problems:
    sys.exit("FAILED, do not stop the stack:\n" + "\n".join(problems))
print("complete")
EOF
```

8. Record checksums:

```bash
(cd "$EV" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS && wc -l < SHA256SUMS)
```

9. Stop E (Ctrl-C in its terminal) **only** after steps 1, 3, 4, 6 and 7
   succeeded. The ledger and `$EV` stay under
   `~/.devdigest/hw2-experiments/$ID/`, outside git.
10. Commit only normalized, secret-free results, and only after step 6 printed
    `clean`:
    - per-slot results and outcomes from `report.md`, into
      [`HW2-skills-experiments.md`](HW2-skills-experiments.md);
    - the two screenshots.

    Raw traces and `db-data.sql` stay outside git.

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
