# breaking-change

Description: Flag any change to a published API route that can break an existing client — a removed or renamed route, query parameter, header or field, a changed field type or meaning, a parameter whose lookup key or interpretation changes in place, a newly required input, or a narrowed set of accepted values — unless it ships under a new API version.

## What to flag

- A route, query parameter, header, request field or response field that is removed or renamed on an existing route.
- A path or query parameter whose lookup key or interpretation changes in place, so an existing request now resolves to a different resource, an empty result or a 404, even when the route pattern is unchanged.
- A field whose type, unit, format or meaning changes, such as an integer that becomes a float or a timestamp that changes format.
- An enum value removed or renamed in a request or a response.
- An input that becomes required, or validation that rejects values the route accepted before.
- A changed default, status code or error shape that clients branch on.

Judge a path parameter by the value a client sends and how the handler uses it, not by its name: a client never sends the placeholder name.

## Severity

- CRITICAL: a removal, rename or type change on an existing published route, or a parameter whose lookup key or interpretation changes in place.
- WARNING: a newly required input, narrowed validation, or a changed default, status code or error shape.
- SUGGESTION: an additive change that is safe but undocumented, or a renamed path placeholder that also renames the parameter in a published OpenAPI document or SDK.

## Not a finding

- New optional request fields, new response fields and new routes.
- Renaming only a path placeholder in route code (for example `:id` to `:orderId`) while the handler reads the same value the same way.
- The same change shipped under a new version prefix while the old version keeps its contract.
- Internal handlers and modules that no client can call.

## Good

```ts
// The existing route keeps its contract; the new shape ships as v2.
app.get('/v1/orders/:id', async (req) => ({ id: order.id, customer_id: order.customerId }));
app.get('/v2/orders/:id', async (req) => ({ id: order.id, customer: { id: order.customerId } }));
```

## Bad

```ts
// Renames a field in place on v1: every client that reads customer_id breaks.
app.get('/v1/orders/:id', async (req) => ({ id: order.id, customerId: order.customerId }));
```
