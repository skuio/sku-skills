# SKU.io API — the shape of it

SKU.io is an operations platform for e-commerce and wholesale businesses: products, inventory,
sales orders, purchasing, fulfilment, returns, manufacturing, and accounting — plus integrations
with sales channels (Shopify, Amazon, eBay, BigCommerce, …), 3PLs, and shipping providers.

The public REST API exposes this surface as **thousands of endpoints**. These skills are curated
shortcuts: for a given business task, they tell an agent *exactly* which endpoints to call, in
what order, with which fields — so it doesn't have to rediscover the API each time.

- **Full reference:** <https://developer.sku.io>
- **Base URL:** `https://{tenant}.sku.io`, all paths under `/api`
- **Auth:** Personal Access Token as a Bearer token — see [`authentication.md`](./authentication.md)
- **Format:** JSON request and response bodies; `Accept: application/json`

## Domains at a glance

| Domain | Typical resources | Scope resource |
| --- | --- | --- |
| Products | products, variants, listings, brands, attributes, barcodes | `products` |
| Orders | sales orders, lines, fulfilments, quotes, artwork | `orders` |
| Inventory | on-hand, movements, adjustments, allocations, holds | `inventory` |
| Purchasing | purchase orders, receiving, supplier products | `purchase-orders` |
| Suppliers / Customers | supplier & customer records | `suppliers` / `customers` |
| Warehouses | warehouses, bins, locations | `warehouses` |
| Returns | RMAs, return lines | `returns` |
| Manufacturing | builds, BOMs, components | `manufacturing` |
| Accounting | ledger, invoices, journals, taxes | `accounting` |
| Integrations | channel & provider connections | `integrations` |
| Reports | analytics & exports | `reports` |

## Versioning

Some resources are exposed under `/api/...` (v1) and newer ones under `/api/v2/...`. Each skill's
`skill.yaml` names the exact path to call, so you don't have to guess. When both exist, prefer the
path the skill specifies.

## Conventions

- **IDs** are integers unless noted.
- **Dates/times** — datetimes are UTC (ISO-8601); date-only values are in the account's timezone.
- **Pagination** — list endpoints are paginated; see [`pagination.md`](./pagination.md).
- **Errors** — standard HTTP status codes with a JSON body; see [`errors.md`](./errors.md).
