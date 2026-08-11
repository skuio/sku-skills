# Example diff presented before applying (Step 3/4)

**Source:** "2026 TI Price File" from VE Petersen — effective 8/1/26.
**Scope:** supplier pricing tier "Wholesale" (cost side only; sell prices untouched).

## Updates — 24 products

| Product | Old | New | Δ |
| --- | ---: | ---: | ---: |
| F90000267 | 79.37 | 81.82 | +3.1% |
| TIA485-2 | 117.74 | 149.27 | **+26.8%** |
| 400-1168 | 23.07 | 31.07 | **+34.7%** |
| F90000274 | 90.25 | 86.96 | −3.6% |
| … | | | |

Big movers (>±10%): TIA485-2 +26.8%, 400-1168 +34.7%.

## Flagged — needs a human call

- **Successor candidates (5):** file lists `GSS342G3` / `GSS341G3` / `GSS340G3` / `GSS278G3` /
  `GSS250G3` at $47.10; catalog products are the pre-G3 part numbers. Adopt successors?
- **Discontinued rows (1 affecting us):** `400-0085` has no prices — file says "USE 400-1168".
  Catalog product 400-0085 left untouched.
- **Supplier-linked, absent from file (3):** WT-215-1, FPC-1-1, BKS1000 — not in this file
  (may be non-TI lines from the same distributor). Left untouched.

## Not stocked — 1,340 file rows matched no product (expected; full distributor file)

Proceed with the 24 updates? [y/N]
