# ADR-001: Deferred Product Identity Table

## Status
Accepted — 2026-08-02

## Context
Canonical products can be referenced by multiple source systems. SKUs can change,
GTINs may be missing, and future AI reconciliation may merge products that were
initially created as separate rows.

## Decision
`canonical_product.id` (UUID) serves as the stable product identity through
Steps 1–5 of the Data Kitchen roadmap. A separate `product_identity` table is
**not** introduced at this time.

## Rationale
- The one-to-many relationship between canonical product and source records
  already models multi-source references.
- SKU and GTIN changes are recorded in `canonical_product_history` with full
  provenance, preserving auditability.
- Introducing a separate identity layer now would add indirection to every API,
  query, and UI component with zero behavioral benefit until AI reconciliation
  exists.

## Migration Path (Step 6+)
If AI reconciliation requires cross-product identity grouping:

1. Create `product_identity` table with its own UUID.
2. Backfill one identity row per existing canonical product.
3. Add `product_identity_id` FK to `canonical_product`.
4. Populate the FK for all existing rows.
5. Update APIs to expose `identityId` alongside `productId`.

No existing data is lost. No APIs break — they continue returning canonical
product data with an additional `identityId` field.
