# Criteria 14, 19, 20 after the system-role change (Approach B)

| Item | Value |
| --- | --- |
| Date | 2026-10-30 |
| Stack | `hw2f-15473bbf`: web `http://localhost:3250`, API `http://127.0.0.1:3251`, Postgres container `devdigest-hw2f-15473bbf`, database `devdigest_hw2f_15473bbf` |
| Source | uncommitted working tree on top of `c77dea2` (Skills in the system-role message + Skill-content approval gate) |
| Spending | none. No `cli.ts authorize/run/key-usage`, no capability file (`~/.devdigest/hw2-experiments/hw2f-15473bbf/` holds only `clones`), no armed slot (`armed_slot: null`) |
| Browser | agent-browser 0.27.0, own session (`verif14b`), viewport 1440×1000 |

This file adds to, and does not replace, the historical evidence in
[drag-verification.md](drag-verification.md) and
[trace-evidence.md](trace-evidence.md). Those were recorded at `e78fe0b`,
when Skill bodies were still in the user message.

## What was shown where

| Item | On the stack, at runtime | Only by deterministic injected-provider tests |
| --- | --- | --- |
| 14.1 Drag changes the persisted order | yes: CDP pointer drag, API and SQL | — |
| 14.2 Persisted order = order in the system message and the trace | the order of the Skills section the server builds (free preview fingerprint) | system role, the place between instructions and guard, the persisted trace |
| 14.3 Disabled skill is excluded and needs no approval | yes: API, SQL, free preview, UI warning | the run trace and the provider request |
| 14.4 Unapproved skill rejected before dispatch; approve, stale, revoke; audit | yes: UI Run Review, run log, ledger, UI, API, SQL | — |
| 14.5/14.6, 19, 20 Skills block, `skills_tokens`, block per enabled skill in the trace | no (no successful run without a model call) | yes |

A successful run, and so a persisted trace with Skills in the system message,
needs a real model call. None was authorized. A live trace for rows 14, 19
and 20 under the current source would need **one separately authorized,
paid, trace-only run**.

## Harness notes

