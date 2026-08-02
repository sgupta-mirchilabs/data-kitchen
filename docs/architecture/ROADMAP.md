# Data Kitchen Roadmap

> **Last updated:** 2026-08-02
> **Authors:** Mirchi Labs
> **Companion documents:** [ARCHITECTURE_DECISIONS.md](./ARCHITECTURE_DECISIONS.md), [SYSTEM_OVERVIEW.md](./SYSTEM_OVERVIEW.md), [DATA_MODEL.md](./DATA_MODEL.md)

---

## Vision

Data Kitchen is Mirchi Labs' Retail Intelligence Platform.

It exists to solve one problem: the gap between how brands manage product data internally and how retailers need to receive it. That gap costs brands millions in rejected listings, delayed launches, and manual rework. Data Kitchen closes it.

Data Kitchen is **not** a PIM, MDM, DAM, or ERP. It does not replace the systems where product data is authored. It consumes their output — messy, inconsistent, incomplete — and transforms it into retailer-ready product data that passes validation, matches retailer schemas, and ships on time.

The platform powers three business models:

- **Syndication as a Service** — Automated, continuous delivery of product data to retail partners, maintained against evolving retailer schemas.
- **Forward Deployment Teams** — Embedded retail data specialists using Data Kitchen as their operational platform for client product launches and ongoing maintenance.
- **Managed Product Data Operations** — End-to-end outsourced retail data management, from ingestion through delivery and feedback resolution.

### Guiding Philosophy

The platform follows a deliberate progression:

```
Trusted Data → Retail Intelligence → Retail Execution
```

**Trusted Data** means every product value can be traced to its source, every transformation is visible, and every change is recorded. This is the foundation — nothing downstream works without it.

**Retail Intelligence** means the platform knows what each retailer requires: which fields, which formats, which taxonomies, which validation rules. This knowledge is structured, queryable, and maintained as a first-class data asset — not buried in spreadsheets or tribal knowledge.

**Retail Execution** means the platform doesn't just identify problems — it solves them. It maps canonical data to retailer schemas, validates it against retailer rules, packages it for delivery, and ingests retailer feedback to close the loop. The six-step pipeline is the embodiment of this progression.

AI enters the picture only after the operational foundation is proven. The data pipeline, provenance model, and feedback loop provide the training data and evaluation framework that AI needs to be useful rather than dangerous. AI augments human operations — it does not replace the deterministic workflows that guarantee data integrity.

---

## Product Evolution

### Phase 0: UI Prototype

**Status:** Complete

The static prototype demonstrated the six-step pipeline concept: Catalog Intake, Retailer Readiness, Mapping Studio, Validation & Exceptions, Delivery, and Retail Feedback. All screens used seed data. No backend, no persistence, no real data processing.

The prototype validated the product concept and pipeline architecture with stakeholders. It established the design system (dark theme, coral branding), the navigation model (sidebar with pipeline steps), and the information density level appropriate for data operations.

**Why this came first:** A retail intelligence platform is a complex concept. The prototype made it tangible — stakeholders could click through the pipeline and understand what "retailer readiness scoring" or "mapping studio" would actually look like before any backend investment.

---

### Phase 1: Real Catalog Intake

**Status:** Complete

Phase 1 replaced the prototype's first screen with a production-grade data pipeline. This is the foundation that every subsequent phase builds on.

**What was delivered:**

