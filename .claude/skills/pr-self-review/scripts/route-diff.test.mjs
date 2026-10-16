// node --test .claude/skills/pr-self-review/scripts/route-diff.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildReport, routeFile } from "./route-diff.mjs";

/** A throwaway repo whose `main` holds one committed file per package. */
function fixtureRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "route-diff-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "route-diff test");
  write(dir, "client/src/app/page.tsx", "export default function Page() { return null; }\n");
  write(dir, "server/src/modules/skills/service.ts", "export const a = 1;\n");
  write(dir, "README.md", "# fixture\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  git("checkout", "-q", "-b", "feature");
  return { dir, git, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function write(dir, file, content) {
  mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  writeFileSync(path.join(dir, file), content);
}

const skillsOf = (report) => Object.keys(report.skills).sort();

test("client-only change loads only frontend skills", () => {
  const repo = fixtureRepo();
  try {
    write(repo.dir, "client/src/app/page.tsx", "export default function Page() { return <main />; }\n");
    const report = buildReport({ cwd: repo.dir, base: "main" });
    assert.deepEqual(skillsOf(report), ["frontend-ui-architecture", "next-best-practices", "react-best-practices", "typescript-expert"]);
    assert.deepEqual(report.checks.map((c) => c.package), ["client"]);
  } finally {
    repo.cleanup();
  }
});

test("server-only change loads only backend skills", () => {
  const repo = fixtureRepo();
  try {
    write(repo.dir, "server/src/modules/skills/service.ts", "export const a = 2;\n");
    const report = buildReport({ cwd: repo.dir, base: "main" });
    assert.deepEqual(skillsOf(report), ["onion-architecture", "typescript-expert"]);
    assert.deepEqual(report.checks.map((c) => c.package), ["server"]);
  } finally {
    repo.cleanup();
  }
});

test("mixed client + server diff loads both skill sets at once", () => {
  const repo = fixtureRepo();
  try {
    write(repo.dir, "client/src/app/page.tsx", "export default function Page() { return <main />; }\n");
    write(repo.dir, "server/src/modules/skills/routes.ts", "export {};\n"); // untracked new route
    repo.git("add", "client/src/app/page.tsx"); // staged
    const report = buildReport({ cwd: repo.dir, base: "main" });
    for (const skill of ["frontend-ui-architecture", "react-best-practices", "next-best-practices", "onion-architecture", "fastify-best-practices", "zod"]) {
      assert.ok(report.skills[skill], `missing ${skill}`);
    }
    assert.deepEqual(report.skills["onion-architecture"].files, ["server/src/modules/skills/routes.ts"]);
    assert.deepEqual(report.skills["frontend-ui-architecture"].files, ["client/src/app/page.tsx"]);
    assert.deepEqual(report.checks.map((c) => c.package), ["client", "server"]);
  } finally {
    repo.cleanup();
  }
});

test("committed, renamed and untracked files are all collected", () => {
  const repo = fixtureRepo();
  try {
    repo.git("mv", "server/src/modules/skills/service.ts", "server/src/modules/skills/skill-service.ts");
    repo.git("commit", "-q", "-m", "rename");
    write(repo.dir, "client/src/lib/new-helper.test.ts", "export {};\n");
    const report = buildReport({ cwd: repo.dir, base: "main" });
    const rename = report.files.find((f) => f.status === "R");
    assert.equal(rename.path, "server/src/modules/skills/skill-service.ts");
    assert.equal(rename.from, "server/src/modules/skills/service.ts");
    const untracked = report.files.find((f) => f.status === "?");
    assert.equal(untracked.path, "client/src/lib/new-helper.test.ts");
    assert.ok(untracked.skills.includes("react-testing-library"));
  } finally {
    repo.cleanup();
  }
});

test("docs-only change forces no code skill; imported clones are never read", () => {
  const repo = fixtureRepo();
  try {
    write(repo.dir, "README.md", "# fixture, edited\n");
    write(repo.dir, "server/clones/acme/repo/AGENTS.md", "untrusted imported content\n");
    const report = buildReport({ cwd: repo.dir, base: "main" });
    assert.deepEqual(report.files.map((f) => f.path), ["README.md"]);
    assert.deepEqual(skillsOf(report), []);
    assert.deepEqual(report.unrouted, ["README.md"]);
    assert.deepEqual(report.checks, []);
  } finally {
    repo.cleanup();
  }
});

test("markdown inside a package triggers no package checks", () => {
  const repo = fixtureRepo();
  try {
    write(repo.dir, "server/AGENTS.md", "# server\n");
    write(repo.dir, "e2e/README.md", "# e2e\n");
    const report = buildReport({ cwd: repo.dir, base: "main" });
    assert.deepEqual(report.checks.map((c) => c.package), ["agent-instructions"]);
  } finally {
    repo.cleanup();
  }
});

test("a change to this workflow also lists its own router tests", () => {
  const repo = fixtureRepo();
  try {
    write(repo.dir, ".claude/skills/pr-self-review/scripts/route-diff.mjs", "export {};\n");
    const report = buildReport({ cwd: repo.dir, base: "main" });
    assert.deepEqual(report.checks, [
      {
        package: "agent-instructions",
        cwd: ".",
        commands: [
          "node scripts/verify-agent-instructions.mjs",
          "node --test .claude/skills/pr-self-review/scripts/route-diff.test.mjs",
        ],
      },
    ]);
  } finally {
    repo.cleanup();
  }
});

test("an unknown base fails clearly", () => {
  const repo = fixtureRepo();
  try {
    assert.throws(() => buildReport({ cwd: repo.dir, base: "no-such-ref" }), /does not resolve/);
  } finally {
    repo.cleanup();
  }
});

test("routing table: persistence, security and contracts", () => {
  assert.deepEqual(routeFile("server/src/db/schema/skills.ts").skills, ["drizzle-orm-patterns", "postgresql-table-design"]);
  assert.ok(routeFile("server/src/modules/agents/repository.ts").skills.includes("drizzle-orm-patterns"));
  assert.ok(routeFile("server/src/adapters/github/octokit.ts").skills.includes("security"));
  assert.ok(routeFile("reviewer-core/src/prompt.ts").skills.includes("security"));
  assert.deepEqual(routeFile("server/src/vendor/shared/contracts/knowledge.ts").skills, ["zod", "typescript-expert"]);
  assert.deepEqual(routeFile("client/src/vendor/ui/nav.ts").skills, []);
});