- **API base in the client bundle.** While this check ran, a concurrent e2e
  run started a second `next dev` (port 3200, `NEXT_PUBLIC_API_BASE=http://localhost:3201`)
  in the same `client/` directory. The two dev servers share `client/.next`,
  and the 3250 page loaded with `localhost:3201` compiled in ("Cannot reach
  the DevDigest engine at http://localhost:3201"). Nothing was restarted.
  The browser session was started with an init script that rewrites
  `http://localhost:3201` to `http://localhost:3251` in `fetch` and
  `EventSource` before the page's code runs. The UI code is the code served;
  only its API base was redirected. Every request below is logged as going to
  `localhost:3251`.
- **Provider key.** `GET /experiments/identity` reports
  `openrouter_key_configured: true` (`secrets_path` is the shared
  `~/.devdigest/hw2-experiments/secrets.json`), so the stack is not keyless in
  that sense. It still cannot spend: in experiment mode the provider is wrapped
  by `ExperimentGuardedProvider`, which refuses any structured call without an
  experiment slot (`server/src/platform/experiment-spend-gate.ts`), and no
  slot is armed and no capability exists.
- **Free preview.** `cli.ts preview --keep-links` (and `POST /experiments/preview`)
  sends no model request. Its price check reads the provider's endpoint list
  (`price_source: "max(frozen config, 1 live endpoint(s): deepinfra/fp8)"`),
  a free metadata request.

## 14.1 Pointer drag changes the persisted order

Agent **API Contract Reviewer** (`52b12eb0-b3dd-4948-ac9d-b3e509a8395e`),
Skills tab. Before:

```
$ curl -s http://127.0.0.1:3251/agents/52b12eb0…/skills
{'order': 0, 'skill': 'breaking-change',   'enabled': True, 'link_enabled': True, 'approval': 'approved'}
{'order': 1, 'skill': 'response-schema',   'enabled': True, 'link_enabled': True, 'approval': 'approved'}
{'order': 2, 'skill': 'semver-discipline', 'enabled': True, 'link_enabled': True, 'approval': 'approved'}
```

Screenshot: [35-skills-tab-before-cdp-drag](screenshots/35-skills-tab-before-cdp-drag.png).

**Method: a pointer drag through the Chrome DevTools Protocol, not the arrow
buttons.** `agent-browser drag` cannot start an HTML5 drag
([e2e/LEARNINGS.md](../../../../e2e/LEARNINGS.md)). A Node script on the
session's CDP socket did what Puppeteer does: `Input.setInterceptDrags`, then
`Input.dispatchMouseEvent` press on the `semver-discipline` ≡ handle (592,688),
ten moves to the `breaking-change` row (592,490), then
`Input.dispatchDragEvent` `dragEnter`/`dragOver`/`drop` with the intercepted
drag data, and the mouse release. The page saw trusted events:

```
dragIntercepted: true ["text/plain"]
page listener: dragstart:isTrusted=true, dragover:true (defaultPrevented), drop:true (defaultPrevented), dragend:true
network: POST http://localhost:3251/agents/52b12eb0…/skills  200     # one reorder write
```

It is a synthetic pointer drag from the browser's input layer, not a human
hand on a mouse; the owner's physical-mouse drag is in
[drag-verification.md](drag-verification.md). After (API, then SQL):

```
{'order': 0, 'skill': 'semver-discipline', 'enabled': True, 'link_enabled': True, 'approval': 'approved'}
{'order': 1, 'skill': 'breaking-change',   'enabled': True, 'link_enabled': True, 'approval': 'approved'}
{'order': 2, 'skill': 'response-schema',   'enabled': True, 'link_enabled': True, 'approval': 'approved'}

select s.name, a_s."order", a_s.enabled as link_enabled, s.enabled as skill_enabled
  from agent_skills a_s join skills s on s.id = a_s.skill_id
 where a_s.agent_id = '52b12eb0…' order by a_s."order";
       name        | order | link_enabled | skill_enabled
-------------------+-------+--------------+---------------
 semver-discipline |     0 | t            | t
 breaking-change   |     1 | t            | t
 response-schema   |     2 | t            | t
```

After a reload: [36-skills-tab-after-cdp-drag](screenshots/36-skills-tab-after-cdp-drag.png).

## 14.2 Persisted order reaches the Skills section (runtime) and the system message (tests)

At runtime, the free preview builds the Skills section exactly as a run
would and fingerprints it (SHA-256 of the canonical prompt blocks, in prompt
order). The CLI recomputes the expected value from the skill bodies in the
stored order:

```
$ pnpm exec tsx src/experiments/hw2/cli.ts preview --api http://127.0.0.1:3251 --stack hw2f-15473bbf \
    --database devdigest_hw2f_15473bbf --container devdigest-hw2f-15473bbf \
    --experiment 18 --condition with --keep-links --reservation 0.01
"ok": true, "problems": [],
"prompted_skills": ["semver-discipline", "breaking-change"],          # after 14.3's switch-off
"skill_fingerprint":          "b4978ce07152b569aab7d82c2ea2290af54833c2312fa8157377f8f1a49fa0d6",
"expected_skill_fingerprint": "b4978ce07152b569aab7d82c2ea2290af54833c2312fa8157377f8f1a49fa0d6"
```

`b4978ce0…` is also the value for `semver-discipline > breaking-change` in
[drag-verification.md](drag-verification.md); the reversed order gives
`20154e42…`. The fingerprint covers the Skills blocks, not the message role,
so the role is shown only by the tests in [Deterministic tests](#deterministic-injected-provider-tests).

## 14.3 A skill switched off for the agent is excluded and needs no approval

Switched off with the UI switch "Use response-schema in this agent's reviews":

```
network: PATCH http://localhost:3251/agents/52b12eb0…/skills/676b6854…  200
{'order': 2, 'skill': 'response-schema', 'enabled': True, 'link_enabled': False, 'approval': 'approved'}
SQL: response-schema | 2 | f | t        # still attached, still enabled globally
```

Screenshot: [37-response-schema-off-for-agent](screenshots/37-response-schema-off-for-agent.png).
The preview above lists `prompted_skills` without it.

"Needs no approval" was shown with the unapproved probe skill from 14.4,
attached to the same agent and switched **off** for it
([42-probe-off-for-agent-no-warning](screenshots/42-probe-off-for-agent-no-warning.png):
the "Reviews with this agent are blocked" warning is gone):

```
network: PATCH http://localhost:3251/agents/52b12eb0…/skills/98eeee12…  200
$ cli.ts preview … --keep-links                 # same command as 14.2
"ok": true, "refusal_reason": null,
"linked_skills":   ["semver-discipline", "breaking-change", "response-schema", "verifier-14-probe"],
"prompted_skills": ["semver-discipline", "breaking-change"],
"skill_fingerprint": "b4978ce0…" == "expected_skill_fingerprint"
```

With the probe switched **on** and still unapproved, the same preview is refused
(`409 skill_not_approved`, below). The unapproved skill blocks only when it
would reach the prompt.

## 14.4 An unapproved skill is rejected before model dispatch; approve, stale, revoke

**Create.** `POST /skills` (rubric `verifier-14-probe`, id `98eeee12-05ea-4aaf-813d-f0c7708740c2`):
`version 1, approval.status "unapproved", body_sha256 737afb2c…`. Creating it
did not approve it.

**Link and enable** through the UI ("Attach verifier-14-probe to this
agent": one `POST /agents/52b12eb0…/skills 200`); the per-agent switch starts
on. The tab marks the row **Not approved** and warns "Reviews with this agent
are blocked: these enabled skills are not approved for the system prompt:
verifier-14-probe":
[38-unapproved-probe-blocks-agent](screenshots/38-unapproved-probe-blocks-agent.png).

**Run Review** (PR #502 → **Run Review** → **API Contract Reviewer**, 15:34:25Z):

```
ledger before: 21 lines, sha256 419c3340853323cd8755f52c635b0d03fa26a55251b07c6e683f7e89a1f09fea, 5010 B, mtime 2026-10-27 20:22
network: POST http://localhost:3251/pulls/d76b45c7…/review 200 → run 14f360de-4655-4de9-a5c9-e9fe1f05f6ca

select id, status, provider, model, tokens_in, tokens_out, cost_usd, duration_ms, error from agent_runs;
 14f360de… | failed | openrouter | deepseek/deepseek-v4-flash | 0 | 0 | (null) | 10 |
   Review blocked before model dispatch: enabled skill(s) not approved for the system prompt:
   "verifier-14-probe" (unapproved). A workspace owner must approve the current content, or disable the skill for this agent.

GET /runs/14f360de…/trace → log:
 16:34:25 tool  Loading PR diff… / done (3ms)
 16:34:25 info  Diff ready — 2 changed file(s); starting 1 agent run(s)
 16:34:25 info  Starting review with agent "API Contract Reviewer" (openrouter/deepseek/deepseek-v4-flash)
 16:34:25 tool  Resolving openrouter provider… / done (0ms)
 16:34:25 info  Repo intel disabled for this agent — skipping context enrichment
 16:34:25 error Run failed: Review blocked before model dispatch: … "verifier-14-probe" (unapproved) …
stats: tokens_in 0, tokens_out 0, cost_usd null; prompt_assembly.skills null, user ""

ledger after: 21 lines, sha256 419c3340…1fea, 5010 B, mtime 2026-10-27 20:22   # unchanged
```

The run log has no model-call step: it ends at the gate. The error code is
visible on the synchronous preview of the same agent and PR:

```
$ curl -s -X POST http://127.0.0.1:3251/experiments/preview -d '{"pr_id":"d76b45c7…","agent_id":"52b12eb0…","experiment":"18",…}'
HTTP 409 {"error":{"code":"skill_not_approved","message":"Review blocked before model dispatch: … \"verifier-14-probe\" (unapproved) …",
          "details":{"skills":[{"name":"verifier-14-probe","status":"unapproved"}]}}}
```

Screenshots: [39-run-review-refused-skill-not-approved](screenshots/39-run-review-refused-skill-not-approved.png)
(PR timeline), [40-refused-run-log-no-dispatch](screenshots/40-refused-run-log-no-dispatch.png)
(run log), [41-refused-run-trace-drawer](screenshots/41-refused-run-trace-drawer.png)
(trace drawer of the refused run: tokens 0k→0.0k, no Skills block).
Observation: the drawer header says "PR #502 · completed" for this failed run.

**Approve** on the Preview tab's "System-prompt approval" panel. The panel and
the confirm dialog show the raw body, `v1` and the full digest
`737afb2cd63bff223b1fbf8d6c95ae818e3ccca7999b11c5af631821802f93cc`
([43-approval-panel-unapproved](screenshots/43-approval-panel-unapproved.png),
[44-approve-confirm-raw-body-version-sha](screenshots/44-approve-confirm-raw-body-version-sha.png)).
**Approve** sent `POST /skills/98eeee12…/approval 200`; the panel then reads
**Approved for system prompt**, "Approved v1 on 10/30/2026, 4:36:00 PM"
([45-approved-for-system-prompt](screenshots/45-approved-for-system-prompt.png)).
With the probe switched on and approved, the preview passed with it last:
`prompted_skills [semver-discipline, breaking-change, verifier-14-probe]`,
`skill_fingerprint c3c5d357… == expected`.

**Edit → stale.** Config tab, one line added to the body, **Save skill**
(`PUT /skills/98eeee12… 200`). `GET /skills/98eeee12…` →
`version 2, approval {status "stale", body_sha256 205a01cb…, approved_version 1}`;
the panel reads **Approval stale**, showing v2 and its digest
([46-approval-stale-after-edit](screenshots/46-approval-stale-after-edit.png)).
The preview is refused: `409 skill_not_approved … "verifier-14-probe" (stale)`.

**Revoke** (`DELETE /skills/98eeee12…/approval 200`): **Approval revoked**
([47-approval-revoked](screenshots/47-approval-revoked.png)); the preview is
refused with `status "revoked"`.

**Audit.**

```
$ curl -s http://127.0.0.1:3251/skills/98eeee12…/approvals
[{"id":"9","skill_name":"verifier-14-probe","version":2,"body_sha256":"205a01cb…","decision":"revoke",
  "actor_name":"You","reason":"criterion 14 verifier: probe done","created_at":"2026-10-30T15:36:56.869Z"},
 {"id":"8","skill_name":"verifier-14-probe","version":1,"body_sha256":"737afb2c…","decision":"approve",
  "actor_name":"You","reason":"criterion 14 verifier: probe body reviewed","created_at":"2026-10-30T15:36:00.049Z"}]

select id, skill_id, skill_name, version, left(body_sha256,16), decision, reason, created_at from skill_approvals order by id;
 1–7 | <seeded skills>     | v1 | approve | seed-bootstrap: reviewed content digest | 2026-10-30 15:25:47
   8 | 98eeee12…           | verifier-14-probe | 1 | 737afb2cd63bff22 | approve | criterion 14 verifier: probe body reviewed | 15:36:00
   9 | 98eeee12…           | verifier-14-probe | 2 | 205a01cbd419ec03 | revoke  | criterion 14 verifier: probe done          | 15:36:56
```

**Cleanup.** The probe was deleted (`DELETE /skills/98eeee12… → {"ok":true}`).
Rows 8 and 9 remain, with `skill_id` set to null and `skill_name` kept. The
refused run `14f360de…` remains. The agent is left as dragged:
semver-discipline, breaking-change, response-schema (off for this agent).

## Deterministic injected-provider tests

Run on 2026-10-30 against the same working tree (Testcontainers Postgres; an
injected mock provider records every request; no network).

```
server$ pnpm exec vitest run test/skills-prompt.it.test.ts test/agent-skill-enabled.it.test.ts test/skill-approval-regression.it.test.ts
 ✓ test/agent-skill-enabled.it.test.ts (5 tests)
 ✓ test/skills-prompt.it.test.ts (2 tests)
 ✓ test/skill-approval-regression.it.test.ts (16 tests)
 Test Files 3 passed (3) · Tests 23 passed (23)

reviewer-core$ npm test -- prompt run
 ✓ test/prompt.test.ts (19 tests) · ✓ test/run.test.ts (12 tests) · Tests 31 passed (31)

client$ pnpm exec vitest run ".../RunTraceDrawer/_components/TraceBody/TraceBody.test.tsx"
 ✓ TraceBody.test.tsx (6 tests)
```

The assertions that carry each point:

- **System = instructions → Skills in persisted order → guard; persisted trace.**
  `server/test/skills-prompt.it.test.ts` reads `GET /runs/:id/trace` after a
  real `POST /pulls/:id/review`:
  `expect(system.startsWith('Review the diff.\n\n## Skills / rules\n')).toBe(true)`,
  `expect(system.indexOf('SECURITY — read carefully')).toBeGreaterThan(system.indexOf(skills))`,
  `expect(skills.indexOf('Coercion criteria')).toBeLessThan(skills.indexOf('Boundary criteria'))`
  (linked as `[second, first]`), and on the request sent:
  `expect(messages.map((m) => m.role)).toEqual(['system', 'user'])`,
  `expect(messages[0]!.content).toBe(system)`.
  `reviewer-core/test/prompt.test.ts`:
  `expect(messages[0]!.content).toBe(\`AGENT-SYS\n\n${rendered.section}\n\n${GOLDEN_GUARD}\`)`.
- **Reorder follows the drag write.** `skills-prompt.it.test.ts` relinks
  `[beta, off, alpha]`, checks `GET /agents/:id/skills` equals it, then
  `expect(assembly.system.indexOf('Beta rule')).toBeLessThan(assembly.system.indexOf('Alpha rule'))`.
  `skill-approval-regression.it.test.ts` ("link order through the real API
  drives the system message, the trace and skills_tokens") checks orders
  `[a,b,c]`, `[c,a,b]`, `[b,c,a]` in the request, the trace and each fence.
- **User message has no skill text.** `expect(user).not.toContain('## Skills / rules')`,
  `expect(user).not.toContain('<untrusted source="skill-')`,
  `expect(messages[1]!.content).not.toContain('Boundary criteria')`.
- **Disabled skill absent.** `skills-prompt.it.test.ts`:
  `expect(assembly.skills).not.toContain('Disabled rule')` (also not in
  `user` or `system`); only a disabled skill linked →
  `expect(assembly.skills).toBeNull(); expect(assembly.skills_tokens).toBeNull()`.
  `agent-skill-enabled.it.test.ts`: link switched off →
  `expect(without.skills).not.toContain(middle.name)`,
  `expect(without.tokens!).toBeLessThan(all.tokens!)`.
  `skill-approval-regression.it.test.ts`: unapproved skills switched off per
  agent or globally "neither block nor appear" (`run.status` `done`, their
  text absent from every message).
- **`skills_tokens` = count of the rendered section.**
  `expect(trace.prompt_assembly.skills_tokens).toBe(new TiktokenTokenizer().count(section))`,
  and `expect(trace.skills_tokens).toBe(app.container.tokenizer.count(section))`
  with `section = renderSkillsSection(...)` rebuilt independently, and
  `toBeLessThan(count(system))`.
- **Rejected before dispatch.** `skill-approval-regression.it.test.ts` "fails
  closed before dispatch: zero provider requests": unapproved, stale, revoked,
  renamed and restored skills each give `run.status 'failed'`, an error
  containing `"<name>" (<status>)` and "before model dispatch",
  `expect(requests).toBe(0)`, and no review row, for single-pass and map-reduce.
- **Trace drawer.** `TraceBody.test.tsx`: the block "Skills — part of the
  system message (dynamic)" shows `~312 tokens` and is the only block with a
  count; no block without skills; a historical trace with Skills in the user
  message is labelled "Skills — in the user message (earlier trace)".

The trace drawer could not be shown for a run with Skills on this stack: it
has no seeded runs (`select count(*) from agent_runs` was 0 before 14.4), and
the only run is the refused one ([41](screenshots/41-refused-run-trace-drawer.png)).
The historical live trace ([34](screenshots/34-trace-only-run-skills-block.png))
predates the change and has Skills in the user message.

## Verdict

ACCEPTANCE.md: **Verified** = "shown at runtime, with evidence linked";
**Implemented** = code on the branch with passing tests, not yet shown at runtime.

- **#14 (drag order = prompt order, shown in the run trace): Implemented.**
  Shown at runtime: the drag persists (pointer drag via CDP, API and SQL), the
  stored order is the order of the Skills section the server builds (preview
  fingerprint), disabled and unapproved skills are handled, and the gate stops
  a run before dispatch. Not shown at runtime: Skills in the **system** message
  and in that order **in a run trace**. That is shown only by injected-provider
  tests, and the historical live trace is from the user-message design.
- **#19 (separate Skills block with its own token count): Implemented for the
  current source.** The 2026-10-26 live trace still shows a separate block
  with its own count (831), but under the old design. The current block
  ("part of the system message") and the count of the system-message section
  are shown only by tests.
- **#20 (enabled skill has a block, disabled none, in the trace): Implemented
  for the current source.** At runtime the disabled skill is left out of the
  Skills section the server builds (preview `prompted_skills` and fingerprint),
  but not in a trace. The trace part is shown only by tests and by the
  historical trace.

All three would move to Verified with one separately authorized, paid,
trace-only Run Review of API Contract Reviewer on this arrangement
(semver-discipline, breaking-change; response-schema off), with the trace
drawer screenshotted and `GET /runs/:id/trace` recorded.

## Live system-role run trace (item A, 2026-10-31)

The owner approved item A of the
[approval packet](../PROSPECTIVE-STUDY.md#approval-packet-2026-10-30) only:
one trace-only exploration slot, reservation $0.005, cumulative ceiling
$0.01881699, capability lifetime 3 hours. Item B (the 20 confirmatory slots)
was not authorized, and nothing in this section belongs to the study.

| Item | Value |
| --- | --- |
| Source | `406dc25` (implementation fingerprint `201ffa9ad50a91ae23dd2bab213823e492739dabb32f23aeb4f58d4fffd804cb`, the same as `23d0b48`) |
| Stack | `hw2f-cc928441`, database `devdigest_hw2f_cc928441`, container `devdigest-hw2f-cc928441`, API `127.0.0.1:3251`, web `localhost:3250`. The packet's stack `hw2f-1fe1aeec` was destroyed by a host restart at 11:03; the owner reconfirmed item A on the rebuilt stack. |
| Links (API Contract Reviewer) | semver-discipline `order` 0 on, breaking-change `order` 1 on, response-schema `order` 2 **off** for this agent (all three approved for their current body) |
| Free preview just before | ok, prompted [semver-discipline, breaking-change], Skill fingerprint `b4978ce07152b569aab7d82c2ea2290af54833c2312fa8157377f8f1a49fa0d6` (the packet's value), worst case $0.00277938 |
| Capability | authorized 12:09:30Z (charged before $0.01381699, ceiling $0.01881699, expires 15:09:30Z), revoked 12:11:29Z |
| Slot | `x-18-with-3`, armed 12:09:38Z; **one** Run Review click (API Contract Reviewer on PR #502) at 12:10:57Z; dispatched 12:10:58Z; completed 12:11:15Z |
| Run | `4fdedc2e-0d50-4b48-ab3a-b182f18f4f06`, DeepInfra, served `deepseek/deepseek-v4-flash-20260423`, one attempt, 1,765 → 383 tokens, $0.00022779, 1 finding (grounding 1/1) |
| Settlement | PASS: key usage $0.00445266 (+$0.00022779 since the last settlement), within [$0.00404478, $0.01404478] |
| Ledger | 24 records; $0.01404478 conservative ($0.00404478 confirmed + $0.01 held for `x-17-without-1`), no unresolved slot, no live capability |

### What the persisted trace shows

`GET /runs/4fdedc2e-0d50-4b48-ab3a-b182f18f4f06/trace`, field
`prompt_assembly`, cross-checked by SQL over `run_traces.trace`:

| Check | Result |
| --- | --- |
| The Skills block is inside the **system** message | yes: `system` (5,464 chars) contains the whole `skills` block at offsets 995–4,359 |
| Order in the system message = link order | `### semver-discipline` at 1,024 (`skill-0`), `### breaking-change` at 2,623 (`skill-1`) |
| Injection guard comes after the Skills | `SECURITY — read carefully` at 4,361, directly after the block |
| Switched-off Skill is absent | `response-schema` occurs nowhere in `system` or `user` |
| No Skill in the user message | `user` (2,016 chars) has neither Skill heading |
| Separate Skills block with its own count (#19) | `skills_tokens` 831; the drawer row reads "Skills — part of the system message (dynamic) ~831 tokens" |
| Run record | `agent_runs.status` `done`, `cost_usd` 0.00022779, `grounding` `1/1 passed` |

The raw trace JSON, the runner log, the settlement log and the SQL read-back
stay private in `~/.devdigest/hw2-experiments/freeze-20261031/` (mode 0600).

### Screenshots

- [48](screenshots/48-item-a-run-review-menu.png): the Run Review menu on PR #502 before the click.
- [49](screenshots/49-item-a-agent-runs.png): Agent runs, the one API Contract Reviewer run at $0.00022779.
- [50](screenshots/50-item-a-trace-drawer.png): the trace drawer: configuration and stats.
- [51](screenshots/51-item-a-prompt-assembly-system-skills.png): Prompt assembly: System, "Skills — part of the system message (dynamic) ~831 tokens", User / diff.
- [52](screenshots/52-item-a-system-skill-0-semver.png): the expanded System block: `## Skills / rules`, then `skill-0` semver-discipline.
- [53](screenshots/53-item-a-system-skill-1-breaking.png): the same block: `skill-1` breaking-change after it.
- [54](screenshots/54-item-a-system-guard-after-skills.png): the same block: the injection guard after the last Skill.

### Verdict update (2026-10-31)

This supersedes the verdict above for the parts a live trace can show.

- **#14: Verified.** The drag order, persisted in `agent_skills.order`, is
  the order of the Skill blocks inside the system-role message of a real run,
  shown in the persisted trace, the drawer and SQL. The switched-off Skill is
  absent, and the approval gate was shown earlier in this file.
- **#19: Verified on the current source.** It is a separate Skills block with
  its own token count (831), labelled as part of the system message.
- **#20: Verified on the current source.** Both enabled Skills have a block,
  and the Skill switched off for the agent has none.

This run was not built to show whether a Skill changes a review: there is one
run, no control, and operator links. It is not evidence for #17 or #18.