- **Catalog Workspace** — Product table with search, filtering by data quality status, and a product detail panel with four tabs: Canonical, Source Records, Provenance, and History.
- **CSV and JSON Import** — Upload, preview, field mapping (with auto-suggestions via alias matching), and import confirmation. Synchronous processing with per-row error isolation.
- **Canonical Product Model** — 8 typed core fields (SKU, GTIN, brand, product name, short/long description, category, manufacturer) plus 6 JSONB flexible fields (attributes, dimensions, packaging, compliance, digital assets, identifiers). Hybrid typed + flexible structure designed for the realities of retail product data.
- **PostgreSQL Persistence** — 6 tables with relational integrity, partial unique indexes (SKU uniqueness within a catalog), and JSONB support for semi-structured data.
- **Azure Blob Storage** — Uploaded files stored durably via a `StorageProvider` interface, with local filesystem for development and testing.
- **Import History** — File-level audit trail (import batch with filename, checksums, field mappings, row counts) and row-level audit trail (source records with immutable raw payloads).
- **Source Record Preservation** — Every row from every import is preserved verbatim, linked to the canonical product it produced or updated.
- **Field Provenance** — Per-field tracking of source field name, original value, normalized value, and normalization method.
- **Product Change History** — Field-level change log with dot-notation paths, previous/new values, source record linkage, and actor tracking.
- **Duplicate Detection** — SKU-first, GTIN-second matching within a catalog, with non-destructive updates (null incoming values never overwrite existing data).
- **Live / Demo Mode** — Automatic mode resolution based on backend availability, with repository pattern isolating data access from UI components.
- **REST API** — 21 endpoints covering catalogs, imports, products, source records, provenance, history, user identity, organization management, and audit log, with consistent response envelopes and structured error codes.
- **Multi-Tenant Foundation** — Organization, User, and OrganizationMembership models. Application-level tenant isolation with org-scoped queries on all routes. `TenantScopedStorage` with prefix enforcement for blob storage.
- **Authentication & Authorization** — Provider-neutral `AuthProvider` interface with `DevAuthProvider` (development) validating against `DEV_AUTH_TOKEN`. Role-based access control with 3 roles and 5 permissions. Active org selection via `X-Organization-Id` for multi-org users.
- **Operational Audit** — Append-only `AuditLog` for auth failures, catalog/import operations, org settings changes, and authorization denials. Request correlation via `X-Request-Id`. Catalog classification (`catalog_type`: test/production/sandbox/other).
- **Configuration Safety** — Fail-fast startup validation for production config. Seed script refuses `NODE_ENV=production` and requires `ALLOW_DEV_SEED=true`.
- **CI/CD** — Independent deployment pipelines for frontend (Azure Static Web Apps) and backend (Azure App Service), with path-scoped triggers. 90 unit tests + 23 integration tests.

**Why this was built first:** Every phase in the roadmap depends on trusted, well-structured product data with a clear audit trail. Readiness scoring evaluates canonical products. Mapping transforms canonical fields. Validation checks canonical values. Delivery packages canonical data. Feedback routes back to canonical products. Without a production-grade canonical product model, source preservation, provenance, and change history, the downstream phases would be built on sand.

The data foundation also provides the training data and evaluation framework that Phase 7 (AI) will need. Source records are labeled examples for field-mapping models. Provenance records are evaluation data for normalization quality. Change history is the feedback signal for auto-heal accuracy. Building Phase 1 first means Phase 7 will have months or years of operational data to learn from.

---

### Phase 2: Retail Intelligence Library

**Status:** Planned

**Purpose:** Build the structured knowledge base that encodes what each retailer requires. This is the knowledge layer that makes Data Kitchen a *retail intelligence* platform rather than a generic data transformation tool.

Today, retail data requirements exist as PDFs, spreadsheets, Slack messages, and tribal knowledge inside every team that works with retailers. Phase 2 captures this knowledge as structured, queryable, version-controlled data.

**Business value:**
- Brands can see exactly what Walmart requires versus what Target requires, field by field, before investing in data cleanup.
- Forward Deployment Teams have a single source of truth for retailer requirements instead of scattered documents.
- New retailer onboarding becomes a data modeling exercise, not a discovery project.
- Readiness scoring (Phase 2 output) gives brands a quantified gap analysis: "You are 78% ready for Walmart — here are the 14 fields that need attention."

**Expected capabilities:**
- **Retailer profiles** — Structured definitions of each retail partner with metadata (API formats, submission windows, contact information, content guidelines).
- **Attribute libraries** — Per-retailer required fields, optional fields, field formats, character limits, and allowed values. Organized by product category where retailer requirements vary by category.
- **Validation rule definitions** — Structured rules (required, format, length, enum, regex, conditional) with severity levels (error, warning, info) that encode retailer schema constraints.
- **Taxonomy mappings** — Retailer-specific category trees and the mappings from canonical categories to retailer taxonomies.
- **Mapping templates** — Pre-built canonical-to-retailer field mappings for common retailer schemas, reducing setup time for new catalogs.
- **Reference data** — Shared value lists (units of measure, country codes, certification labels) used across retailers.
- **Readiness scoring engine** — Evaluates canonical products against a retailer's attribute library and validation rules, producing a per-product, per-field readiness score with specific blockers.

