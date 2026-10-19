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
pnpm exec tsx src/experiments/hw2/cli.ts endpoints --api http://127.0.0.1:3251
pnpm exec tsx src/experiments/hw2/cli.ts plan --seed <seed>
pnpm exec tsx src/experiments/hw2/cli.ts manifest --api … --stack … --database … --container … --seed <seed> --rules <rules.json> --reservation <USD per slot> --out manifest.json
```

- `endpoints` lists the model's live provider endpoints: prices, limits, tags.
  It is OpenRouter metadata, not a generation, but needs the key file.
- `plan` prints the 20-slot balanced, seeded schedule.
- `manifest` builds the canonical manifest and its fingerprint. It refuses
  unless 20 × the per-slot reservation fits USD 1.00.

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
3. Run:

```bash
pnpm exec tsx src/experiments/hw2/cli.ts run --phase confirmatory --authorized-gate 4 --confirm-spend \
  --prereg ../docs/plans/HW2-experiment-preregistration.md --rules <rules.json> \
  --api … --stack … --database … --container …
```

The run refuses unless:
- the preregistration is committed and unmodified;
- its manifest fingerprint equals the one recomputed from the current code, stack and content.

It runs the frozen 20 slots in order, one at a time, and never replays a slot.

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

Ineligible slots stay in the report.

## Not claimed

- The requested provider is intent, not evidence.
- Live response shapes are confirmed only at Gate 3.
- Temperature 0 and a pinned provider do not make outputs deterministic.
- Five trials per condition is a small sample.
