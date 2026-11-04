# Free experiment preflight (no generation)

## Current: rerun at `e78fe0b` (2026-10-25, stack `hw2f-7d16304f`)

This run supersedes the one at `968edbd` below, which is kept as it was
recorded. Same pilot values, no capability, no generation.

| Check | Result |
| --- | --- |
| `check` | PR #501 diff `8e0ba133…`, PR #502 diff `db6475df…` (unchanged); implementation fingerprint `16481ec6817ab607…`; isolation checks passed |
| `endpoints` | exactly 1 endpoint tagged `deepinfra/fp8`, pricing 9e-8 / 1.8e-7 USD per token, equal to the configured prices |
| `phase0-check` over the 4 condition previews | pass |

| Slot | Links | Prompt skills | Skill fingerprint | Non-Skill fingerprint | Input bound | Worst case | Reservation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `x-17-with-1` | condition | Edge Cases and Error Paths | `18efa8660db5…` | `e89e033babd0…` | 9475 | $0.00560 | $0.01 |
| `x-17-without-1` | condition | — | `4f53cda18c2b…` | `e89e033babd0…` | 8968 | $0.00553 | $0.01 |
| `x-18-with-1` | condition | breaking-change | `03214820cdbc…` | `baa2505e57b9…` | 10922 | $0.00579 | $0.01 |
| `x-18-without-1` | condition | — | `4f53cda18c2b…` | `baa2505e57b9…` | 8880 | $0.00552 | $0.01 |
| `x-18-with-2` (trace-only) | operator, before the drag | breaking-change, response-schema, semver-discipline | `f6808b43eaf7…` | `baa2505e57b9…` | 14420 | $0.00627 | $0.01 |
| `x-18-with-2` (trace-only) | **operator, after the drag** (response-schema off for this agent) | semver-discipline, breaking-change | **`b4978ce07152…`** | `baa2505e57b9…` | 12589 | $0.00602 | $0.01 |

The post-drag fingerprint `b4978ce07152b569aab7d82c2ea2290af54833c2312fa8157377f8f1a49fa0d6`
is the `--expect-skill-fingerprint` for `x-18-with-2`. The full check is in
[drag-verification.md](drag-verification.md). The later Skills-tab UX commit
`a4bbdde` changes only `client/`, which is outside the implementation
fingerprint: `check` still reports `16481ec6817ab607…`.

- The fingerprints of the four comparison slots equal the `968edbd` run's.
- `x-18-with-2` is the `--keep-links` slot: recorded `purpose: trace-evidence`,
  excluded from experiment 18's comparison ([EXPERIMENTS.md](../EXPERIMENTS.md#the-trace-evidence-slot-is-trace-only)).
  Its row above is the arrangement before the physical drag. The post-drag
  preview, whose fingerprint `run --keep-links --expect-skill-fingerprint`
  must match, is added after the drag.
- The pre-drag fingerprint `f6808b43…` was also computed independently from
  the skill bodies on the stack; it matches.
- The previews restored the reviewer's links and switches: order
  breaking-change, response-schema, semver-discipline, all on.
- Key (free `GET /api/v1/key`): usage $0.00040788, limit $2, remaining
  $1.99959212, equal to the recorded opening.
- Shared ledger absent, no `runner.lock` or `authorize.lock`, no
  `capability.json` anywhere under `~/.devdigest`. Leftover `capability.token`
  files (main's stacks `hw2f-39febf41` and `hw2f-f53ed971`, and simulation
  homes under `integration-20261024b/sim/`) have no capability beside them and
  authorize nothing.

## Superseded: run at `968edbd`

Stack `hw2f-d3a2fb37` started from `968edbd` with `scripts/e2e.sh --serve` and the pilot values DEVDIGEST_EXPERIMENT_PROVIDER=deepinfra/fp8, MODEL=deepseek/deepseek-v4-flash, MAX_OUTPUT_TOKENS=16000, PRICE_INPUT=0.00000009, PRICE_OUTPUT=0.00000018 (USD per token). No capability exists, so no generation is possible.