**How it builds on Phase 1:** Readiness scoring queries canonical products (Phase 1) against retailer schemas (Phase 2). The canonical product model's hybrid structure — typed core fields for universal attributes, JSONB for category-specific attributes — was designed to support this evaluation. The `data_quality_status` field on canonical products will be extended to reflect retailer-specific readiness, not just generic data completeness.

---

### Phase 3: Mapping Engine

**Status:** Planned

**Purpose:** Transform canonical product data into retailer-specific formats. Phase 1 maps *source → canonical*. Phase 3 maps *canonical → retailer*.

**The problem it solves:** Every retailer wants the same product described differently. Walmart calls it "Product Short Description" with a 200-character limit. Amazon calls it "Title" with a 500-character limit and requires the brand name at the beginning. Target calls it "Product Name" and requires specific formatting for certain categories. Today, this translation is done manually in spreadsheets — error-prone, slow, and impossible to maintain across hundreds of products and dozens of retailers.

**Expected capabilities:**
- **Persistent mapping rules** — Reusable, versioned mapping configurations per retailer (as opposed to Phase 1's per-import, ephemeral field mappings).
- **Transform types** — Direct copy, string templates, value lookups, computed fields, conditional logic, and concatenation. Each transform type produces a predictable, auditable output.
- **Mapping inheritance** — Start with a mapping template from the Retail Intelligence Library (Phase 2), then customize per catalog or per product category.
- **Mapping preview** — See the retailer-specific output for any product before committing, with side-by-side comparison against the canonical representation.
- **Coverage reporting** — Per-retailer visualization of which canonical fields are mapped, which retailer fields are unmapped, and which mappings are incomplete or low-confidence.
- **Mapping versioning** — Track changes to mapping rules over time, with the ability to compare outputs across mapping versions.

**How it builds on Phase 2:** Mapping rules reference the Retail Intelligence Library to know *what* the retailer expects (field names, formats, allowed values). The mapping engine applies transforms to produce data that matches those expectations. Without the intelligence library, mapping rules would be defined against an undocumented target — the same spreadsheet-and-tribal-knowledge problem the platform is designed to eliminate.

---

### Phase 4: Validation Engine

**Status:** Planned

**Purpose:** Validate that mapped product data actually meets retailer requirements before delivery. Mapping produces the right shape; validation confirms the right values.

**The problem it solves:** Even when fields are correctly mapped, the values may be wrong — a description that exceeds the character limit, a category that doesn't exist in the retailer's taxonomy, a required certification that's missing, an image URL that returns a 404. Today, these issues are discovered when the retailer rejects the submission — days or weeks after the data was sent.

**Expected capabilities:**
- **Data quality validation** — Completeness checks (required fields present), format checks (GTIN is 14 digits, URLs are valid), and consistency checks (brand on product matches brand in catalog).
- **Retail compliance validation** — Retailer-specific rule evaluation using the Phase 2 intelligence library. Every validation result links to the specific rule that failed and the retailer that requires it.
- **Business rule validation** — Cross-field rules (e.g., "if category is Food, allergen declaration is required"), cross-product rules (e.g., "all products in a bundle must have the same brand"), and custom rules per catalog or organization.
- **Readiness scoring** — Per-product, per-retailer readiness scores that aggregate individual validation results into an actionable summary. A product is "ready" for a retailer when all error-level validations pass.
- **Exception routing** — Products that fail validation are surfaced as exceptions with specific remediation guidance. Exceptions can be assigned, tracked, and resolved — transforming validation from a report into a workflow.
- **Auto-heal suggestions** — For common, deterministic issues (trim whitespace, pad GTIN, capitalize brand name), the engine suggests corrections. Human approval is required before any auto-heal is applied. This is the first place where machine-generated corrections enter the pipeline, laying groundwork for Phase 7's AI capabilities.

**How it builds on Phase 3:** Validation operates on mapped output, not canonical data. The mapping engine (Phase 3) produces retailer-specific data; the validation engine (Phase 4) checks that data against retailer rules (Phase 2). This separation means mapping rules and validation rules can evolve independently — a new retailer rule doesn't require a mapping change, and a mapping improvement doesn't require validation reconfiguration.

---

### Phase 5: Delivery Engine

**Status:** Planned

**Purpose:** Package validated product data into retailer-specific formats and deliver it through the appropriate channel. This is where Data Kitchen's output leaves the platform and enters the retailer's system.

**The problem it solves:** Even with validated, correctly mapped data, the delivery step is manual: export to CSV, format the CSV to match the retailer's template, upload to the retailer's portal (or send via email, API, SFTP, or EDI). Each retailer has different delivery mechanisms, different file formats, and different submission windows. This final mile of manual work is where errors creep in and deadlines slip.

**Expected capabilities:**
- **Retail exports** — Generate retailer-specific files (CSV, JSON, XML, Excel) using mapping rules and retailer format templates. The generated payload is a precise match for the retailer's import specification.
- **API delivery** — Direct integration with retailer APIs (Walmart Content API, Amazon SP-API, Target Content Gateway) for automated submission.
- **Scheduling** — Recurring delivery schedules per retailer, with configurable cadence, delivery windows, and retry policies.
- **Publishing workflow** — A review-and-approve step before delivery. The data operations team sees exactly what will be sent, can preview the payload, and explicitly approves the submission.
- **Delivery history** — A complete audit trail of what was sent, to whom, when, in what format, and what the delivery outcome was. This mirrors the import history from Phase 1 — inbound audit trail (Phase 1) and outbound audit trail (Phase 5).
- **Delivery status tracking** — Monitor whether the retailer accepted, partially accepted, or rejected the submission. Status updates feed into the feedback engine (Phase 6).

**How it builds on Phase 4:** Only products that pass validation (Phase 4) are eligible for delivery. The delivery engine reads validated, mapped output and packages it for the target retailer. The readiness score is the gate: products below the threshold are not delivered, preventing submissions that would be rejected.

---

### Phase 6: Feedback Engine

**Status:** Planned

**Purpose:** Ingest retailer responses, parse rejections, link them to specific products and fields, and route them back into the pipeline for resolution. This closes the loop from source data to retailer feedback.

**The problem it solves:** When a retailer rejects a product submission, the rejection arrives as an email, a portal notification, or an API response — often with cryptic error codes, inconsistent formatting, and no direct link to the data that caused the problem. Today, a human reads the rejection, figures out which products are affected, identifies the specific field issue, and manually corrects it. This investigation and correction cycle is the most expensive per-item cost in retail data operations.

**Expected capabilities:**
- **Feedback ingestion** — Parse retailer rejection responses from multiple formats (API responses, CSV error reports, email notifications, portal exports).
- **Error linking** — Automatically link retailer error codes to specific canonical products and specific fields, using the provenance model (Phase 1) to trace the error back to its source.
- **Correction workflow** — Surface linked errors as actionable items with specific remediation guidance. Corrections flow back through mapping (Phase 3) and validation (Phase 4) before re-delivery.
- **Continuous synchronization** — Detect when a retailer's live listing diverges from the canonical product data and flag the discrepancy for investigation.
- **Operational dashboards** — Aggregate feedback data across retailers, products, and time periods. Surface patterns: "Walmart rejects 12% of submissions for title length" or "Brand X has a 40% rejection rate on Amazon, up from 15% last quarter."
- **Root cause analysis** — Trace rejections backward through the pipeline: rejected field → mapping rule that produced it → canonical value → source record → source system. This end-to-end traceability is only possible because every step in the pipeline preserves its audit trail.

**How it builds on Phase 5:** The feedback engine ingests delivery outcomes (Phase 5) and retailer responses. Corrections re-enter the pipeline at the mapping or validation step, creating a continuous improvement cycle. The closed-loop architecture means every rejection makes the system smarter — not through AI, but through structured feedback data that informs better mapping rules, better validation rules, and better source data requirements.

---

### Phase 7: AI Platform

**Status:** Future

**Purpose:** Introduce machine learning capabilities that augment human operations across the entire pipeline. AI is intentionally introduced last, after the operational foundation is proven and the data assets are mature.

**Why AI is Phase 7, not Phase 1:** AI capabilities need three things to be useful: training data, evaluation frameworks, and human-in-the-loop workflows. Phase 1 through Phase 6 provide all three:

- **Training data:** Source records (raw input), field mappings (labeled transformations), provenance records (input → output pairs), and feedback records (retailer ground truth for what's correct).
- **Evaluation framework:** Validation rules (Phase 4) provide a structured definition of "correct." Delivery outcomes and retailer feedback (Phases 5–6) provide real-world accuracy metrics. Provenance and history provide the ground truth for before/after comparison.
- **Human-in-the-loop workflows:** The approval steps built into mapping, validation, and delivery (Phases 3–5) provide the infrastructure for AI suggestions that require human confirmation.

Introducing AI before these foundations exist would mean building models without training data, deploying suggestions without evaluation metrics, and presenting corrections without approval workflows. The result would be AI that cannot be trusted — the opposite of the platform's core promise.

**Potential capabilities:**

- **Intelligent field mapping** — Suggest source-to-canonical and canonical-to-retailer mappings based on patterns learned from historical mapping decisions. Confidence scores let operators focus review on low-confidence suggestions.
- **Attribute suggestions** — Predict missing attribute values from product context (name, category, brand, existing attributes). Particularly valuable for JSONB flexible fields where retailer requirements vary by category.
- **Advanced duplicate detection** — Fuzzy matching on product names, image similarity, cross-catalog reconciliation. This is where the deferred Product Identity layer (ADR-011) becomes relevant — AI-driven reconciliation may identify that two canonical products in different catalogs represent the same physical product.
- **Data enrichment** — Augment canonical products with inferred attributes: extract dimensions from product descriptions, classify products into retailer taxonomies, normalize brand names against a reference database.
- **Root cause analysis** — Given a retailer rejection, identify not just the immediate data issue but the upstream cause: wrong mapping rule, bad source data, missing validation rule, or changed retailer requirement.
- **Retail issue resolution** — Suggest specific corrections for retailer rejections, drawing on patterns from successfully resolved feedback across all clients. Human approval is always required.
- **Operational copilots** — Conversational interfaces for data operations teams: "Show me all products that will fail Walmart validation," "Why was this product rejected by Target last week," "Apply the same fix we used for the Brand X title issue."

AI capabilities are additive layers, not replacement architectures. If every AI feature were removed, the platform would still function — it would require more manual effort, but no data integrity would be lost and no workflow would break.

---

## Architecture Maturity

The platform architecture evolves through distinct maturity stages, each building on the capabilities of the previous one.

### Phase 1 — Working Product Foundation

A production-grade data pipeline with full audit trail. Synchronous processing, monolithic backend, single database. The architecture is simple by design — complexity is deferred until it is earned by real operational demands. The service layer is cleanly modularized (parsers, normalizer, duplicate resolver, history, storage), making future decomposition straightforward.

### Phase 2 — Knowledge Layer

The Retail Intelligence Library introduces the platform's first structured domain knowledge. The system transitions from "a tool that processes product data" to "a tool that knows about retail." This is a fundamental shift — the platform now has opinions about what correct data looks like, defined by retailer requirements rather than generic data quality heuristics.

### Phase 3 — Transformation Engine

The mapping engine introduces persistent, versioned transformation rules. The platform transitions from one-time data import to ongoing data management. Mapping rules are the first long-lived configuration that accumulates institutional knowledge — a mapping configuration for Walmart represents months of learning about Walmart's requirements, and it persists across imports.

### Phase 4 — Automated Quality Assurance

The validation engine automates the quality checks that were previously manual. The platform transitions from "we have the data" to "we know the data is correct." Readiness scoring provides a quantified, per-retailer assessment that replaces subjective judgment. Exception routing transforms validation from a report into a workflow.

### Phase 5 — Operational Scale

Delivery and feedback close the loop. The platform transitions from a data preparation tool to an operational system — it doesn't just prepare data, it delivers it and tracks the outcome. Scheduling, publishing workflows, and delivery history enable the platform to run as an always-on service rather than a batch tool.

### Phase 6–7 — Intelligence and Automation

Feedback analysis and AI capabilities transform operational data into institutional intelligence. The platform transitions from executing human decisions to augmenting them — suggesting mappings, predicting issues, and resolving feedback patterns that humans would miss. The human remains the authority; the AI becomes the accelerant.

---

## Business Capability Matrix

| Capability | Phase | Description |
|---|---|---|
| Catalog creation and management | 1 | Named containers for product groupings |
| CSV / JSON file import | 1 | Upload, preview, and import product files |
| Canonical product model | 1 | Unified product representation with typed + flexible fields |
| Source record preservation | 1 | Immutable storage of original source data |
| Field-level provenance | 1 | Per-field tracking of source, original value, and normalization |
| Product change history | 1 | Field-level change log with actor and causation tracking |
| Duplicate detection and merge | 1 | SKU/GTIN matching with non-destructive updates |
| Import audit trail | 1 | File-level and row-level import history |
| Live / demo mode | 1 | Automatic backend detection with graceful fallback |
| REST API | 1 | Programmatic access to all product data and metadata |
| Retailer profiles | 2 | Structured definitions of retail partner requirements |
| Attribute libraries | 2 | Per-retailer required/optional fields with formats and constraints |
| Validation rule definitions | 2 | Structured, queryable retailer schema rules |
| Taxonomy management | 2 | Category trees and cross-retailer taxonomy mappings |
| Readiness scoring | 2 | Per-product, per-retailer readiness assessment with specific blockers |
| Persistent mapping rules | 3 | Reusable, versioned canonical-to-retailer field transformations |
| Mapping templates | 3 | Pre-built mappings from the intelligence library |
| Transform types | 3 | Direct copy, templates, lookups, computed fields |
| Mapping preview | 3 | Side-by-side canonical vs. retailer-specific output |
| Data quality validation | 4 | Completeness, format, and consistency checks |
| Retail compliance validation | 4 | Retailer-specific rule evaluation with linked blockers |
| Readiness gating | 4 | Products below readiness threshold blocked from delivery |
| Exception routing | 4 | Validation failures surfaced as assignable work items |
| Auto-heal suggestions | 4 | Deterministic corrections with human approval |
| Retail export generation | 5 | Retailer-specific file generation (CSV, JSON, XML, Excel) |
| API delivery | 5 | Direct integration with retailer content APIs |
| Delivery scheduling | 5 | Recurring deliveries with configurable cadence |
| Publishing workflow | 5 | Review and approval before delivery |
| Delivery audit trail | 5 | Outbound history mirroring inbound import history |
| Feedback ingestion | 6 | Parse and link retailer rejection responses |
| Correction workflow | 6 | Route rejections back through mapping and validation |
| Operational dashboards | 6 | Aggregate feedback patterns across retailers and time |
| Continuous sync monitoring | 6 | Detect divergence between canonical data and live listings |
| Intelligent mapping suggestions | 7 | ML-powered field mapping based on historical patterns |
| Attribute prediction | 7 | Infer missing values from product context |
| Advanced duplicate detection | 7 | Fuzzy matching, image similarity, cross-catalog reconciliation |
| Data enrichment | 7 | Automated attribute extraction and classification |
| Operational copilots | 7 | Conversational interface for data operations teams |

---

## Design Principles

These principles should guide every future enhancement to Data Kitchen.

### 1. Retail-first architecture

Every feature is evaluated through the lens of retail product data operations. Data Kitchen is not a general-purpose data platform. When a design decision involves a tradeoff between generality and retail-specific value, choose retail.

### 2. Canonical before retailer-specific

All product data flows through a single canonical representation before being transformed for any retailer. The canonical model is the stable contract that the entire pipeline depends on. Retailer-specific transformations operate on canonical data, never on raw source data.

### 3. Preserve original data

Source records are immutable. Raw files are stored durably. Every transformation records both the original and transformed value. The system never silently discards or overwrites data. When something goes wrong downstream, the original data is always available for re-processing.

### 4. Explain every transformation

When a value is mapped, normalized, validated, or corrected, the system records what happened, why, and where the input came from. Provenance is not a debugging tool — it is a core product feature. Operators and their clients need to trust the data, and trust requires transparency.

### 5. Build reusable engines, not one-off features

Each pipeline step is an engine: the import engine, the mapping engine, the validation engine, the delivery engine. Engines are configured with rules and data, not hard-coded logic. A new retailer is a new configuration, not a new code path.

### 6. Operational, not administrative

Data Kitchen is a tool for people who work with product data every day — not an admin console they visit once a month. Every screen should answer the question "what do I need to do next?" The UI prioritizes actionable information over comprehensive reporting.

### 7. AI augments, never replaces

AI capabilities suggest, predict, and accelerate. They never execute without human approval. Deterministic workflows (mapping rules, validation checks, delivery formats) guarantee correctness. AI capabilities improve speed and coverage, but the correctness guarantee comes from the deterministic layer.

### 8. Simplicity over premature optimization

The system uses synchronous processing, a monolithic backend, and a single database. These choices are intentional. Complexity is added only when real operational demands require it, not when anticipated future demands suggest it. The architecture is designed to be decomposable, but it will not pay the complexity cost before it is earned.

---

## Explicit Non-Goals

Data Kitchen is explicitly NOT intended to become:

**General-purpose PIM.** Data Kitchen does not manage product content authoring, creative workflows, or digital asset production. It consumes PIM output and makes it retail-ready. Brands keep their existing PIM; Data Kitchen sits downstream.

**Enterprise MDM.** Data Kitchen does not attempt to create a single master record across an enterprise. Its scope is the retail channel. Product identity within Data Kitchen is scoped to catalogs and retail destinations, not enterprise-wide golden records.

**Digital Asset Manager.** Data Kitchen may track digital asset references (URLs, file metadata) as product attributes, but it does not store, process, render, or transform images, videos, or documents. DAM systems remain the source of truth for asset content.

**ERP.** Data Kitchen has no concept of inventory, pricing, orders, fulfillment, warehousing, or supply chain logistics. It operates purely on product *data*, not product *operations*.

**Workflow/BPM platform.** Exception routing and approval workflows are scoped to retail data operations — they are not a general-purpose workflow engine. Data Kitchen will not grow features for arbitrary business process modeling, task assignment hierarchies, or workflow design tools.

**Content Management System.** Data Kitchen does not manage marketing content, website pages, email templates, or content publishing outside of retail product data delivery.

---

## Future Ideas

The following ideas may be explored in future phases but are intentionally out of scope for the current roadmap. Each is tracked with a disposition that reflects the current thinking.

| Idea | Disposition | Notes |
|---|---|---|
| **Product Identity layer** | Deferred | Introduces cross-product, cross-catalog identity grouping for AI reconciliation. Migration path documented in ADR-011. Will be needed when AI duplicate detection (Phase 7) operates across catalogs. |
| **Event-driven processing** | Deferred | Domain events (ProductCreated, ProductUpdated, FieldChanged) enable reactive downstream processing. Not needed until multiple consumers react to product changes. The per-row transaction boundary in ImportService is the natural emission point. |
| **Async import processing** | Deferred | Extract ImportService to a background worker with job table and polling. Not needed until import volumes routinely exceed synchronous processing limits (currently 10,000 rows). Migration path documented in ADR-002. |
| **AI-assisted onboarding** | Research | Use AI to analyze a new brand's product data and automatically suggest catalog structure, field mappings, and data quality improvements. Depends on Phase 7 AI capabilities and a large enough training dataset of successful onboardings. |
| **Marketplace analytics** | Under consideration | Aggregate delivery and feedback data across retailers to provide cross-marketplace visibility: which retailers accept which products, where rejection rates are highest, which product categories have the best listing success rates. |
| **Supplier portals** | Under consideration | Self-service interfaces for brand teams to upload product data, monitor readiness scores, and track delivery status without requiring Data Kitchen operator involvement. Shifts the platform from operator-only to operator + client. |
| **Retail scorecards** | Under consideration | Per-client, per-retailer summary reports showing readiness trends, delivery success rates, and feedback resolution velocity over time. Useful for Managed Product Data Operations reporting. |
| **Workflow automation** | Deferred | Rule-based automation for repetitive operational tasks: auto-approve corrections below a confidence threshold, auto-schedule deliveries when readiness reaches a target, auto-escalate exceptions after a timeout. Depends on Phases 4–6 being stable before automation is safe. |
| **Excel import/export** | Under consideration | Add .xlsx as a supported import format alongside CSV and JSON. Many brands and retailers still exchange data via Excel. Requires a parser addition, not an architecture change. |
| **Multi-language product content** | Research | Locale-specific product descriptions, translated attributes, and per-market content variants. Significant data model implications (canonical product becomes a per-locale entity). Needs clear business demand before design investment. |
| **API feed ingestion** | Under consideration | Real-time or scheduled ingestion from source system APIs (PIM APIs, ERP exports, vendor portals) in addition to file-based import. Extends the import engine, not replaces it. |
| **Webhook notifications** | Under consideration | Push notifications to external systems when products change, imports complete, or validation status changes. Depends on event-driven processing. |

---

## Success Metrics

Each phase has criteria that define what "done" means before the next phase begins. These focus on product maturity and business capability, not implementation tasks.

### Phase 1: Real Catalog Intake

- A brand's product catalog can be imported from CSV or JSON with zero data loss.
- Every product field is traceable to its source record, source field, and original value.
- Every product change is recorded with what changed, when, and what caused it.
- Duplicate products are detected and merged without overwriting existing data.
- The platform runs in production with real client data.
- The prototype's five remaining screens continue to function unchanged.

### Phase 2: Retail Intelligence Library

- At least 3 major retailer schemas (e.g., Walmart, Amazon, Target) are fully modeled with required fields, validation rules, and taxonomies.
- A canonical product can be scored for readiness against any modeled retailer, with specific field-level blockers identified.
- Readiness scores update automatically when product data changes.
- A new retailer can be onboarded by modeling its requirements — no code changes required.

### Phase 3: Mapping Engine

- Canonical products can be mapped to retailer-specific formats using persistent, reusable rules.
- A mapping configuration can be created from a template, customized, and versioned.
- Operators can preview the retailer-specific output for any product before committing.
- Mapping coverage is visible: which fields are mapped, which are missing, which need attention.

### Phase 4: Validation Engine

- Products are validated against retailer-specific rules before delivery.
- Validation failures are linked to specific rules, specific fields, and specific remediation guidance.
- Products below a readiness threshold are blocked from delivery.
- Deterministic auto-heal suggestions are available for common issues, with human approval required.
- Validation results are visible as a per-product, per-retailer readiness report.

### Phase 5: Delivery Engine

- Retailer-specific payloads can be generated and delivered through at least one automated channel (API or file export).
- Delivery history provides a complete outbound audit trail.
- At least one retailer integration is operational end-to-end (import → canonical → map → validate → deliver).
- Delivery can be scheduled for recurring automated submission.

### Phase 6: Feedback Engine

- Retailer rejections are ingested, parsed, and linked to canonical products and fields.
- Corrections flow back through the pipeline (mapping → validation → re-delivery) without manual data re-entry.
- Operational dashboards show rejection patterns across retailers and time periods.
- The end-to-end pipeline is closed-loop: source → canonical → delivery → feedback → correction → re-delivery.

### Phase 7: AI Platform

- At least one AI capability (mapping suggestions, attribute prediction, or duplicate detection) is deployed in production with measurable accuracy.
- AI suggestions require human approval — no autonomous changes to product data.
- AI accuracy is evaluated against the deterministic validation framework, not subjective human judgment.
- Removing all AI capabilities does not break any workflow — the platform degrades to manual operation, not failure.
