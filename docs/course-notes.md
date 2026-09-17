# Course Notes

Notes from the course session, translated to English.

## Onboarding: LMS registration and course chat space

You need to do two main things: register in the LMS and join the BetterED learning chat/space.

1. **Register in the LMS**
   - In the email, find the link after the words "Step 1. Follow the link."
   - Open it.
   - Choose a password.
   - Click "Register."
   - For future logins use:
     - Email: `dimi.martynov@gmail.com`
     - Password: the one you just created.
   - Save the password in a password manager right away.
2. **Check regular login to the LMS**
   - After registering, open their permanent "Login" link.
   - Try logging in with `dimi.martynov@gmail.com`.
   - Make sure you can see your "AI Agentic Engineering" course and the base materials.
3. **Join the learning space for communication**
   - Find in the email: "Learning space for communication: link."
   - Follow it and join.
   - This is where the mentor, manager, other students, and questions about assignments will be.
4. **Optionally install the mobile app**
   - The email should contain App Store / Google Play buttons/logos.
   - This is optional — you can study through the browser.
5. **After logging in, check right away**
   - that your name is correct;
   - that the correct course is available;
   - the start date;
   - the class schedule;
   - which materials need to be completed before the first class;
   - where the class recordings are located;
   - where to submit homework assignments.

**Important note:** in the text supplied, the raw URLs themselves are not visible — only the words "link" and "Login" appear. In the original email they are presumably clickable. Also note: BetterED registered the account under `dimi.martynov@gmail.com`. Use that address, not a different Gmail address. So the first action is: open the LMS registration link → create a password → log in → then join the learning space. After that, you can start on the base materials.

## Key Concepts — Harness Engineering as a discipline

**Harness** is everything that surrounds the model and turns it into a manageable system:

- Skills
- MCP
- Subagents
- Hooks
- Checks

The formula **Agent = Model + Harness** ("if you're not the model, you're the harness") was popularized by LangChain (Vivek Trivedy, "The Anatomy of an Agent Harness," March 10, 2026) and HumanLayer (Kyle, "Skill Issue: Harness Engineering," March 12, 2026).

Central thesis on why the harness matters: "It's not a model problem. It's a configuration problem" — most agent failures are a matter of configuration and context, not the chosen model itself.

### The 4 pillars of a harness

- **Skills** — system knowledge in the form of `SKILL.md` files, loaded on demand when keywords during an agent run match the skill's stated `description`.
- **Subagents** — specialized executors with isolated context. HumanLayer calls them a "context firewall": heavy work runs separately and doesn't pollute the main context.
- **MCP** (Model Context Protocol — a standard for connecting external tools and data) — adds tools, but every extra one bloats the system prompt.
- **Hooks** — lifecycle stages you can attach a check or command to. Fires automatically. Control without the model's involvement.

Both large and small companies see building a harness suited to their own tasks as a priority, in order to deliver features, run refactors, and generally carry out any operation as efficiently as possible. A harness helps both distribute contextual knowledge about a project or its systems, and raise the quality and control of code generation.

This isn't only for engineers. Non-engineers in any department — product managers, HR, anyone — also use it, and they need the same kind of context you do. They use subagents, agents, skills, MCP servers — possibly just not hooks.

That's why a harness becomes not only an engineering asset, but an asset of the whole company. That's exactly why it's important to invest in building a harness for your team, company, or organization. This should really have been done a long time ago, but better to start now than never — or tomorrow.

### Harness Engineering — the core idea (summary)

**Harness** is everything around the LLM that turns the model from a plain generator into a managed agentic system.

Formula: `Agent = Model + Harness`

In other words, an agent's quality doesn't depend only on the model itself, but largely on the context, tools, rules, and automatic checks that surround it.

Hence the central thesis: **"It's not a model problem. It's a configuration problem."** Many agent problems arise not because the model is "weak," but because of a poorly built harness: wrong context, excess tools, missing rules, or no checks.

