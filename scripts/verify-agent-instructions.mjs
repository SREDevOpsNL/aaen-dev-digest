// Verifies the repository side of the AGENTS.md instruction contract.
// Run from anywhere: `node scripts/verify-agent-instructions.mjs`. CI runs it on
// every pull request (.github/workflows/agent-instructions.yml).
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// AGENTS.md is the only repository instruction file. Each must be a regular,
// non-empty file: a symlink can silently resolve to nothing on another checkout.
const rootInstructions = "AGENTS.md";
const packageInstructions = ["client/AGENTS.md", "server/AGENTS.md", "reviewer-core/AGENTS.md", "e2e/AGENTS.md"];
const instructionPaths = [rootInstructions, ...packageInstructions];

// Some agents prefer these names over AGENTS.md, so any of them in an
// instruction directory would hide the shared instructions from that agent.
const shadowingNames = ["CLAUDE.md", "CLAUDE.local.md", ".claude/CLAUDE.md"];

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
  for (const name of shadowingNames) {
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
