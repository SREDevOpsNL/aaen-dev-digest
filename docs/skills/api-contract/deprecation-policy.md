# deprecation-policy

Description: Flag the removal or incompatible change of a route, parameter or field that was not first deprecated — announced with `Deprecation` and `Sunset` response headers, documented, and kept working for the published window — and flag new deprecations that omit those signals.

## What to flag

- A route, parameter or field removed or changed incompatibly without an earlier, documented deprecation.
- A removal that happens before the announced sunset date, or before the end of the deprecation window that the project's documented policy sets, when it sets one (for example, a policy that requires one minor release and 90 days).
- A new deprecation without `Deprecation` and `Sunset` headers, without documentation, or without the replacement clients should use.
- A deprecated element whose usage is not logged or measured, so its removal cannot be judged safe.

## Severity

- CRITICAL: removal of an element that was never deprecated, or removal before its sunset date.
- WARNING: a deprecation that is missing headers, documentation or a named replacement.
- SUGGESTION: a deprecation without usage logging.

## Not a finding

- Removing an element after its documented sunset date has passed.
- Changes to internal code that no client can call.

## Good

```ts
// Deprecated with headers and a named replacement; removed only after the sunset date.
reply.header('Deprecation', 'true');
reply.header('Sunset', 'Wed, 31 Mar 2027 00:00:00 GMT');
reply.header('Link', '</v2/orders>; rel="successor-version"');
```

## Bad

The v1 route disappears in the same release that introduces v2; clients get a 404 with no warning.

```diff
- app.get('/v1/orders/:id', getOrderV1);
+ app.get('/v2/orders/:id', getOrderV2);
```
