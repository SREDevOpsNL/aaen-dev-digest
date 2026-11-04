# Frontend UI Architecture

Version **1.0.0**. This project skill guides React and Next.js architecture and code organization: component ownership, colocation, extraction, business-logic placement, constants, helpers, and App Router structure. It intentionally excludes performance tuning and detailed React/Next.js API guidance so it composes cleanly with the existing framework skills.

## Files

- [SKILL.md](SKILL.md) contains the routing and essential decisions.
- [references/organization.md](references/organization.md) covers component/module placement.
- [references/nextjs.md](references/nextjs.md) covers App Router organization.

## Sources

These are the sources used to build the skill; the skill paraphrases them rather than copying their text.

- [React: Thinking in React](https://react.dev/learn/thinking-in-react) — decompose a UI around responsibility and data flow.
- [React: Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks) — extract focused stateful logic; hooks share logic, not state.
- [React: Choosing the State Structure](https://react.dev/learn/choosing-the-state-structure) — keep state minimal and avoid redundant or contradictory representations.
- [React: Passing Data Deeply with Context](https://react.dev/learn/passing-data-deeply-with-context) — prefer explicit props/composition before context.
- [Next.js: Project Structure and Organization](https://nextjs.org/docs/app/getting-started/project-structure) — official colocation, private-folder, route-group, and `src` conventions.
- [Next.js: Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) — place client boundaries narrowly and keep server capabilities server-side.
- [Next.js Learn: App Router project structure](https://nextjs.org/learn/dashboard-app/getting-started) — official example separating route UI and reusable library code.
- [Colocation by Kent C. Dodds](https://kentcdodds.com/blog/colocation) — keep code close to the code that uses it and promote it only as ownership broadens.
- [Bulletproof React](https://github.com/alan2207/bulletproof-react) — a maintained feature-oriented reference architecture, used as an example rather than a mandatory template.

The attached lesson's `frontend-architecture` package was used as reference input and adapted to the repository's `frontend-ui-architecture` name and current conventions.
