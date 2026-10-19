# response-schema

Description: Flag a response whose runtime shape is not described by its declared response schema — a field returned but not declared, a declared field no longer returned, a nullability or type mismatch, or a new route without a response schema — because clients and generated SDKs trust the declared contract.

## What to flag

- A handler that adds, removes or renames a returned field without updating the route's declared response schema (Zod, JSON Schema or OpenAPI).
- A field that can now be `null` or missing while the schema declares it required and non-null.
- A declared type that no longer matches the returned value (for example a schema that says `number` for a value that is now a string).
- A new or changed route with no response schema at all.

## Severity

- CRITICAL: the declared schema promises a field or type that the handler no longer returns.
- WARNING: an undeclared field, a nullability mismatch, or a new route without a response schema.
- SUGGESTION: a schema that is correct but missing field descriptions that clients need.

## Not a finding

- Internal helpers that never reach a response.
- Schema-only refactors that keep the same validated shape.

## Good

```ts
const Order = z.object({ id: z.string(), customer_id: z.string(), shipped_at: z.string().nullable() });
app.get('/v1/orders/:id', { schema: { response: { 200: Order } } }, handler);
```

## Bad

```ts
// The schema still says shipped_at is a required string, but the handler now returns null for unshipped orders.
const Order = z.object({ id: z.string(), customer_id: z.string(), shipped_at: z.string() });
return { id: order.id, customer_id: order.customerId, shipped_at: order.shippedAt ?? null };
```
