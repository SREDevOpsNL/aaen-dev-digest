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
pnpm exec tsx src/experiments/hw2/cli.ts authorize --phase exploration --authorized-gate 3 --confirm-spend --budget 0.50 --hours 12 "${STACK[@]}"
```

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
in the [Gate 3 plan](HW2-gate3-plan.md).

1. **Start X** (§2). Set `DEVDIGEST_EXPERIMENT_PROVIDER` to the provider's
   routing slug as OpenRouter writes it, `provider[/variant][/region][/tier]`.
   Copy it from the provider's copy button on the model page.
   - A full slug such as `deepinfra/fp8` names one endpoint.
   - A base slug such as `deepinfra` matches **every** endpoint of that
     provider, including ones added later.

   In the runner terminal, set the §3 variables for X and run its checks.
2. **Phase 0, free: the provider's endpoint.** It must exist for the slug (one
   endpoint for a full slug), advertise `structured_outputs` (the request
   requires every parameter it sends, see
   [One request](#one-request)) and be up. This reads OpenRouter's public
   model metadata; no key is sent.

```bash
SLUG=deepinfra/fp8   # EXAMPLE: the routing slug X was started with
```

```bash
python3 -I - "$SLUG" <<'EOF'
import json, sys, urllib.request
slug = sys.argv[1]
request = urllib.request.Request("https://openrouter.ai/api/v1/models/deepseek/deepseek-v4-flash/endpoints", headers={"User-Agent": "devdigest-hw2-phase0"})
endpoints = json.load(urllib.request.urlopen(request, timeout=30))["data"]["endpoints"]
base = slug.split("/")[0]
matching = [e for e in endpoints if e.get("tag") == slug or (slug == base and (e.get("tag") or "").split("/")[0] == base)]
problems = []
if not matching:
    problems.append(f"no endpoint matches {slug}")
if slug != base and len(matching) != 1:
    problems.append(f"{len(matching)} endpoints match the full slug {slug}")
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

3. **Phase 0, free: condition-faithful previews.** The preview API builds the
   prompt from the reviewer's **current** links, and its `condition` is only a
   label. The runner's `preview` command therefore does the following, and
   returns nonzero on any mismatch:
   - links exactly what a slot of that condition links (the target skill, or
     none);
   - checks the links and the Skill fingerprint;
   - prints the input bound and the worst case;
   - always restores the original links.

```bash
pnpm exec tsx src/experiments/hw2/cli.ts preview "${STACK[@]}" --experiment 18 --condition with --reservation 0.02
```

```bash
pnpm exec tsx src/experiments/hw2/cli.ts preview "${STACK[@]}" --experiment 18 --condition without --reservation 0.02
```

```bash
pnpm exec tsx src/experiments/hw2/cli.ts preview "${STACK[@]}" --experiment 17 --condition with --reservation 0.02
```

```bash
pnpm exec tsx src/experiments/hw2/cli.ts preview "${STACK[@]}" --experiment 17 --condition without --reservation 0.02
```

   Choose the per-slot reservation as the smallest round value of at least
   1.2 × the largest `worst_case_usd` printed, and at most USD 0.05.
4. **Authorize.** Only after Gate 3 is explicitly authorized, create the
   exploration capability
   ([Authorizing a paid phase](#authorizing-a-paid-phase-server-side-capability)).
   The [Gate 3 plan](HW2-gate3-plan.md) proposes `--budget 0.15`, below the
   0.50 cap.
5. **Run.** Set the reservation for one exploration slot, validate it, then run
   one slot per invocation, and judge each from the ledger and the trace, never
   from the exit code ([Gate 3 plan](HW2-gate3-plan.md)):

```bash
X_RESERVATION=0.05   # EXAMPLE: USD reserved for this exploration slot
```

```bash
python3 -I - "$X_RESERVATION" <<'EOF'
import sys
try:
    usd = float(sys.argv[1])
except ValueError:
    sys.exit(f"FAILED: X_RESERVATION={sys.argv[1]!r} is not a number")
if not 0 < usd <= 0.50:
    sys.exit("FAILED: X_RESERVATION must be > 0 and <= USD 0.50, the exploration cap")
print("exploration reservation is valid")
EOF
```

```bash
pnpm exec tsx src/experiments/hw2/cli.ts run --phase exploration --authorized-gate 3 --confirm-spend "${STACK[@]}" --experiment 18 --condition with --count 1 --reservation "$X_RESERVATION"
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
   `charge()`. Pass every ledger of this experiment, X's and E's, because
   exploration counts toward the USD 1.50 total. It reads the ledgers only.

```bash
X_ID=hw2f-11aa22bb   # EXAMPLE: replace with the exploration stack's id
```

```bash
python3 -I - "$HOME/.devdigest/hw2-experiments/$X_ID/ledger.jsonl" "$HOME/.devdigest/hw2-experiments/$ID/ledger.jsonl" <<'EOF'
import json, sys
TERMINAL = {"completed", "failed", "refused", "ambiguous"}
slots = {}
for path in sys.argv[1:]:
    for line in open(path):
        if not line.strip():
            continue
        event = json.loads(line)
        current = slots.get(event["slot_id"])
        if current and current["state"] in TERMINAL:
            continue
        slots[event["slot_id"]] = {"state": event["state"], "phase": event["phase"], "reservation": event["reservation_usd"], "cost": event.get("cost_usd")}
def charge(slot):
    if slot["state"] == "refused":
        return 0.0
    if slot["state"] in ("completed", "failed") and slot["cost"] is not None:
        return slot["cost"]
    return slot["reservation"]
spent = {phase: sum(charge(s) for s in slots.values() if s["phase"] == phase) for phase in ("exploration", "confirmatory")}
total = spent["exploration"] + spent["confirmatory"]
for state in sorted({s["state"] for s in slots.values()}):
    print(f"{state}: {', '.join(sorted(k for k, s in slots.items() if s['state'] == state))}")
print(f"charged: exploration ${spent['exploration']:.6f}, confirmatory ${spent['confirmatory']:.6f}, total ${total:.6f}")
print(f"remaining confirmatory budget at most ${max(0.0, min(1.00 - spent['confirmatory'], 1.50 - total)):.6f}")
print("never replay: " + (", ".join(sorted(k for k, s in slots.items() if s["state"] != "refused")) or "(none)"))
EOF
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
