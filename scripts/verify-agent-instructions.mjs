import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const compatibilityPaths = [
  "CLAUDE.md",
  "client/CLAUDE.md",
  "server/CLAUDE.md",
  "reviewer-core/CLAUDE.md",
  "e2e/CLAUDE.md",
];
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
  return execFileSync("git", ["-c", `safe.directory=${repoRoot.replaceAll("\\", "/")}`, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

function relativeFromRoot(absolutePath) {
  return path.relative(repoRoot, absolutePath).replaceAll("\\", "/") || ".";
}

function closestAgents(startPath) {
  let current = path.resolve(repoRoot, startPath);
  if (path.extname(current)) current = path.dirname(current);

  while (current.startsWith(repoRoot)) {
    const candidate = path.join(current, "AGENTS.md");
    try {
      if (lstatSync(candidate).isFile()) return candidate;
    } catch {
      // Keep walking toward the repository root.
    }
    if (current === repoRoot) break;
    current = path.dirname(current);
  }
  return undefined;
}

let failures = 0;

for (const compatibilityPath of compatibilityPaths) {
  try {
    const absolutePath = path.join(repoRoot, compatibilityPath);
    const stat = lstatSync(absolutePath);
    const stage = git("ls-files", "--stage", "--", compatibilityPath);
    const mode = stage.split(/\s+/, 1)[0];
    if (mode !== "120000") fail(`${compatibilityPath}: Git mode is ${mode || "missing"}, expected 120000`);

    let linkTarget;
    let worktreeKind;
    if (stat.isSymbolicLink()) {
      linkTarget = readlinkSync(absolutePath);
      worktreeKind = "native symlink";
    } else {
      const coreSymlinks = git("config", "--get", "core.symlinks");
      if (coreSymlinks !== "false") fail(`${compatibilityPath}: not a native symlink`);
      linkTarget = readFileSync(absolutePath, "utf8").trim();
      worktreeKind = "Git symlink placeholder (core.symlinks=false)";
    }

    if (linkTarget.trim() !== "AGENTS.md") {
      fail(`${compatibilityPath}: target is ${JSON.stringify(linkTarget.trim())}, expected "AGENTS.md"`);
    }

    const canonicalPath = path.join(path.dirname(absolutePath), linkTarget.trim());
    const canonical = readFileSync(canonicalPath);
    if (canonical.length === 0) fail(`${relativeFromRoot(canonicalPath)}: target is empty`);

    if (stat.isSymbolicLink()) {
      const throughLink = readFileSync(absolutePath);
      if (!canonical.equals(throughLink)) fail(`${compatibilityPath}: content differs from its target`);
    }

    console.log(`ok  ${compatibilityPath} -> AGENTS.md (${worktreeKind}; readable target)`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${error.message}`);
  }
}

for (const [startPath, expected] of discoveryCases) {
  try {
    const discovered = closestAgents(startPath);
    const actual = discovered && relativeFromRoot(discovered);
    if (actual !== expected) fail(`${startPath}: closest AGENTS.md is ${actual ?? "missing"}, expected ${expected}`);
    console.log(`ok  ${startPath} discovers ${actual}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${error.message}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} agent-instruction verification check(s) failed.`);
  process.exitCode = 1;
} else {
  console.log("\nAll agent-instruction files passed verification.");
}
