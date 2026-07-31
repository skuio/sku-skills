# Pagination, filtering & sorting

List endpoints return a standard Laravel-style paginated envelope.

## Response shape

```json
{
  "data": [ { "id": 1, "...": "..." } ],
  "current_page": 1,
  "last_page": 12,
  "per_page": 10,
  "total": 118,
  "from": 1,
  "to": 10,
  "next_page_url": "https://acme.sku.io/api/products?page=2",
  "prev_page_url": null,
  "path": "https://acme.sku.io/api/products"
}
```

- Items are directly in `data` (a flat array — **not** `data.data`).
- Walk pages with `page`, or follow `next_page_url` until it is `null`.

## Query parameters

| Param | Meaning | Example |
| --- | --- | --- |
| `page` | 1-based page number | `?page=3` |
| `per_page` | Items per page (default `10`) | `?per_page=50` |
| `search` | Free-text search where supported | `?search=widget` |
| `filter[field]` | Filter by a field (Spatie QueryBuilder) | `?filter[status]=open` |
| `sort` | Sort field; prefix `-` for descending | `?sort=-created_at` |

Filter/sort support varies per endpoint — a skill's `INSTRUCTIONS.md` calls out the filters that
matter for that task. When paginating a large export, raise `per_page` rather than making many
tiny requests, and stop as soon as you have what you need.