## Stack identity and isolation
```
$ pnpm exec tsx src/experiments/hw2/cli.ts check
PR #501: seeded; frozen diff sha256 8e0ba13345806d37f29233f6ba28057f52fd17c010ce0a482267b8cbc527d186
PR #502: seeded; frozen diff sha256 db6475df8244efc5ef4a323a07bf0b1433abf0a6bc820ef2229dc409868116fc
implementation fingerprint af490de395aa0857e0e295edcc5bb01d906d5756cd6b0a18fca41c065e3160b0
stack hw2f-d3a2fb37 on devdigest_hw2f_d3a2fb37: isolation checks passed
(exit 0)
```

## Live endpoints of the frozen model
```
$ pnpm exec tsx src/experiments/hw2/cli.ts endpoints
{
  "model": "deepseek/deepseek-v4-flash",
  "endpoints": [
    {
      "providerName": "Relace",
      "tag": "relace/fp4",
      "quantization": "fp4",
      "contextLength": 1048576,
      "maxCompletionTokens": 943718,
      "pricing": {
        "prompt": 2.11e-8,
        "completion": 4.5e-7,
        "request": 0
      }
    },
    {
      "providerName": "Baidu",
      "tag": "baidu/fp8",
      "quantization": "fp8",
      "contextLength": 1048576,
      "maxCompletionTokens": 131072,
      "pricing": {
        "prompt": 2.226e-8,
        "completion": 4.452e-8,
        "request": 0
      }
    },
    {
      "providerName": "StreamLake",
      "tag": "streamlake/fp8",
      "quantization": "fp8",
      "contextLength": 1024000,
      "maxCompletionTokens": 384000,
      "pricing": {
        "prompt": 2.8e-8,
        "completion": 5.6e-8,
        "request": 0
      }
    },
    {
      "providerName": "DeepInfra",
      "tag": "deepinfra/fp8",
      "quantization": "fp8",
      "contextLength": 1048576,
      "maxCompletionTokens": 65536,
      "pricing": {
        "prompt": 9e-8,
        "completion": 1.8e-7,
        "request": 0
      }
    },
    {
      "providerName": "GMICloud",
      "tag": "gmicloud/fp8",
      "quantization": "fp8",
      "contextLength": 1048575,
      "maxCompletionTokens": 943717,
      "pricing": {
        "prompt": 9.1e-8,
        "completion": 1.82e-7,
        "request": 0
      }
    },
    {
      "providerName": "Venice",
      "tag": "venice",
      "quantization": "unknown",
      "contextLength": 1000000,
      "maxCompletionTokens": 32768,
      "pricing": {
        "prompt": 9.66e-8,
        "completion": 1.925e-7,
        "request": 0
      }
    },
    {
      "providerName": "DigitalOcean",
      "tag": "digitalocean",
      "quantization": "unknown",
      "contextLength": 1048576,
      "maxCompletionTokens": 384000,
      "pricing": {
        "prompt": 9.8e-8,
        "completion": 1.96e-7,
        "request": 0
      }
    },
    {
      "providerName": "SiliconFlow",
      "tag": "siliconflow/fp8",
      "quantization": "fp8",
      "contextLength": 1048576,
      "maxCompletionTokens": 393216,
      "pricing": {
        "prompt": 1.3e-7,
        "completion": 2.8e-7,
        "request": 0
      }
    },
    {
      "providerName": "AtlasCloud",
      "tag": "atlas-cloud/fp4",
      "quantization": "fp4",
      "contextLength": 1048576,
      "maxCompletionTokens": 393216,
      "pricing": {
        "prompt": 1.4e-7,
        "completion": 2.8e-7,
        "request": 0
      }
    },
    {
      "providerName": "Parasail",
      "tag": "parasail/fp8",
      "quantization": "fp8",
      "contextLength": 1048576,
      "maxCompletionTokens": 943718,
      "pricing": {
        "prompt": 1.4e-7,
        "completion": 2.8e-7,
        "request": 0
      }
    },
    {
      "providerName": "Alibaba",
      "tag": "alibaba/fp8/us-east-1",
      "quantization": "fp8",
      "contextLength": 1000000,
      "maxCompletionTokens": 393216,
      "pricing": {
        "prompt": 1.5e-7,
        "completion": 3e-7,
        "request": 0
      }
    },
    {
      "providerName": "Mancer 2",
      "tag": "mancer/fp8",
      "quantization": "fp8",
      "contextLength": 1048576,
      "maxCompletionTokens": 943718,
      "pricing": {
        "prompt": 1.9e-7,
        "completion": 5e-7,
        "request": 0
      }
    },
    {
      "providerName": "Azure",
      "tag": "azure/us",
      "quantization": "unknown",
      "contextLength": 1048576,
      "maxCompletionTokens": 384000,
      "pricing": {
        "prompt": 2.1e-7,
        "completion": 5.6e-7,
        "request": 0
      }
    },
    {
      "providerName": "Cloudflare",
      "tag": "cloudflare",
      "quantization": "unknown",
      "contextLength": 384000,
      "maxCompletionTokens": 345600,
      "pricing": {
        "prompt": 4.4e-7,
        "completion": 0.00000132,
        "request": 0
      }
    },
    {
      "providerName": "Wafer",
      "tag": "wafer/mxfp4",
      "quantization": "mxfp4",
      "contextLength": 1048576,
      "maxCompletionTokens": 943718,
      "pricing": {
        "prompt": 6e-7,
        "completion": 1.7e-7,
        "request": 0
      }
    }
  ]
}
(exit 0)
```

