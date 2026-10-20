# agent-browser usage

The agent-browser commands the flows actually use, how each one serves as an
assertion, and how to debug a failing step. The suite is pinned to nothing:
CI installs the latest `agent-browser`, and local runs use whatever is
installed (`agent-browser --version`). Limits found with **0.27.0** are
recorded in [`../LEARNINGS.md`](../LEARNINGS.md); this page links to them
rather than repeating them.

## Vocabulary in use

| Command | Used for | Fails when |
| --- | --- | --- |
| `open <url>` | Starting every flow on a fresh document. | Navigation fails. |
| `wait --url <part>` | Asserting a route or query, e.g. `tab=findings`. | The URL never contains it. |
| `wait --text <text>` | Asserting visible copy or seeded data (substring). | The text never appears. |
| `wait --load networkidle` | Letting PR data settle after navigation. | Timeout. |
| `wait <css>` | Asserting that an element exists, e.g. `[role=tooltip]`. | It never appears. |
| `wait --fn <js>` | Polling a JavaScript condition, including "is gone": `!document.querySelector(…)`. | The condition never becomes truthy. |
| `wait <ms>` | A fixed pause, only before checking a browser event that is dispatched asynchronously (a scroll event). | Never. |
| `find text <t> click` / `find role button click --name <n>` | Clicking by visible text or accessible name. | No match. |
| `click <css>` | Clicking an element by CSS selector when no text or role locator fits. | No match. |
| `eval <js>` with `assert.stdoutIncludes` | Reading a value back (stdout is JSON-quoted) and checking a substring, e.g. `"open, at end, last finding visible"`. | The script throws, or the substring is missing. |
| `hover <css>`, `focus <css>`, `press <key>` | Real pointer and keyboard input on an element. | No match. |
| `mouse move x y`, `mouse down`, `mouse up` | Real input at viewport coordinates, e.g. dragging a scrollbar thumb. | Never by itself; pair it with an assertion. |
| `scroll <dir> <px> --selector <css>` | Scrolling an element in place. | No match. |
| `set viewport w h` | Pinning layout before coordinate-based steps. | Never. |

## Writing assertions

- **Prefer `wait --*`** over `eval` plus `stdoutIncludes`: a wait retries
  until its timeout, while `eval` checks once.
- **Use `eval`** for a value that is only ready after an explicit
  `wait <ms>`, or for a compound check you want reported as a single label.
- **Return a sentence**, such as `'open, scrollTop > 0'`, rather than a bare
  `true`. A failure then prints what was actually seen (`stdout: "closed"`).
- **Coordinates are fragile:** fonts are system-local, so CI and laptops lay
  out differently. Before any `mouse` step, pin the geometry (a viewport width
  that triggers a clamp, a fixed scroll position) and add a `wait --fn`
  precondition that `document.elementFromPoint(x, y)` is the intended element.
  `07a` shows the pattern.

## Debugging a failing flow

1. **Read the summary:** the runner prints `✗ <label> — Command failed:
   agent-browser <args>`, the first line of the error, which names the failing
   command. agent-browser's own reason is on its stderr, which the runner does
   not print, so replay the step (step 3) to see it. "Wait timed out" means the
   condition never held; "Element not found" means a locator matched nothing.
2. **Open the screenshot:** `e2e/test-results/<flow>-fail.png` was taken at
   the failing step. In CI it is the `e2e-failure` artifact.
3. **Replay by hand** against the same stack, in a named session so it does not
   collide with a running suite:

   ```bash
   AGENT_BROWSER_SESSION=debug agent-browser open http://localhost:3100/
   ```

   Then paste the flow's commands one by one. `agent-browser eval
   "document.body.innerText"` shows what the page actually says.
4. **Check for state from an earlier flow:** the session is shared. If a flow
   passes alone but fails in the suite, look at what the earlier flow left:
   the URL, `localStorage`, or the viewport.
5. **Close the session** with `agent-browser close` when done.
