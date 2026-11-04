// Verifies the repository side of the AGENTS.md instruction contract.
// Run from anywhere: `node scripts/verify-agent-instructions.mjs`. CI runs it on
// every pull request (.github/workflows/agent-instructions.yml).
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readlinkSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The five canonical project/package instruction files. Skill-local files such
// as .claude/skills/zod/AGENTS.md are a different scope and are not checked.
// Each must be a regular, non-empty file: a symlink can silently resolve to
// nothing on another checkout.
const rootInstructions = "AGENTS.md";
const packageInstructions = ["client/AGENTS.md", "server/AGENTS.md", "reviewer-core/AGENTS.md", "e2e/AGENTS.md"];
const instructionPaths = [rootInstructions, ...packageInstructions];

// Claude Code reads CLAUDE.md and, once any exists, no longer reads AGENTS.md.
// Next to every canonical AGENTS.md there must therefore be a CLAUDE.md that is
// a symlink to it, so it can never carry instructions of its own. A symlink, not
// an `@AGENTS.md` import: Claude Code 2.1.278 expands an import only in the
// starting directory's CLAUDE.md, so a session started below a package root lost
// the instructions (see LEARNINGS.md). The stored target must be exactly
// `AGENTS.md`; an earlier attempt stored `AGENTS.md\n` and resolved to nothing.
// Any other Claude-specific name would hide the shared instructions.
const compatibilityName = "CLAUDE.md";
const compatibilityTarget = "AGENTS.md";
const forbiddenNames = ["CLAUDE.local.md", ".claude/CLAUDE.md"];

// Nearest AGENTS.md walking up from a path, as a hierarchical loader resolves it.
const discoveryCases = [
  ["README.md", "AGENTS.md"],
  ["client/src/app", "client/AGENTS.md"],
  ["server/src/modules", "server/AGENTS.md"],
  ["reviewer-core/src", "reviewer-core/AGENTS.md"],
  ["e2e/specs", "e2e/AGENTS.md"],
];

function fail(message) {
  throw new Error(message);
}

function git(...args) {
  return execFileSync("git", ["-c", `safe.directory=${repoRoot}`, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

/** Relative Markdown link targets without anchors; external and anchor-only links are skipped. */
function relativeLinks(markdown) {
  const targets = [];
  for (const [, target] of markdown.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue;
    targets.push(decodeURIComponent(target.split("#")[0]));
  }
  return targets;
}

function closestAgents(startPath) {
  let current = path.resolve(repoRoot, startPath);
  if (path.extname(current)) current = path.dirname(current);
  while (current === repoRoot || current.startsWith(repoRoot + path.sep)) {
    const candidate = path.join(current, "AGENTS.md");
    if (existsSync(candidate) && lstatSync(candidate).isFile()) {
      return path.relative(repoRoot, candidate).split(path.sep).join("/");
    }
    if (current === repoRoot) break;
    current = path.dirname(current);
  }
  return undefined;
}

let failures = 0;

function check(run) {
  try {
    console.log(`ok   ${run()}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${error.message}`);
  }
}

for (const instructionPath of instructionPaths) {
  check(() => {
    const absolutePath = path.join(repoRoot, instructionPath);
    const mode = git("ls-files", "--stage", "--", instructionPath).split(/\s+/, 1)[0];
    if (mode !== "100644") fail(`${instructionPath}: Git mode is ${mode || "untracked"}, expected 100644`);
    if (!existsSync(absolutePath) || !lstatSync(absolutePath).isFile()) {
      fail(`${instructionPath}: not a regular file in the worktree`);
    }
    const content = readFileSync(absolutePath, "utf8");
    if (!content.trim()) fail(`${instructionPath}: empty`);
    const broken = relativeLinks(content).filter(
      (target) => !existsSync(path.resolve(path.dirname(absolutePath), target)),
    );
    if (broken.length > 0) fail(`${instructionPath}: unresolved links ${broken.join(", ")}`);
    return `${instructionPath} is a regular file with resolvable links`;
  });
}

// The hierarchy is explicit in both directions: each package file extends the
// root, and the root map links each package file.
for (const packagePath of packageInstructions) {
  check(() => {
    const content = readFileSync(path.join(repoRoot, packagePath), "utf8");
    if (!content.includes("](../AGENTS.md)")) fail(`${packagePath}: does not link its parent ../AGENTS.md`);
    return `${packagePath} extends ../AGENTS.md`;
  });
  check(() => {
    const root = readFileSync(path.join(repoRoot, rootInstructions), "utf8");
    if (!root.includes(`](${packagePath})`)) fail(`${rootInstructions}: repository map does not link ${packagePath}`);
    return `${rootInstructions} links ${packagePath}`;
  });
}

for (const directory of instructionPaths.map((p) => path.posix.dirname(p))) {
  const compatibilityPath = path.posix.join(directory, compatibilityName);
  check(() => {
    const [mode, blob] = git("ls-files", "--stage", "--", compatibilityPath).split(/\s+/);
    if (mode !== "120000") fail(`${compatibilityPath}: Git mode is ${mode || "untracked"}, expected symlink 120000`);
    const storedTarget = execFileSync("git", ["-c", `safe.directory=${repoRoot}`, "cat-file", "blob", blob], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    if (storedTarget !== compatibilityTarget) {
      fail(`${compatibilityPath}: Git stores target ${JSON.stringify(storedTarget)}, expected "${compatibilityTarget}"`);
    }
    const absolutePath = path.join(repoRoot, compatibilityPath);
    if (!existsSync(absolutePath) || !lstatSync(absolutePath).isSymbolicLink()) {
      fail(`${compatibilityPath}: not a symlink in the worktree`);
    }
    if (readlinkSync(absolutePath) !== compatibilityTarget || !statSync(absolutePath).isFile()) {
      fail(`${compatibilityPath}: does not resolve to the sibling ${compatibilityTarget}`);
    }
    return `${compatibilityPath} is a symlink to ${compatibilityTarget}`;
  });
  for (const name of forbiddenNames) {
    const relativePath = path.posix.join(directory, name);
    check(() => {
      if (git("ls-files", "--", relativePath)) fail(`${relativePath}: tracked; it would shadow AGENTS.md`);
      if (existsSync(path.join(repoRoot, relativePath))) {
        fail(`${relativePath}: present in the worktree; it would shadow AGENTS.md`);
      }
      return `no ${relativePath}`;
    });
  }
}

for (const [startPath, expected] of discoveryCases) {
  check(() => {
    const actual = closestAgents(startPath);
    if (actual !== expected) fail(`${startPath}: nearest AGENTS.md is ${actual ?? "missing"}, expected ${expected}`);
    return `${startPath} resolves to ${actual}`;
  });
}

if (failures > 0) {
  console.error(`\n${failures} agent-instruction check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log("\nAll agent-instruction checks passed.");
}