## Preview: experiment 17, without skill
```
$ pnpm exec tsx src/experiments/hw2/cli.ts preview --experiment 17 --condition without --reservation 0.01
{
  "ok": true,
  "problems": [],
  "experiment": "17",
  "condition": "without",
  "reviewer": "Test Quality Reviewer",
  "target_skill": "Edge Cases and Error Paths",
  "linked_skills": [],
  "refusal_reason": null,
  "input_upper_bound": 8968,
  "output_cap": 16000,
  "price_input_per_token": 9e-8,
  "price_output_per_token": 1.8e-7,
  "price_source": "max(frozen config, 1 live endpoint(s): deepinfra/fp8)",
  "worst_case_usd": 0.00553068,
  "reservation_usd": 0.01,
  "non_skill_fingerprint": "e89e033babd0d53381084576f46cf1c3d1324e0ef4eb828fb2c96989639b0dd4",
  "skill_fingerprint": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  "expected_skill_fingerprint": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
}
(exit 0)
```

## Preview: experiment 17, with skill
```
$ pnpm exec tsx src/experiments/hw2/cli.ts preview --experiment 17 --condition with --reservation 0.01
{
  "ok": true,
  "problems": [],
  "experiment": "17",
  "condition": "with",
  "reviewer": "Test Quality Reviewer",
  "target_skill": "Edge Cases and Error Paths",
  "linked_skills": [
    "Edge Cases and Error Paths"
  ],
  "refusal_reason": null,
  "input_upper_bound": 9475,
  "output_cap": 16000,
  "price_input_per_token": 9e-8,
  "price_output_per_token": 1.8e-7,
  "price_source": "max(frozen config, 1 live endpoint(s): deepinfra/fp8)",
  "worst_case_usd": 0.005599125,
  "reservation_usd": 0.01,
  "non_skill_fingerprint": "e89e033babd0d53381084576f46cf1c3d1324e0ef4eb828fb2c96989639b0dd4",
  "skill_fingerprint": "18efa8660db55161b35cb59dc198210af01a90d2eccf607ca542f2d55c3d83f2",
  "expected_skill_fingerprint": "18efa8660db55161b35cb59dc198210af01a90d2eccf607ca542f2d55c3d83f2"
}
(exit 0)
```

## Preview: experiment 18, without skill
```
$ pnpm exec tsx src/experiments/hw2/cli.ts preview --experiment 18 --condition without --reservation 0.01
{
  "ok": true,
  "problems": [],
  "experiment": "18",
  "condition": "without",
  "reviewer": "API Contract Reviewer",
  "target_skill": "breaking-change",
  "linked_skills": [],
  "refusal_reason": null,
  "input_upper_bound": 8880,
  "output_cap": 16000,
  "price_input_per_token": 9e-8,
  "price_output_per_token": 1.8e-7,
  "price_source": "max(frozen config, 1 live endpoint(s): deepinfra/fp8)",
  "worst_case_usd": 0.005518799999999999,
  "reservation_usd": 0.01,
  "non_skill_fingerprint": "baa2505e57b9ce11236f2c71e245f3c905493e84840c375ad9b765867bcdac84",
  "skill_fingerprint": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  "expected_skill_fingerprint": "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"
}
(exit 0)
```

