# Live run trace after the physical drag (rows 14, 19, 20)

The trace-only paid slot `x-18-with-2` ran on stack `hw2f-7d16304f` on
2026-10-26. The owner dispatched it with **Run Review → API Contract
Reviewer** on PR #502. It runs with the links exactly as the owner dragged
and switched them ([drag-verification.md](drag-verification.md)):

| Order | Skill | Per-agent switch |
| --- | --- | --- |
| 0 | semver-discipline | on |
| 1 | breaking-change | on |
| 2 | response-schema | **off** |

The ledger records it as `links: "operator"`, `purpose: "trace-evidence"`.
It is **not** part of the experiment 18 comparison
([EXPERIMENTS.md](../EXPERIMENTS.md#the-trace-evidence-slot-is-trace-only)).

## The run

| Item | Value |
| --- | --- |
| Run | `af19b042-feb2-42fa-8c8a-f4321437cb66`, completed; one attempt, `valid`, finish reason `stop`, 37.7 s |
| Provenance (OpenRouter generation metadata) | provider **DeepInfra**, model `deepseek/deepseek-v4-flash-20260423`, pinned `deepinfra/fp8`, fallbacks off |
| Tokens (generation metadata) | 1914 prompt, 396 completion. The router reported 1765 / 424 |
| Cost | $0.00023517, provider-reported; reservation $0.01 |
| Skill fingerprint | `b4978ce07152b569aab7d82c2ea2290af54833c2312fa8157377f8f1a49fa0d6`: semver-discipline then breaking-change, equal to the free preview made before the slot was armed |
| Non-Skill fingerprint | `baa2505e…`, the same as both experiment 18 comparison runs |

## The trace (`GET /runs/af19b042-…/trace`, `prompt_assembly`)

```
skills blocks, in order: [('skill-0', 'semver-discipline'), ('skill-1', 'breaking-change')]
response-schema present in the Skills section: False
skills_tokens: 831
user prompt order: PR description at 529 < Skills at 713 < diff at 4345
```

In the UI (**PR #502 → Agent runs → Open run trace & logs → Prompt
assembly**), the run trace shows a separate **Skills (dynamic) ~831 tokens**
block between System and User / diff. Its first fenced block is
`<untrusted source="skill-0">` with `### semver-discipline`:
[34-trace-only-run-skills-block](screenshots/34-trace-only-run-skills-block.png).

What this shows for each row:
- **Row 14 (drag order = prompt order, shown in the trace):** the dragged
  order, semver-discipline above breaking-change, is the order of `skill-0`
  and `skill-1` in the live trace. Before the drag the stored order was
  breaking-change, response-schema, semver-discipline.
- **Row 19 (a separate Skills block with its own token count):** the Skills
  block is a separate part of the prompt assembly, with `skills_tokens` =
  831, shown as "~831 tokens".
- **Row 20 (an enabled skill has a block, a disabled one none):** both
  enabled skills have a block. `response-schema` is still attached and
  globally enabled but switched off for this agent, and it is absent from the
  Skills section.

The model's single finding (CRITICAL, `src/api/payments.ts:13`) cites both
the `breaking-change` and the `semver-discipline` skill by name. That is
consistent with both being in the prompt, but it is not used as evidence for
any row.

## Settlement

After the phase, the key's own usage was read with `cli.ts settle` (3 stable
reads). The result was "PASS: key usage rose $0.00116289, within
[$0.00116289, $0.01116289]". The observed rise equals the sum of the four
confirmed costs exactly, so the 429 slot was not billed. The capability was
revoked first; no `capability.json` remains.
