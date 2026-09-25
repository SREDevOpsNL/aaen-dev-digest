# Next.js App Router organization

Read this reference when the architecture decision involves `client/src/app` or a server/client component boundary.

## Route tree

- A folder under `app` defines a route segment, but it is not publicly routable until it contains a `page` or `route` file.
- Colocate route-private code safely. Use `_components`, `_lib`, or another underscore-prefixed folder when marking implementation details improves navigation and protects against future file-convention conflicts.
- Use route groups `(name)` to organize sections or apply layouts without changing URLs. Do not introduce them only for visual tidiness.
- Keep `page.tsx` and `layout.tsx` focused on route concerns and composition. Put substantial feature UI in colocated components.

## Server and client boundaries

- Start with Server Components. Add `"use client"` at the smallest interactive boundary that needs state, effects, event handlers, or browser APIs.
- Pass serializable data across the server/client boundary. Do not move an entire route client-side because one leaf is interactive.
- Keep secrets, privileged I/O, and server-only dependencies out of client modules.
- Treat Server Actions and route handlers as transport/application boundaries, not as places for presentation logic.

## DevDigest convention

The active client uses App Router, thin pages, colocated `_components/<Name>/` folders, `@/*` imports, typed hooks in `src/lib/hooks`, and `next-intl`. Preserve these choices unless a cross-cutting design change is explicitly requested. Do not modify `src/vendor/ui` for ordinary feature organization.

## Example

```text
src/app/skills/
  page.tsx
  [id]/page.tsx
  _components/
    SkillEditor/
      SkillEditor.tsx
      SkillEditor.test.tsx
      _components/
  constants.ts
  helpers.ts
```

The example shows ownership, not a mandatory template. A smaller feature should remain smaller.