**1. Skills** — reusable knowledge and instructions, usually in `SKILL.md`. A skill describes when and how the agent should perform a certain type of work, and it is loaded when relevant to the task.
```
repeated prompt
     ↓
formalized Skill
     ↓
stable agent capability
```

**2. Subagents** — specialized agents with their own separate context. Their big advantage is context isolation. Heavy or narrowly specialized work is done separately and doesn't pollute the main context window.
```
Main Agent
   ├─ Security Agent
   ├─ Test Agent
   ├─ Research Agent
   └─ Code Review Agent
```
A subagent effectively acts as a context firewall.

**3. MCP** — Model Context Protocol — a standard for connecting external systems, tools, and data sources. For example, an agent can use MCP to reach:
```
GitHub
Jira
Database
Browser
Cloud
Documentation
Internal APIs
```
Important trade-off: every additional MCP/tool increases context size and harness complexity. So don't give the agent every possible tool "just in case."

**4. Hooks** — automatic actions at certain points in the agent's lifecycle. For example:
```
Agent edits code
      ↓
Hook
      ↓
format
lint
tests
security check
```
Their strength: control doesn't depend on whether the model "remembers" to run the check. That's why hooks are well suited for deterministic guardrails.

### Why companies need a harness

A harness lets a company accumulate not just AI prompts, but effectively its operational knowledge:
```
Architecture knowledge
Coding rules
Domain knowledge
Processes
Quality gates
Security policies
Tools
Workflows
        ↓
      Harness
        ↓
     AI Agents
```
Instead of every employee separately explaining to the AI "here's how we do this," that knowledge is encoded once, in the harness. As a result, agents work more predictably, repeatably, consistently, and with better control.

### Not just for developers

Harness engineering is gradually spreading beyond software engineering. Similar systems can be used by product managers, HR, analysts, sales, operations, and management. They too can have skills, agents/subagents, MCP, and company context. The difference is that engineering hooks/checks may matter less for them.

### The most important takeaway

A harness is gradually becoming part of a company's intellectual infrastructure. Previously a company accumulated: code, documentation, CI/CD, runbooks, processes. Now one more layer is added: the **Agent Harness** — the place where you can formalize how AI should work inside a specific organization.

One diagram worth remembering for the course:
```
                 AGENT
                   │
          ┌────────┴────────┐
          │      MODEL      │
          │         +       │
          │     HARNESS     │
          └────────┬────────┘
                   │
       ┌───────────┼───────────┐
       │           │           │
     Skills    Subagents      MCP
                               │
                            External
                             tools
                   │
                 Hooks
                   │
             deterministic
                checks
```
Main mental model: the model provides intelligence. The harness gives it context, specialization, tools, and control. This builds on Addy Osmani's earlier material: specs, skills, tests, CI, rules, runtime feedback, and bounded tasks are all different elements of one and the same agent harness.

## Dev Digest Walkthrough

Over the course we build **DevDigest** — a local AI pull-request review lab. A full product that grows with you: every lesson adds one or two features, and later features reuse the results of earlier ones — both in code and in tokens. For example, a PR risk card in lesson five is nearly free, because it collects what you already built in lessons three and four.

What the product does:
- you add any GitHub repository — the app clones it locally and imports its open PRs;
- you create your own reviewer agents — an agent is a model + system prompt + connected knowledge;
- the agent walks the diff and produces structured findings with severity and a link to the specific lines;
- you accept useful findings and reject noisy ones — gradually teaching the system what matters for your team;
- by the end of the course, the tuned agents can be exported into CI — and they will review every new PR in GitHub Actions automatically, without you.

There are two agent types: **reviewer** — reviews changes, and **plan-verifier** — checks the implementation against the spec and can block a merge if a required item isn't fulfilled.

> DevDigest is local-first: code doesn't leave your machine, keys are stored locally. For companies with restrictions on AI tools, this is often the deciding factor.

