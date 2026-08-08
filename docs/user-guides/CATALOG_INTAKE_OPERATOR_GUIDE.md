# Catalog Intake — Operator Guide

> **Audience:** Mirchi Labs operators using the internal Data Kitchen environment.
> **Environment:** https://datakitchen.mirchilabs.com — internal development. **Not customer production.**
> **Covers:** Phase 1 (Catalog Intake) + Phase 1.0.1 improvements.

---

## 1. Signing in

1. Open **https://datakitchen.mirchilabs.com**.
2. Select **Sign in with Microsoft**.
3. Authenticate with your **Mirchi Labs** account.

**First sign-in shows a consent prompt.** This is expected — the app registration has not been admin-consented, so each person consents once for themselves. Approving grants only the ability to call the Data Kitchen API as you.

Only Mirchi Labs organizational accounts work. Personal Microsoft accounts are rejected by design.

**Sign out** is in the top-right of the session bar.

---

## 2. Selecting an organization

If you belong to one organization it is selected automatically.

If you belong to several, you are asked to choose before the workspace opens. Everything you then see — catalogs, products, imports, history — is scoped to that organization.

To change: **Switch** in the top-right session bar. This reloads the workspace and clears the previous organization's data.

Your choice is remembered for the browser session only. It is a convenience, not a permission: the server re-checks your membership on every request, so selecting an organization you do not belong to fails with `403`.

---

## 3. Selecting a catalog

The **Catalog** selector sits in the workspace header, next to the organization.

| Situation | What happens |
|---|---|
| Organization has one catalog | Selected automatically |
| Several catalogs, you chose before | Your previous choice is restored |
| Several catalogs, no previous choice | **You must choose.** Nothing is selected for you |
| No catalogs | Imports are blocked, with an explanation |

Catalogs carry a type badge — **Production**, **Test**, **Sandbox**, or **Other**. Production is highlighted so you notice when you are working against one.

> **Why you must choose.** Before Phase 1.0.1 the app silently used whichever catalog happened to be first, and imports landed in the wrong catalog. Products are identified **per catalog**, so the same SKU in two catalogs is two independent products — an import into the wrong one is not corrected by re-importing into the right one.

Your catalog choice is remembered per organization for the browser session.

---

## 4. Importing a CSV

1. Confirm the **Organization** and **Catalog** in the header.
2. Select **Import Products**.
3. Check the banner reads **Importing into &lt;your catalog&gt;**.
4. Drop or choose your `.csv` file (max 50 MB, 10,000 rows).
5. Review the preview — row count, columns, sample rows, warnings.
6. Map fields (see §6), or **Continue** if a saved mapping already applies.
7. Review the import summary.

## 5. Importing a JSON file

Identical, with a `.json` file containing an **array of flat objects**:

```json
[
  { "product_sku": "ABC-123", "barcode": "00012345678905", "title": "Example Product" }
]
```

Object keys are treated as columns, so mapping works exactly as for CSV. Nested objects are not flattened — flatten before import.

---

## 6. Mapping fields

Mapping tells Data Kitchen which of your columns corresponds to which canonical field (`sku`, `gtin`, `product_name`, `brand`, `category`, `short_description`, `long_description`, `manufacturer`).

Common column names are auto-detected — `item_sku`, `product_sku`, `upc`, `barcode`, `title`, `vendor`, `maker` and similar.

**Unmapped columns are not lost.** They are preserved on the product under `attributes`, and the original row is always kept verbatim as a source record.

**One column can be mapped to several canonical fields.** That is allowed but rarely intended — mapping `title` to both `product_name` and `short_description` duplicates the name into the description.

---

## 7. Saved mappings

Once you complete an import, Data Kitchen remembers the mapping you confirmed.

On a later upload it compares your file's **header set** against saved templates for your organization:

| Result | What you see |
|---|---|
| **Exact match** | ✓ *Existing mapping applied.* Continue goes straight to import. **Review Mapping** opens it if you want to check |
| **Partial match** | Known columns pre-filled; only **new** or **missing** columns are called out |
| **No match** | Normal auto-detection |

Matching ignores **column order and capitalisation** — the same export from the same system matches even if columns move or casing changes. Adding or removing a column makes it a partial match, not a failure.

Re-confirming an identical mapping updates the existing template rather than creating a new version. A changed mapping is saved as a new version, and the newest is preferred.

Templates never cross organizations.

---

## 8. Validation warnings

Data Kitchen checks product identifiers on import:

- GTIN missing
- GTIN not numeric
- GTIN of an unsupported length (8, 12, 13, 14 are valid)
- GTIN failing its GS1 check digit
- A `upc`-named column that is not exactly 12 digits

**These never block an import.** The row still imports, the product is still created — but it is marked **Needs Review** and the warning appears in the import summary.

Warnings do not modify your data. The original value is preserved in the source record exactly as uploaded.

