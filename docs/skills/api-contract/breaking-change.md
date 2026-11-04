# breaking-change

Description: Flag any change to a published API route that can break an existing client — a removed or renamed route, parameter or field, a changed field type or meaning, a newly required input, or a narrowed set of accepted values — unless it ships under a new API version.

## What to flag

- A route, path parameter, query parameter, request field or response field that is removed or renamed on an existing route.
- A field whose type, unit, format or meaning changes, such as an integer that becomes a float or a timestamp that changes format.
- An input that becomes required, or validation that rejects values the route accepted before.
- A changed default, status code or error shape that clients branch on.

## Severity

- CRITICAL: a removal, rename or type change on an existing published route.
- WARNING: a newly required input, narrowed validation, or a changed default, status code or error shape.
- SUGGESTION: an additive change that is safe but undocumented.

## Not a finding

- New optional request fields, new response fields and new routes.
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
