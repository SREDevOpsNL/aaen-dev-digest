import process from "node:process";

let input = "";
for await (const chunk of process.stdin) input += chunk;

let event;
try {
  event = JSON.parse(input || "{}");
} catch {
  process.exit(0);
}

if (event.hook_event_name !== "UserPromptSubmit") process.exit(0);

console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: "Engineering Insights is active for this task. Before work, resolve the affected modules and read their LEARNINGS.md and INSIGHTS.md. At wrap-up, evaluate whether this task produced a significant, non-obvious, evidence-backed finding; append only qualifying, deduplicated entries to the relevant module INSIGHTS.md and keep LEARNINGS.md as companion durable history.",
  },
}));