**Stack:** a pnpm monorepo in TypeScript — Next.js (UI), Fastify (local engine: git, PR import, agent runs), Postgres + pgvector in Docker. The product's models run through OpenRouter (one key — dozens of models). The template already includes a `repo-intel` module — an index of symbols and an import graph of the repository: you don't write it, but you use it in almost every lesson.

**Limitations:** the review itself works with any language (the agent reads the diff, and a diff is text), but deep code analytics — indexing, impact mapping — is tailored to JS/TS. Don't add giant monorepos: every run costs real tokens.

### Two planes we keep in mind throughout the course

**Dev-harness** — what we use to build DevDigest with: Claude Code with skills, subagents, MCP, and hooks. Here you learn to work with agents as an engineer.

**DevDigest runtime** — what the product itself runs on: models via OpenRouter, reviewer agents inside the app. Here you learn to build agentic systems for other people.

> You're simultaneously learning to work inside a harness — and to build a harness. That, in fact, is the agentic engineer profession.

DevDigest is a local application; everything runs on your machine, and later you'll deploy it to a server.

- App to copy: [github.com/burnjohn/dev-digest](https://github.com/burnjohn/dev-digest)
- App design: Google Drive (link provided in the course email)

Be sure to save these links — you'll need them.

**What you'll learn:**
- Success in AI development isn't manual back-and-forth with code, it's spec/plan + harness + checks.
- The 4 components of a harness — Skills, Subagents, MCP, Hooks — and when to use which, by context cost.
- 5 phases of the workflow on a real feature — and the typical failure mode of each phase.
- Setting up Claude Code, Emdash, and other tools.
- The first DevDigest feature and the first skill in your own harness.
- The first reviewer agent on a real PR.
- AI work metrics (DORA / DX Core 4) instead of gut feel.

### Summary — Dev Digest Walkthrough

**Main idea:** DevDigest is a local-first learning product you build progressively throughout the course. Its purpose is to teach you not just to use AI to write code, but to build your own managed agentic system for code review. Each lesson adds a new part of the product, and later features reuse components and results from earlier agents. The system progressively accumulates capabilities, and later features become cheaper in tokens because they reuse information already produced.

**What DevDigest does — workflow:**
```
GitHub repository
      ↓
local clone
      ↓
import open PRs
      ↓
PR diff
      ↓
AI reviewer
      ↓
structured findings
      ↓
human accepts / rejects findings
      ↓
system learns what matters
      ↓
export reviewer into CI
```
You add a GitHub repository, and DevDigest: clones it locally; imports open PRs; lets you run AI reviewers; analyzes the diff; returns structured findings; assigns severity; links findings to specific lines of code.

**The core object of the system — the Agent:**
```
Agent = Model + System Prompt + Connected Knowledge
```
This is the practical application of the earlier formula, Agent = Model + Harness. Users can create their own reviewer agents and configure exactly what they should look for in a PR.

**Human feedback is part of the system.** An agent doesn't just generate findings — you can Accept or Reject each one. This gives the system a growing signal about which findings are useful, what is noise, and what specifically matters for this team. That lays the groundwork for further improving the reviewers.

**Two agent types:**
1. **Reviewer** — analyzes PR changes, e.g. looking for bugs, security problems, architecture violations, risky changes, maintainability issues. Produces structured findings.
2. **Plan-verifier** — checks whether the actual implementation matches what was defined in the specification. If a required requirement isn't fulfilled, the plan-verifier can block the merge. This is close to the pattern: Spec → Implementation → Automated verification → Merge gate.

**End result — CI integration.** DevDigest starts out running locally. By the end of the course, tuned reviewers can be exported into GitHub Actions, so the agent will automatically review every new PR. A learning prototype gradually turns into a real engineering tool.

**Local-first architecture.** The repository is cloned locally, code stays on the machine, credentials/API keys are stored locally, and the app itself runs locally. This is positioned as an advantage for companies with restrictions on AI tools. At the same time, models are called through OpenRouter — meaning the text sent to the model for inference is naturally sent to the respective AI provider via OpenRouter. The claim "code doesn't leave your machine" should be understood in the context of local-first application architecture, not as a claim of fully offline LLM inference.

**Tech stack:** DevDigest is a pnpm monorepo in TypeScript.
```
DevDigest
│
├── Next.js
│     └── UI
│
├── Fastify
│     └── local engine
│         ├── git
│         ├── PR import
│         └── agent execution
│
├── PostgreSQL
│
├── pgvector
│
└── OpenRouter
      └── LLM models
```
Postgres + pgvector run via Docker.

**OpenRouter.** DevDigest isn't tied to a single LLM provider — models are called through OpenRouter, and one API key gives access to dozens of models. This fits the course's earlier idea: the model is an interchangeable component; the harness is the more stable asset.

**Repo-intel.** The template already includes a `repo-intel` module (you don't build it yourself), which creates a symbol index and an import graph of the repository — giving the agent more information than a raw diff, e.g. tracing a changed function to who imports it, what modules depend on it, and potential impact.

**Important limitation.** The review itself can work with practically any language, because diff = text and an LLM can read C#, Python, Java, Go, etc. But DevDigest's deep code analytics are optimized for JavaScript/TypeScript — in particular symbol indexing, the dependency/import graph, and impact analysis. So the full set of capabilities works best with JS/TS repositories.

**Don't use giant monorepos.** Every agent operation consumes real tokens — a larger repo means a larger context, which means more tokens, which means higher cost. This is also a practical lesson in context engineering.

### The most important concept of the course — two planes

This is probably the most important part of this walkthrough. The course has two agentic layers at once.

**1. Dev-harness** — the system you use to develop DevDigest with. Main tool: Claude Code, plus Skills, Subagents, MCP, and Hooks. Here you learn to work with AI agents as a software engineer.

**2. DevDigest runtime** — the agentic system you're building. DevDigest → OpenRouter → Reviewer agents / Plan-verifier agents. Here you learn to build AI agents for other users.

So the course has a recursive structure:
```
        DEV HARNESS
            │
            │ builds
            ▼
        DEV DIGEST
            │
            │ contains
            ▼
        AI HARNESS
            │
            ▼
      Reviewer Agents
```
This is what's behind the course's framing: **you're simultaneously learning to work inside a harness — and to build a harness.** By the material's logic, that's exactly one of the key competencies of an agentic engineer.

**What this module should teach — AI development process:**
```
Spec / Plan
     +
Harness
     +
Checks
     ↓
Reliable AI development
```
rather than an endless loop of prompt → AI code → something broke → another prompt → another fix.

The course should also teach: when to use Skills; when Subagents are needed; when to connect MCP; when control is better put into Hooks; how to account for context cost; how to go through the 5 phases of AI-assisted development; how to create your first Skill; how to create your first reviewer agent; how to evaluate results not "by feel" but through DORA / DX Core 4 metrics.

**Full DevDigest concept, in one diagram:**
```
                   COURSE
                     │
        ┌────────────┴─────────────┐
        │                          │
   DEV HARNESS                DEV DIGEST
        │                          │
   Claude Code                 TypeScript
        │                          │
 ┌──────┼───────┐           Next.js + Fastify
 │      │       │                  │
Skills Agents   MCP             repo-intel
 │      │       │                  │
 └──── Hooks ───┘              OpenRouter
                                   │
                         ┌─────────┴─────────┐
                         │                   │
                     Reviewer          Plan Verifier
                         │                   │
                         └─────────┬─────────┘
                                   │
                              GitHub CI
```

**Three key takeaways before the hands-on work:**
1. You're not just using agentic development — you're building your own agentic system.
2. DevDigest is a training ground where every next capability builds on prior results, context, and infrastructure.
3. The course's central engineering pattern: **Spec + Harness + Automated Checks → controlled AI development.**

The plan-verifier is especially notable, since conceptually it closely mirrors the specification → implementation → verification → quality/merge gate pattern used elsewhere.
