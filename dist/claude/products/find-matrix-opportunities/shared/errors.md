# Errors & validation

The API uses conventional HTTP status codes and returns a JSON body describing the problem.

| Status | Meaning | What to do |
| --- | --- | --- |
| `200` / `201` | Success | — |
| `401` | Unauthenticated | Missing/invalid/expired token — check the `Authorization` header. Also check the tenant prefix: a wrong one resolves via wildcard DNS and returns this same `401` |
| `403` | Forbidden / missing scope | Body includes `required_scope`; recreate the token with that scope |
| `403 "This endpoint is not available to API tokens."` | Session-only endpoint | Not a token problem — it *proves* the token and host are good (auth runs first, so a bad token gives `401`). Account/identity routes like `/api/auth/*` and `/api/developer/*` are unreachable by design; use a domain resource instead |
| `404` | Not found | Wrong id or path (all API routes live under `/api`) |
| `409` | Conflict | The resource is locked or in a state that rejects the change |
| `422` | Validation failed | Fix the request per the `errors` map (see below) |
| `429` | Rate limited | Back off and retry after `Retry-After` |
| `5xx` | Server error | Retry with backoff; if persistent, report it |

## Validation errors (`422`)

Laravel validation errors return a per-field map:

```json
{
  "message": "The given data was invalid.",
  "errors": {
    "customer_id": ["The customer id field is required."],
    "lines.0.quantity": ["The quantity must be at least 1."]
  }
}
```

- The keys are the offending fields (dot-notation for nested/array fields).
- Fix each field and resubmit — do **not** retry the identical body.

## Agent guidance

- Read the body before retrying — most 4xx errors are actionable and a blind retry will fail again.
- Treat `401`/`403` as configuration problems (token/scope), not transient failures.
- Only retry `429` and `5xx`, with exponential backoff, and respect `Retry-After`.