> **Not yet checked:** required-field completeness, retailer-specific rules, category taxonomies, image requirements. Those belong to the Validation Engine in a later phase.

---

## 9. Duplicate SKUs in one file

If the same SKU appears more than once in a single file, the preview warns before you commit:

```
Duplicate SKU detected
SKU SG-HDPH-WHT appears 2 times.
Rows: 2, 5
Resolution: row 5 will overwrite row 2.
```

**Last occurrence wins.** This is unchanged from earlier behaviour — the difference is that you are now told. If that is not what you want, fix the file and re-upload.

Duplicates are detected across the **whole file**, not just the previewed rows.

---

## 9b. Imports run in the background

Once you confirm an import, Data Kitchen accepts it and processes it in the background. The screen shows live progress — rows processed, elapsed time — and says **"You can leave this page."**

That is literal. You may navigate away, close the browser, or sign out. Processing continues, and even an application restart does not lose the run: it resumes from the last committed checkpoint.

Return to **Import History** at any time to see the outcome.

**Statuses you will see:**

| Status | Meaning |
|---|---|
| Queued | Accepted and durably stored, waiting for a worker |
| Processing | Rows are being committed; progress is shown |
| Completed | Finished cleanly |
| Completed with warnings | Finished; some rows raised validation warnings |
| Failed | Could not complete. The reason is recorded |
| Cancelled | Stopped on request |

**Cancelling.** A **queued** import cancels immediately and imports nothing. A **processing** import stops at the next checkpoint — **rows already committed stay in the catalog and are not rolled back**. The screen tells you how many rows were committed before the stop.

**Row limit.** A file exceeding the configured row limit is now **refused outright** and nothing is imported. Previously the extra rows were silently discarded and the import reported success. Split the file, or ask an administrator to raise `MAX_IMPORT_ROWS`.

---

## 10. Import summary

After every import:

| Field | Meaning |
|---|---|
| Products Created | New products in this catalog |
| Products Updated | Existing products matched by SKU or GTIN **within this catalog** |
| Warnings | Validation and parse warnings |
| Errors | Rows that failed |
| Skipped | Parsed but not turned into a product |
| Duration | Processing time |
| Catalog / Organization | Where the data landed |
| Source file / Import ID | For tracing back |

**Open Catalog** returns to the product list; **Import Another File** starts again in the same catalog.

---

## 11. Provenance, history, and original source

Open any product from the catalog table.

- **Canonical Record** — the current values Data Kitchen holds.
- **Field Provenance** — for each field: the current value, which source column it came from, which import, the normalization method applied, and when. This answers *"where did this value come from?"*
- **History** — a chronological record of what changed, with previous and new values. Only fields that actually changed appear.
- **Original Source** — the uploaded row exactly as received, plus filename, import date, row number, and source system.

Nothing here is ever overwritten or recomputed. The uploaded file itself is also retained in Blob Storage.

---

## 12. Import history

**Import History** in the workspace header lists every import **for the selected catalog** — filename, date, row counts, and status. Switching catalogs changes the list.

---

## 13. Troubleshooting

**"Select a catalog to continue"**
Your organization has several catalogs and none is chosen. Pick one in the header. This is intentional — the app will not guess.

**"No catalogs available"**
The organization has no catalogs. One must be created before importing.

**Import Products is not shown**
Either no catalog is selected, or the app is in demo mode (API unreachable). Check the badge next to "Step 1 of 6" — it reads `live` or `demo`.

**Products imported into the wrong catalog**
Re-importing into the correct catalog creates them there, but does **not** remove them from the wrong one — products are per-catalog. The stray products must be removed deliberately.

**Products show "Needs Review" after a clean import**
Usually an identifier warning. Open the product and check Field Provenance for the GTIN.

**Expected an update, got a new product**
Matching is by SKU or GTIN **within a single catalog**. The same SKU in a different catalog is a different product — by design.

**Sign-in fails with AADSTS50020**
The account is not a Mirchi Labs organizational account, or is being resolved as a personal Microsoft account. Contact the environment owner.

**403 after signing in successfully**
Your Entra identity authenticated but has no matching active Data Kitchen user or membership. Contact the environment owner.

**Demo mode when you expect live data**
The frontend could not reach the API. Confirm the backend is healthy at `/api/v1/health`.

---

## 14. Limits and known gaps

| Item | Current state |
|---|---|
| File size | 50 MB |
| Rows per import | 10,000 |
| Formats | CSV, JSON. **PDF is Phase 1.1** |
| Import mode | Synchronous — keep the tab open |
| Deleting products | Not available in the UI |
| Editing products | Not available in the UI — imports only |
| Retailer Readiness, Mapping Studio, Validation & Exceptions, Delivery, Retail Feedback | Navigation exists, marked *Not available yet*. Phase 2/3 |
| Blank values clearing a field | Not supported — an omitted or blank value leaves the existing value unchanged |
