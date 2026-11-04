#!/usr/bin/env node
// route-diff — the deterministic half of the pr-self-review workflow.
//
// Collects the complete local change set against a base (branch commits plus
// staged, unstaged and untracked files), routes every changed file to the
// project skills that govern it, and lists the checks for each touched package.
// Read-only: it runs only `git` queries and never executes a check itself.
//
//   node .claude/skills/pr-self-review/scripts/route-diff.mjs [--base <ref>]
//
// Prints one JSON report on stdout. Exit code 2 = the base cannot be resolved.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Routing floor from PLAN.md §4. Every matching rule adds its skills. */
export const ROUTES = [
  {
    id: "client-code",
    match: (p) => /^client\/src\/.*\.(ts|tsx)$/.test(p) && !p.startsWith("client/src/vendor/"),
    skills: ["frontend-ui-architecture", "react-best-practices", "typescript-expert"],
  },
  { id: "client-app-router", match: (p) => p.startsWith("client/src/app/"), skills: ["next-best-practices"] },
  { id: "client-tests", match: (p) => /^client\/.*\.test\.(ts|tsx)$/.test(p), skills: ["react-testing-library"] },
  {
    id: "backend-code",
    match: (p) =>
      /^server\/src\/(modules|platform|adapters)\/.*\.ts$/.test(p) || /^reviewer-core\/src\/.*\.ts$/.test(p),
    skills: ["onion-architecture", "typescript-expert"],
  },
  {
    id: "fastify-routes",
    match: (p) => /^server\/src\/(modules\/[^/]+\/routes|platform\/.*plugin[^/]*|app)\.ts$/.test(p),
    skills: ["fastify-best-practices", "zod"],
  },
  { id: "shared-contracts", match: (p) => /^server\/src\/vendor\/shared\/.*\.ts$/.test(p), skills: ["zod", "typescript-expert"] },
  {
    id: "persistence",
    match: (p) => /^server\/src\/db\//.test(p) || /^server\/src\/modules\/.*repositor(y|ies)[^/]*\.ts$/.test(p) || /^server\/src\/modules\/[^/]+\/repository\//.test(p),
    skills: ["drizzle-orm-patterns", "postgresql-table-design"],
  },
  {
    id: "security-surface",
    // Path heuristic only: the workflow also adds `security` when content handles
    // credentials, auth, untrusted PR/repo data, uploads, shell, SQL or prompts.
    match: (p) =>
      /secret|auth|token|credential|upload|webhook/i.test(p) ||
      /^server\/src\/adapters\//.test(p) ||
      /^reviewer-core\/src\/prompt\.ts$/.test(p),
    skills: ["security"],
  },
];

