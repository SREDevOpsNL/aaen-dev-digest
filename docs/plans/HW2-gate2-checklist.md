# HW2 Gate 2 — dedicated OpenRouter key and spending limit

Gate 2 of plan rev. 4.3 ([operator guide](HW2-experiment-operator-guide.md)).
Gate 2 makes **no paid request and authorizes none**. Paid exploration (Gate 3,
≤ USD 0.50) and confirmatory runs (Gate 4, ≤ USD 1.00) each need their own
explicit authorization.

**Status (2026-10-19):** prepared, not started. No key file, no spending
capability and no experiment stack exist yet.

## Why the key needs its own limit

The runner and the server enforce the caps themselves: USD 0.50 for
exploration, USD 1.00 for confirmatory runs and USD 1.50 in total. The key's
OpenRouter limit is a separate, outer control. If the runner's accounting were
ever wrong, OpenRouter would still refuse requests once the key's own limit is
spent.

OpenRouter checks a key's remaining limit **before** it admits a request and
charges the request **when it finishes**. A request admitted while some limit
remains can therefore finish above the limit: the documentation's example error
reads "$52.00 of $50.00 used". The runner sends one request at a time, so the
overshoot is at most one slot's cost. A refused request fails with 402 or 403;
the documentation gives both. The error's `error.metadata.limit_source` is
`openrouter_key_limit`. Sources:
[limits](https://openrouter.ai/docs/api-reference/limits),
[get current key](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key),
[create key](https://openrouter.ai/docs/api/api-reference/api-keys/create-a-new-api-key)
(read 2026-10-19).

## Requirements

| # | Requirement | Why | Checked by |
| --- | --- | --- | --- |
| K1 | A **new** OpenRouter key used only for these experiments, not the everyday key in `~/.devdigest/secrets.json` or `$OPENROUTER_API_KEY` | The limit bounds only what is spent through this key | step C |
| K2 | Spending limit (`limit`) of about **USD 2.00**, not unlimited (`null`) | Above the runner's USD 1.50 total, with margin for one in-flight request | step D |
| K3 | **No reset** (`limit_reset: null`) | A daily, weekly or monthly reset refills the limit at midnight UTC | step D |
| K4 | BYOK usage counts toward the limit (`include_byok_in_limit: true`), or the account has no BYOK provider keys | Otherwise BYOK spend bypasses the limit | step D |
| K5 | An ordinary key, not a Management key (`is_management_key: false`) | Management keys cannot call completions | step D |
| K6 | Recommended: an expiry (`expires_at`) shortly after the planned Gate 4 window, for example 14 days | Limits exposure if the key leaks | step D |
| K7 | The file `~/.devdigest/hw2-experiments/secrets.json`: mode 0600 in a 0700 directory, holding exactly one entry, `OPENROUTER_API_KEY` | The experiment stack reads only this file, never `process.env`; nothing in the code checks the mode | step C |
| K8 | The key file exists **before** the experiment stack starts | The server reads the key file once and caches the result for the life of the process, including "no file". A key written later is invisible until a restart, and deleting the file does not remove the key from a running server (`server/src/adapters/secrets/local.ts`, `LocalSecretsProvider.load`) | step E |

The key's value is never pasted into a chat, a commit, a PR, an issue or a log.
Every command below prints at most a boolean, file modes, entry names or the
limit fields.

## Steps (only after Gate 2 is authorized)

### A. Create the key (you, OpenRouter dashboard)

Create a key named, for example, `devdigest-hw2-experiments` with K2–K6. The
documentation pages above describe these fields on the key API (`limit`,
`limit_reset`, `include_byok_in_limit`, `expires_at`), not the dashboard form.
Step D verifies them on the key itself, whichever way they were set.

### B. Write the key file (you, WSL terminal)

```bash
mkdir -p ~/.devdigest/hw2-experiments && chmod 700 ~/.devdigest/hw2-experiments
```

```bash
read -rs -p 'Dedicated OpenRouter key: ' HW2_KEY && echo
```

```bash
(umask 077 && printf '{ "OPENROUTER_API_KEY": "%s" }\n' "$HW2_KEY" > ~/.devdigest/hw2-experiments/secrets.json) && unset HW2_KEY
```

- `read -s` keeps the key out of the shell history and off the screen.
- `printf` is a bash builtin, so the key never appears in any process's
  argument list.
- `umask 077` creates the file as 0600 from the start. Writing first and running
  `chmod` afterwards would leave a short window in which the file is readable by
  others.

### C. Local checks (no network)

```bash
python3 -I - <<'EOF'
import json, os, stat
home = os.path.expanduser("~/.devdigest")
d, f = f"{home}/hw2-experiments", f"{home}/hw2-experiments/secrets.json"
print("modes", oct(stat.S_IMODE(os.stat(d).st_mode)), oct(stat.S_IMODE(os.stat(f).st_mode)))
data = json.load(open(f))
print("entries", sorted(data))
key = data.get("OPENROUTER_API_KEY")
print("sk-or- key", isinstance(key, str) and key.startswith("sk-or-"))
try:
    everyday = json.load(open(f"{home}/secrets.json")).get("OPENROUTER_API_KEY")
except (OSError, ValueError):
    everyday = None
print("distinct", key not in {everyday, os.environ.get("OPENROUTER_API_KEY")})
EOF
```

Expect:

- `modes 0o700 0o600` (K7);
- `entries ['OPENROUTER_API_KEY']` (K7). Malformed JSON fails here. The server
  would silently treat it as "no key";
- `sk-or- key True`;
- `distinct True` (K1). The keys are compared in memory and never printed.

### D. Key limit check (one free metadata request to OpenRouter)

```bash
python3 -I -c 'import json, os; print("Authorization: Bearer " + json.load(open(os.path.expanduser("~/.devdigest/hw2-experiments/secrets.json")))["OPENROUTER_API_KEY"])' | curl -sS --fail-with-body -H @- https://openrouter.ai/api/v1/key | python3 -I -c 'import json, sys; d = json.load(sys.stdin)["data"]; print(json.dumps({k: d.get(k) for k in ("limit", "limit_remaining", "limit_reset", "include_byok_in_limit", "usage", "is_management_key", "expires_at")}, indent=2))'
```

Expect:
- `limit` about 2 and `limit_remaining` about 2;
- `usage` 0 for a new key;
- `limit_reset: null`;
- `include_byok_in_limit: true`, or no BYOK keys on the account;
- `is_management_key: false`;
- the chosen `expires_at`.

`-H @-` makes curl read the header from stdin, so the key stays out of every
argument list. The projection leaves out `label`, which shows a masked fragment
of the key. `GET /api/v1/key` is not a generation, and the limits page
recommends calling it routinely. The documentation does not state that it is
free.

### E. Stack-side checks (no paid request)

This step needs a `--serve` stack started **after** step B (K8).
`scripts/e2e.sh --serve` requires the five `DEVDIGEST_EXPERIMENT_*` values
([operator guide §2](HW2-experiment-operator-guide.md#2-start-a-disposable-stack)).
Before exploration, provisional values are enough: no spending capability
exists, so every slot is refused before it reaches the provider.

```bash
curl -sS http://127.0.0.1:3251/experiments/identity | python3 -I -c 'import json, sys; d = json.load(sys.stdin); print(json.dumps({k: d.get(k) for k in ("stack_id", "database", "database_is_disposable", "secrets_path", "openrouter_key_configured", "in_flight_slot")}, indent=2))'
```

Expect:
- `secrets_path` ending in `/.devdigest/hw2-experiments/secrets.json`;
- `openrouter_key_configured: true`. This is a boolean; the route never
  returns the key;
- `database_is_disposable: true`;
- `in_flight_slot: null`.

Then run the runner's `check` (operator guide §3). It verifies isolation and
that the stack reads the dedicated key file *path*. It does not report whether
a key is present; that is the `openrouter_key_configured` flag above. `run`
refuses when the flag is false.

Optional, also free: `endpoints` (operator guide §3) lists the model's live
provider endpoints, prices and limits through the key. That is input for the
Gate 3 request. Include it only if your Gate 2 authorization covers it.

### F. Confirmation (you)

Send a confirmation that contains no key material:

- key name: `…`;
- step D output, the JSON projection above;
- step C results: modes `0o700`/`0o600`, `OPENROUTER_API_KEY` only, `distinct True`;
- step E result: `openrouter_key_configured: true` on stack `hw2f-…`;
- the statement "Gate 2 confirmed; this does not authorize Gate 3."

## Not part of Gate 2

- No `authorize` (no `capability.json`), no `run`, no paid exploration or
  confirmatory slot.
- No change to the development database or demo PR #3.
- No commit of the key file or of anything under `~/.devdigest/`.

## Revoking

- **The key:** disable or delete it at OpenRouter, delete
  `~/.devdigest/hw2-experiments/secrets.json`, and stop or restart any running
  experiment stack, because the server keeps the key it read at startup (K8).
- **A spending authorization:** delete `capability.json`. The server rereads it
  for every slot ([operator guide](HW2-experiment-operator-guide.md#authorizing-a-paid-phase-server-side-capability)).
