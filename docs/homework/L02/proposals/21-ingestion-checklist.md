# Criterion 21: ingestion checklist for the coordinator

Use this after the owner reports a completed run. Only the owner's real session counts. Never reconstruct or paraphrase output that is missing.

## A. Provenance

- [ ] A session exists with cwd `~/projects/aaen-dev-digest-l02-self-review`. Look for a new `*.jsonl` under `~/.claude/projects/<the self-review project folder>/`; on 2026-11-03 that directory did not exist. If the run was made in the desktop app, the location may differ; ask the owner.
- [ ] Its first user turn is exactly `/pr-self-review --base HEAD`, typed by the user. The skill has `disable-model-invocation: true`, so a model-triggered invocation is impossible; the transcript should show the expanded command/skill content after a user turn.
- [ ] The timestamp is after 2026-11-03, and the owner confirms they ran it.
- [ ] The scratch checkout is still detached at `21c8f09bb6582495d24702afd8aa35c10c62c96f` (or at the PR head `$H`, if the owner took the [recommended pre-run step](21-owner-instructions.md#recommended-pre-run-step-owner-decision-not-executed)), and `git status --short` still shows only the two ` M` marker files. If `INSIGHTS.md` or `LEARNINGS.md` changed, or any file was added, record it and ask whether that edit was approved.

## B. Required observable markers (all must be present in one invocation)

- [ ] **Router run:** a Bash call `node .claude/skills/pr-self-review/scripts/route-diff.mjs --base HEAD` whose JSON lists `client/src/app/skills/page.tsx` and `server/src/modules/skills/routes.ts`, with `unrouted: []` and `warnings: []`. It should match the preparation check ([21-readiness.md](21-readiness.md) row 2b): both files routed, `unrouted: []`, `warnings: []`, and the seven skills below; base, merge base and head should all be the scratch commit. The router's unit tests passed 10/10 at preparation.
- [ ] **Mixed diff detected:** the routing covers both packages.
- [ ] **Frontend set loaded:** Read calls (or `Skill` tool calls; record which mechanism, mentor Q1 sub-case) for `.claude/skills/frontend-ui-architecture/SKILL.md`, `react-best-practices/SKILL.md`, `next-best-practices/SKILL.md` and `typescript-expert/SKILL.md`.
- [ ] **Backend set loaded:** Read calls (or `Skill` tool calls; record which mechanism) for `.claude/skills/onion-architecture/SKILL.md`, `fastify-best-practices/SKILL.md` and `zod/SKILL.md`, with `typescript-expert` shared with the frontend set.
- [ ] **Report:** starts `PR Self Review: <PASS|WARN|BLOCKED>`, with a `Routing` section naming the 7 skills and `Checks` and `Findings` sections. Record the verdict as observed; the row does not require PASS (mentor Q4).
- [ ] **No push or commit:** no `Bash` tool call runs `git commit`, `git push` or `gh pr`, and `git -C <scratch> log -1` is still the scratch commit.
- [ ] **Record the verdict as it appears** and the loading mechanism per skill (Read or `Skill`).

Count from the raw jsonl by parsing it, not by grep: a grep also matches the skill text and the user's own words. The script:

- starts counting at the user turn that contains `/pr-self-review`;
- counts a `Read` of `.claude/skills/<skill>/SKILL.md` only when its path lies inside the session cwd (the entry's `cwd` field, or the scratch path argument when that field is absent), and a `Read` or `Skill` call only when a matching `tool_result` exists with `is_error` not true; denied, errored and result-less calls are reported separately;
- counts `Bash` calls whose command runs `git … push`, `git … commit` (including forms such as `git -C x push`) or `gh pr`, whatever their result;
- reports sidechain entries in the main transcript and scans every subagent transcript in the `<session>/subagents/` directory next to the jsonl, reported separately.

Also look over the list of Bash commands by eye. The script prints counts only, never command text or file content:

```sh
f=~/path/to/the-session.jsonl   # the session found in section A
python3 -I - "$f" ~/projects/aaen-dev-digest-l02-self-review <<'PY'
import json, os, re, sys
RISKY = re.compile(r'\bgit\b[^|;&\n]*\b(push|commit)\b|\bgh\s+pr\b')
SKILLS = ['frontend-ui-architecture', 'react-best-practices', 'next-best-practices',
          'typescript-expert', 'onion-architecture', 'fastify-best-practices', 'zod']
main = sys.argv[1]
scratch = os.path.normpath(os.path.expanduser(sys.argv[2]))

def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return ' '.join(str(b.get('text', '')) for b in content if isinstance(b, dict))
    return ''

def scan(path, need_start):
    """Counts for one transcript. need_start: count only after the /pr-self-review user turn."""
    uses, results = [], {}
    started = not need_start
    sidechain = 0
    cwd_mismatch = 0
    with open(path, encoding='utf-8') as fh:
        for line in fh:
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            if not isinstance(entry, dict):
                continue
            content = (entry.get('message') or {}).get('content')
            if entry.get('type') == 'user':
                if not started and '/pr-self-review' in text_of(content):
                    started = True
                if isinstance(content, list):
                    for b in content:
                        if isinstance(b, dict) and b.get('type') == 'tool_result':
                            results[b.get('tool_use_id')] = b.get('is_error') is True
                continue
            if not started or entry.get('type') != 'assistant' or not isinstance(content, list):
                continue
            if entry.get('isSidechain') is True:
                sidechain += 1
            cwd = os.path.normpath(entry.get('cwd') or scratch)
            if cwd != os.path.normpath(scratch):
                cwd_mismatch += 1
            for b in content:
                if isinstance(b, dict) and b.get('type') == 'tool_use':
                    uses.append((b.get('id'), b.get('name'), b.get('input') or {}, cwd))
    c = {'started': started, 'sidechain': sidechain, 'cwd_mismatch': cwd_mismatch, 'failed': 0, 'outside_cwd': 0, 'risky': 0,
         'read': dict.fromkeys(SKILLS, 0), 'skill': dict.fromkeys(SKILLS, 0)}
    for uid, name, args, cwd in uses:
        if name == 'Bash':
            if RISKY.search(str(args.get('command', ''))):
                c['risky'] += 1  # attempted, whatever the result
            continue
        if name == 'Read':
            p = os.path.normpath(str(args.get('file_path', '')))
            hit = [s for s in SKILLS if p.endswith(f'/.claude/skills/{s}/SKILL.md')]
            if not hit:
                continue
            if not p.startswith(cwd + os.sep):
                c['outside_cwd'] += 1
                continue
            kind, s = 'read', hit[0]
        elif name == 'Skill' and args.get('skill') in SKILLS:
            kind, s = 'skill', args['skill']
        else:
            continue
        if uid not in results or results[uid]:
            c['failed'] += 1  # denied, errored or no result
        else:
            c[kind][s] += 1
    return c

def report(label, c):
    print(f'[{label}] start marker found: {c["started"]}; sidechain assistant entries: {c["sidechain"]}')
    for s in SKILLS:
        print(f'  {s}: Read={c["read"][s]} Skill={c["skill"][s]}')
    print(f'  SKILL.md Read/Skill calls denied, errored or without result: {c["failed"]}')
    print(f'  SKILL.md Reads outside the session cwd: {c["outside_cwd"]}')
    print(f'  assistant entries whose cwd is not the scratch checkout: {c["cwd_mismatch"]}')
    print(f'  Bash git push/commit or gh pr calls: {c["risky"]}')

report('main', scan(main, True))
sub = os.path.join(main[:-len('.jsonl')] if main.endswith('.jsonl') else main, 'subagents')
files = sorted(f for f in os.listdir(sub) if f.endswith('.jsonl')) if os.path.isdir(sub) else []
print(f'subagent transcripts: {len(files)}')
for i, f in enumerate(files, 1):
    report(f'subagent #{i}', scan(os.path.join(sub, f), False))
PY
```

Expect, in the main transcript: start marker found; 0 assistant entries whose cwd is not the scratch checkout; every skill with Read ≥ 1 or Skill ≥ 1; 0 push/commit/PR calls; and 0 sidechain entries and 0 subagent transcripts, or else record what the subagents loaded (a skill loaded only by a subagent is a mentor Q1 matter). Report denied or errored calls and Reads outside the cwd as observed; they do not count as loads.

## C. Static "no push hook" evidence (re-run at ingestion; must be unchanged)

- [ ] `ls ~/projects/aaen-dev-digest/.git/hooks | grep -v '\.sample$'` is empty.
- [ ] `git config --get core.hooksPath` is unset at the repository, global and system levels.
- [ ] `.claude/settings.json` holds only the `UserPromptSubmit` insights reminder.
- [ ] There are no husky or lefthook configs.

## D. Redaction (before anything enters git)

- [ ] Never commit the raw jsonl. Write a sanitized excerpt: the user command, the router JSON, the list of SKILL.md Read calls, the check results (PASS/FAIL lines) and the final report.
- [ ] Scan the excerpt and the screenshots: `grep -nEi 'ghp_|github_pat_|sk-[a-z0-9]|bearer |secrets\.json|\.devdigest/|api[_-]?key|ANTHROPIC|OPENROUTER|password'`. Remove or blur every value. Paths may stay only if they leak nothing; prefer to drop `~/.devdigest/…`.
- [ ] Remove any account email or organisation ID shown in the app chrome from the screenshots.

## E. Where to file the evidence (PR #53 worktree `~/projects/aaen-dev-digest-l02-extraction`, a separate authorized write step)

- New `docs/homework/L02/evidence/criterion-21-session.md`: the sanitized excerpt, the session date and time, the cwd, the scratch commit (`21c8f09` or `$H`), the verdict, and the section C results.
- Screenshots go to `docs/homework/L02/evidence/screenshots/` with the next free number.
- Append a dated "Run captured" section to `evidence/criterion-21-preparation.md` (in this tree: [criterion-21-preparation.md](../evidence/criterion-21-preparation.md)); append it, do not rewrite earlier text.
- `ACCEPTANCE.md` row 21: change it to Verified only if every box in section B is checked and mentor Q1 (including its `Skill`-tool sub-case, if that mechanism was used) is not contradicted. Update the "Current count" line and CHECKPOINT.md to match.
- Check that every relative link resolves (docs-only validation).

## F. If something is missing

If a marker is absent (for example, only the router ran and no `SKILL.md` was read), keep row 21 **Blocked** or Implemented with the reason stated, and ask the owner to re-run. Do not patch the evidence.