/** Paths the review never reads: imported clones and dependencies (AGENTS.md "Do not touch"). */
const IGNORED = [/(^|\/)clones\//, /(^|\/)node_modules\//];

const INSTRUCTION_FILE = /(^|\/)(AGENTS|CLAUDE)\.md$/;
/** The instruction checker and its workflow: changing either must re-run the checker. */
const INSTRUCTION_TOOLING = ["scripts/verify-agent-instructions.mjs", ".github/workflows/agent-instructions.yml"];

/** Deterministic checks per touched package, from the AGENTS.md validation routing. */
export function checksFor(files) {
  // Markdown (including AGENTS.md / CLAUDE.md) never needs a package's build or tests.
  const code = files.filter((f) => !/\.md$/i.test(f.path));
  const touched = (prefix) => code.some((f) => f.path.startsWith(prefix));
  const checks = [];
  if (touched("client/")) checks.push({ package: "client", cwd: "client", commands: ["pnpm typecheck", "pnpm lint", "pnpm test"] });
  if (touched("server/")) {
    const commands = ["pnpm typecheck", "pnpm exec vitest run --exclude '**/*.it.test.ts'"];
    if (code.some((f) => /^server\/src\/(db|modules\/[^/]+\/repositor)/.test(f.path))) {
      commands.push("pnpm exec vitest run .it.test   # DB-backed; needs Docker");
    }
    checks.push({ package: "server", cwd: "server", commands });
  }
  if (touched("reviewer-core/")) checks.push({ package: "reviewer-core", cwd: "reviewer-core", commands: ["npm run typecheck", "npm test"] });
  if (touched("e2e/")) checks.push({ package: "e2e", cwd: "e2e", commands: ["npm run typecheck", "npm run e2e:hermetic"] });
  if (files.some((f) => INSTRUCTION_FILE.test(f.path) || f.path.startsWith(".claude/") || INSTRUCTION_TOOLING.includes(f.path))) {
    const commands = ["node scripts/verify-agent-instructions.mjs"];
    if (files.some((f) => f.path.startsWith(".claude/skills/pr-self-review/"))) {
      commands.push("node --test .claude/skills/pr-self-review/scripts/route-diff.test.mjs");
    }
    checks.push({ package: "agent-instructions", cwd: ".", commands });
  }
  return checks;
}

/** Route one path; returns the skills (deduplicated, ordered) and the rule ids that matched. */
export function routeFile(filePath) {
  const skills = [];
  const rules = [];
  for (const route of ROUTES) {
    if (!route.match(filePath)) continue;
    rules.push(route.id);
    for (const skill of route.skills) if (!skills.includes(skill)) skills.push(skill);
  }
  return { skills, rules };
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trimEnd();
}

function tryGit(cwd, ...args) {
  try {
    return git(cwd, ...args);
  } catch {
    return null;
  }
}

/** Base resolution order from PLAN.md §3: explicit --base, origin/HEAD, upstream, then main/master. */
export function resolveBase(cwd, explicit) {
  if (explicit) {
    const sha = tryGit(cwd, "rev-parse", "--verify", `${explicit}^{commit}`);
    if (!sha) throw new Error(`base "${explicit}" does not resolve to a commit`);
    return { ref: explicit, sha };
  }
  const candidates = [
    tryGit(cwd, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"),
    tryGit(cwd, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"),
    "origin/main",
    "main",
    "origin/master",
    "master",
  ].filter(Boolean);
  for (const ref of candidates) {
    const sha = tryGit(cwd, "rev-parse", "--verify", `${ref}^{commit}`);
    if (sha) return { ref, sha };
  }
  throw new Error("no base found; pass --base <ref>");
}

/** All changes relative to the merge base: branch commits + index + worktree + untracked. */
export function collectChanges(cwd, mergeBase) {
  const files = [];
  const raw = git(cwd, "diff", "--name-status", "-z", "--find-renames", mergeBase);
  const parts = raw ? raw.split("\0").filter((x) => x !== "") : [];
  for (let i = 0; i < parts.length; ) {
    const status = parts[i++];
    if (status.startsWith("R") || status.startsWith("C")) {
      const from = parts[i++];
      const to = parts[i++];
      files.push({ path: to, status: status[0], from });
    } else {
      files.push({ path: parts[i++], status });
    }
  }
  const untracked = git(cwd, "ls-files", "--others", "--exclude-standard", "-z");
  for (const p of untracked.split("\0").filter(Boolean)) files.push({ path: p, status: "?" });
  return files.filter((f) => !IGNORED.some((re) => re.test(f.path)));
}

export function buildReport({ cwd = process.cwd(), base } = {}) {
  const root = git(cwd, "rev-parse", "--show-toplevel");
  const resolved = resolveBase(root, base);
  const headSha = git(root, "rev-parse", "HEAD");
  const mergeBase = git(root, "merge-base", resolved.sha, headSha);
  const files = collectChanges(root, mergeBase).map((f) => ({ ...f, ...routeFile(f.path) }));

  const skills = {};
  for (const file of files) {
    for (const skill of file.skills) {
      const skillPath = `.claude/skills/${skill}/SKILL.md`;
      skills[skill] ??= { path: skillPath, exists: existsSync(path.join(root, skillPath)), files: [] };
      skills[skill].files.push(file.path);
    }
  }
  const missing = Object.entries(skills).filter(([, s]) => !s.exists).map(([name]) => name);

  return {
    base: resolved.ref,
    baseSha: resolved.sha,
    mergeBase,
    headSha,
    dirty: git(root, "status", "--porcelain").length > 0,
    files,
    unrouted: files.filter((f) => f.skills.length === 0).map((f) => f.path),
    skills,
    checks: checksFor(files),
    warnings: missing.map((name) => `routed skill "${name}" has no SKILL.md on disk`),
  };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const baseIndex = args.indexOf("--base");
  const base = baseIndex >= 0 ? args[baseIndex + 1] : undefined;
  try {
    process.stdout.write(`${JSON.stringify(buildReport({ base }), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`route-diff: ${error.message}\n`);
    process.exitCode = 2;
  }
}
