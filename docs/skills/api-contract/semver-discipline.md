# semver-discipline

Description: Flag a contract change whose version signal does not match its impact — a breaking change shipped without a major version or a new API version, or a version bump that claims more or less than the diff does — so that clients can trust the version to tell them when to change.

## What to flag

- A breaking change (see `breaking-change`) in a package, SDK or API whose version, version prefix or changelog does not announce a new major version.
- A minor or patch bump in `package.json`, an OpenAPI `info.version` or a changelog entry for a change that breaks clients.
- A major bump or new API version for a purely additive change, which forces clients to migrate for nothing.
- A changelog entry that omits a contract change the diff makes.

## Severity

- CRITICAL: a breaking change released under a minor or patch version, or under the same API version.
- WARNING: a missing or inaccurate changelog entry for a contract change.
- SUGGESTION: an unnecessary major bump for an additive change.

## Not a finding

- Version numbers of private packages that no client consumes.
- Internal refactors with no contract change.

## Good

The package version and the changelog both announce the breaking rename.

```json
{ "name": "@acme/payments-client", "version": "3.0.0" }
```

```markdown
## 3.0.0
- BREAKING: `Order.customer_id` is renamed to `Order.customer.id`.
```

## Bad

The same breaking rename shipped as a patch release.

```json
{ "name": "@acme/payments-client", "version": "2.4.1" }
```