## Preview: experiment 18, with skill
```
$ pnpm exec tsx src/experiments/hw2/cli.ts preview --experiment 18 --condition with --reservation 0.01
{
  "ok": true,
  "problems": [],
  "experiment": "18",
  "condition": "with",
  "reviewer": "API Contract Reviewer",
  "target_skill": "breaking-change",
  "linked_skills": [
    "breaking-change"
  ],
  "refusal_reason": null,
  "input_upper_bound": 10922,
  "output_cap": 16000,
  "price_input_per_token": 9e-8,
  "price_output_per_token": 1.8e-7,
  "price_source": "max(frozen config, 1 live endpoint(s): deepinfra/fp8)",
  "worst_case_usd": 0.0057944699999999995,
  "reservation_usd": 0.01,
  "non_skill_fingerprint": "baa2505e57b9ce11236f2c71e245f3c905493e84840c375ad9b765867bcdac84",
  "skill_fingerprint": "03214820cdbc9c3cda85f055c23adf337bcc5abdfa341c795ba62039d9f95136",
  "expected_skill_fingerprint": "03214820cdbc9c3cda85f055c23adf337bcc5abdfa341c795ba62039d9f95136"
}
(exit 0)
```

## Dedicated key, ledger and capabilities (before any paid slot)
```
$ ls -l ~/.devdigest/hw2-experiments/ledger.jsonl ~/.devdigest/hw2-experiments/key-usage.jsonl
ls: cannot access '~/.devdigest/hw2-experiments/ledger.jsonl': No such file or directory
ls: cannot access '~/.devdigest/hw2-experiments/key-usage.jsonl': No such file or directory
$ for d in ~/.devdigest/hw2-experiments/hw2f-*; do ls $d/capability.json $d/capability.token; done   # any live capability?
.devdigest/hw2-experiments/hw2f-39febf41/capability.token
.devdigest/hw2-experiments/hw2f-f53ed971/capability.token
live capability files: 2
$ ls ~/.devdigest/hw2-experiments/authorize.lock ~/.devdigest/hw2-experiments/runner.lock
ls: cannot access '~/.devdigest/hw2-experiments/authorize.lock': No such file or directory
ls: cannot access '~/.devdigest/hw2-experiments/runner.lock': No such file or directory
$ pnpm exec tsx src/experiments/hw2/cli.ts key-usage --opening
opening key usage $0.00040788 (limit 2, remaining 1.99959212)
(exit 0)
$ cat ~/.devdigest/hw2-experiments/key-usage.jsonl
{"at":"2026-10-25T09:21:20.970Z","kind":"opening","usage":0.00040788,"limit":2,"limit_remaining":1.99959212}
```

Reading of the above:
- **Key:** limit $2.00, opening usage $0.00040788, remaining $1.99959212, recorded as the opening reading before any paid slot of this branch.
- **Shared ledger** (`~/.devdigest/hw2-experiments/ledger.jsonl`): does not exist yet. No slot has been reserved on this branch, and no runner or authorize lock is held.
- **Capabilities:** no `capability.json` exists on any stack, so no capability can spend. The two `capability.token` files belong to `main`'s closed exploration stacks X (`hw2f-f53ed971`) and X2 (`hw2f-39febf41`); a token without its capability authorizes nothing.
- **Main's per-stack ledgers:** every slot is terminal.
  - X: `x-18-with-1` completed, $0.00022896; `x-18-without-1` failed (HTTP 429).
  - X2: `x-18-without-1` completed, $0.00017892; `x-17-with-1` failed (HTTP 429).
  - Confirmed total $0.00040788, equal to the key's opening usage, so the two 429s cost nothing in fact.
