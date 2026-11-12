# Linking to a page in the SKU.io web app

When you report a record or point the user at a screen, link the page in the SKU.io web app so
they can click straight to it. **Build every link from this table. Never guess a path from the
API route or the record's name.** The web app's paths do not follow the API's, and a guessed path
opens the app's "page not found" screen. On 2026-11-11 an agent linked an inventory adjustment as
`/v2/inventory/adjustments/653`. The real page is `/v2/inventory/inventory-adjustments/653`.

Every link is `https://{tenant}.sku.io` + a path below. Substitute `{tenant}` (everything before
`.sku.io` in the URL the user signs in at, e.g. `acme` or `beta.acme`) and the record's numeric
`id` from the API response, then give the user the finished URL.

Every path here was opened on a live tenant on 2026-11-11, and each one is checked against the
web app's page files. `npm run validate` fails if a skill writes a `https://{tenant}.sku.io/v2/…`
link whose path is not in this table.

## Records

| Record | Page |
| --- | --- |
| Product | `/v2/products/{id}` |
| Sales order | `/v2/orders/sales-orders/{id}` |
| Purchase order | `/v2/orders/purchase-orders/{id}` |
| Purchase invoice (bill) | `/v2/orders/purchase-invoices/{id}` |
| Vendor credit | `/v2/purchases/vendor-credits/{id}` |
| Inventory adjustment | `/v2/inventory/inventory-adjustments/{id}` |
| Stock take | `/v2/inventory/stock-takes/{id}` |
| Bill of materials (BOM) | `/v2/manufacturing/boms/{id}` |
| Automation workflow | `/v2/workflows/{id}` |
| Amazon FBA recovery case | `/v2/integrations/amazon/fba/recovery/{id}` |

## Lists and screens

| Screen | Page |
| --- | --- |
| Dashboard | `/v2/dashboard` |
| Products | `/v2/products` |
| Bundle & Kit Workshop | `/v2/products/bundle-workshop` |
| Listings | `/v2/listings` |
| Sales orders | `/v2/orders/sales-orders` |
| Purchase orders | `/v2/orders/purchase-orders` |
| Purchase invoices | `/v2/orders/purchase-invoices` |
| Vendor credits | `/v2/purchases/vendor-credits` |
| Inventory adjustments | `/v2/inventory/inventory-adjustments` |
| Stock takes | `/v2/inventory/stock-takes` |
| Bills of materials | `/v2/manufacturing/boms` |
| Automation workflows | `/v2/workflows` |
| Amazon FBA recovery | `/v2/integrations/amazon/fba/recovery` |
| TikTok Shop integration | `/v2/integrations/tiktok-shop` |
| Ledger | `/v2/ledger` |
| Ledger settings: Nominal Code Mappings | `/v2/ledger?tab=settings&subtab=nominal-code-mappings` |
| Ledger settings: Product accounts | `/v2/ledger?tab=settings&subtab=product-accounts` |
| Launch Roadmap | `/v2/getting-started?tab=roadmap` |
| Warehouses (settings) | `/v2/settings/warehouses` |
| Personal Access Tokens | `/v2/settings/developer/personal-access-tokens` |

A list page with a saved view is that list's path plus `?view={hash}`, where `{hash}` is the
saved view's `hash` (see the `create-saved-view` skill), e.g. `/v2/products?view={hash}`.

## Paths that do not exist

These look right and open the "page not found" screen. Do not use them.

| Wrong | Right |
| --- | --- |
| `/v2/inventory/adjustments/{id}` | `/v2/inventory/inventory-adjustments/{id}` |
| `/v2/automation/workflows/{id}` | `/v2/workflows/{id}` |

## The page you need is not here

Do not guess one. Link the closest list page from the table and name the record (its number or
SKU) so the user can find it there. If you are improving this library, open the page on a tenant,
confirm it renders (not "page not found"), and add the row here in the same pull request.
