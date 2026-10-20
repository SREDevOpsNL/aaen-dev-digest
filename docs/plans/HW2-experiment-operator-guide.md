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

### 3. Unpaid runner commands

Run from `server/`; `$ID` is the printed stack id.

```bash
pnpm exec tsx src/experiments/hw2/cli.ts check --api http://127.0.0.1:3251 --stack $ID --database devdigest_hw2f_${ID#hw2f-} --container devdigest-hw2f-${ID#hw2f-}
```

`check` verifies the stack identity and fails closed on any mismatch: stack id,
disposable database name, a single repository, fixtures present, no PR #3, no
clone of the fixture repo, container labels, a loopback non-development API
port, and that the stack reads the dedicated key file. It checks the file's
path only: whether a key is present is the `openrouter_key_configured` flag of
`GET /experiments/identity`, and `run` refuses without one. It also confirms
both fixture intents are fresh and prints the frozen diff hashes.

```bash
pnpm exec tsx src/experiments/hw2/cli.ts endpoints --api http://127.0.0.1:3251
pnpm exec tsx src/experiments/hw2/cli.ts plan --seed <seed>
pnpm exec tsx src/experiments/hw2/cli.ts manifest --api … --stack … --database … --container … --seed <seed> --rules <rules.json> --reservation <USD per slot> --out manifest.json
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
pnpm exec tsx src/experiments/hw2/cli.ts authorize --phase exploration --authorized-gate 3 --confirm-spend --budget 0.50 --hours 12 \
  --api … --stack … --database … --container …
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
- Slot ids carry their phase (`x-` exploration, `c-` confirmatory).
- Deleting `capability.json` revokes the authorization.

## Paid

### Gate 3: exploration (≤ USD 0.50)

```bash
pnpm exec tsx src/experiments/hw2/cli.ts run --phase exploration --authorized-gate 3 --confirm-spend \
  --api … --stack … --database … --container … --experiment 18 --condition with --count 1 --reservation <USD>
```

Exploration confirms what the implementation must not assume:
- the live `openrouter_metadata` shape;
- which generation id `/generation` accepts;
- the provider's display name (from the slug);
- endpoint prices and limits;
- whether one-item `order` + `only` + `allow_fallbacks: false` routes as intended;
- a viable output cap.

Fixtures and settings may be refined only here.

### Gate 4: confirmatory (≤ USD 1.00)

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

1. Set the stack id, then derive the paths. The id below is **an example**:
   replace it with the `stack id` that `--serve` printed.

```bash
ID=hw2f-0a1b2c3d
```

```bash
EV="$HOME/.devdigest/hw2-experiments/$ID/evidence"; LEDGER="$HOME/.devdigest/hw2-experiments/$ID/ledger.jsonl"
```

```bash
if test -s "$LEDGER" && (umask 077 && mkdir -p "$EV/traces"); then echo "evidence directory ready for $ID"; else echo "FAILED: no ledger at $LEDGER (check ID)"; false; fi
```

2. Write the final report:

```bash
pnpm exec tsx src/experiments/hw2/cli.ts report --prereg ../docs/plans/HW2-experiment-preregistration.md --api http://127.0.0.1:3251 --stack "$ID" --database "devdigest_hw2f_${ID#hw2f-}" --container "devdigest-hw2f-${ID#hw2f-}" --out "$EV/report.md" > /dev/null
```

3. Export the trace of every run the ledger names, one file per slot.
   - Each trace must be a JSON object whose `experiment.slot_id` is that slot.
   - Anything else (an HTTP error, an empty body, invalid JSON, the wrong slot)
     is listed in `traces/MISSING.txt`.
   - The export continues past a failure, then fails at the end.

```bash
python3 -I - "$EV" "$LEDGER" http://127.0.0.1:3251 <<'EOF'
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
(umask 077 && docker exec "devdigest-hw2f-${ID#hw2f-}" pg_dump -U devdigest -d "devdigest_hw2f_${ID#hw2f-}" --data-only -t agent_runs -t run_traces -t reviews -t findings -t agents -t agent_skills -t skills > "$EV/db-data.sql") || { echo "FAILED: pg_dump"; false; }
```

5. Rows 19 and 20, by hand: on `http://localhost:3250`, open a completed
   **with**-skill trace (Skills block with `~N tokens`, only the target skill)
   and a **without**-skill trace (no Skills block). Save a screenshot of each
   as a `.png` in `$EV/`.
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

7. Check that the export is complete. The report, the dump and every required
   trace must exist and be nonempty, the dump must hold `run_traces` data, and
   `traces/MISSING.txt` must be empty:

```bash
python3 -I - "$EV" "$LEDGER" <<'EOF'
import json, pathlib, sys
ev, ledger = pathlib.Path(sys.argv[1]), sys.argv[2]
slots = sorted({e["slot_id"] for e in map(json.loads, open(ledger)) if e.get("run_id")})
problems = []
for name in ("report.md", "db-data.sql"):
    if not (ev / name).is_file() or (ev / name).stat().st_size == 0:
        problems.append(f"{name} is missing or empty")
dump = ev / "db-data.sql"
if dump.is_file() and "COPY public.run_traces" not in dump.read_text(errors="replace"):
    problems.append("db-data.sql holds no run_traces data")
if not slots:
    problems.append("the ledger names no run")
for slot in slots:
    trace = ev / "traces" / f"{slot}.json"
    if not trace.is_file() or trace.stat().st_size == 0:
        problems.append(f"traces/{slot}.json is missing or empty")
missing = ev / "traces" / "MISSING.txt"
if missing.is_file() and missing.read_text().strip():
    problems.append("traces/MISSING.txt lists traces that were not exported")
pngs = len(list(ev.glob("*.png")))
print(f"checked the report, the dump and {len(slots)} traces; {pngs} screenshot(s) present (rows 19 and 20 need 2)")
if problems:
    sys.exit("FAILED, do not stop the stack:\n" + "\n".join(problems))
print("complete")
EOF
```

8. Record checksums:

```bash
(cd "$EV" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS && wc -l < SHA256SUMS)
```

9. Stop E (Ctrl-C in its terminal) **only** after steps 3, 4, 6 and 7 succeeded.
   The ledger and `$EV` stay under `~/.devdigest/hw2-experiments/$ID/`, outside
   git.
10. Commit only normalized, secret-free results, and only after step 6 printed
    `clean`:
    - per-slot results and outcomes from `report.md`, into
      [`HW2-skills-experiments.md`](HW2-skills-experiments.md);
    - the row 19/20 screenshots.

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
