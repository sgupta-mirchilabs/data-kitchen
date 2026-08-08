import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { FileDropZone } from "./FileDropZone";
import { ImportPreview } from "./ImportPreview";
import { FieldMapper } from "./FieldMapper";
import { ImportProgress } from "./ImportProgress";
import { ImportResults } from "./ImportResults";
import { api } from "../../lib/api-client";
import { CatalogTypeBadge } from "./CatalogSelector";

type Stage = "upload" | "preview" | "mapping" | "importing" | "results";

interface ImportStatus {
  id: string;
  status: string;
  filename: string;
  totalRows: number;
  progressRows: number;
  successfulRows: number;
  warningRows: number;
  failedRows: number;
  elapsedMs: number | null;
  isTerminal: boolean;
  cancelRequested: boolean;
  attempts: number;
  maxAttempts: number;
  errorCode: string | null;
  errorMessage: string | null;
}

interface ParsedRow {
  rowNumber: number;
  data: Record<string, string>;
}

interface UploadResponse {
  importBatchId: string;
  preview: {
    headers: string[];
    sampleRows: ParsedRow[];
    totalRows: number;
    warnings: Array<{ rowNumber?: number; column?: string; message: string; type: string }>;
    metadata: Record<string, unknown>;
  };
  suggestedMappings: Record<string, string>;
  templateMatch?: {
    kind: "exact" | "partial" | "none";
    templateId: string | null;
    version: number | null;
    coverage: number;
    newHeaders: string[];
    missingHeaders: string[];
  };
  duplicates?: {
    groups: Array<{
      sku: string; occurrences: number; rowNumbers: number[];
      winningRow: number; overwrittenRows: number[];
    }>;
    overwrittenRows: number;
  };
  projection?: {
    totalRows: number;
    distinctProducts: number;
    willCreate: number;
    willUpdate: number;
    existingMatches: Array<{ key: string; matchedOn: "sku" | "gtin"; productName: string | null }>;
    existingMatchesTruncated: number;
  };
}

interface ImportResultData {
  totalRows: number;
  successfulRows: number;
  warningRows: number;
  failedRows: number;
  createdProducts: number;
  updatedProducts: number;
  warnings: Array<{ rowNumber?: number; message: string }>;
  errors: Array<{ rowNumber?: number; message: string }>;
  validationIssues?: Array<{ rowNumber: number; code: string; message: string; field: string }>;
  skippedRows?: number;
  durationMs?: number;
  filename?: string;
  savedTemplate?: { id: string; version: number; created: boolean } | null;
  importBatchId?: string;
  status?: string;
}


/**
 * Adapts the polled job status into the shape ImportResults renders.
 *
 * The detailed per-row warnings live on the batch's errorSummary and are not
 * carried by the lightweight status endpoint, so the summary shows counts and
 * the operator opens Import History for the detail.
 */
function statusToResults(status: ImportStatus | null): ImportResultData | null {
  if (!status) return null;
  return {
    importBatchId: status.id,
    totalRows: status.totalRows,
    successfulRows: status.successfulRows,
    warningRows: status.warningRows,
    failedRows: status.failedRows,
    createdProducts: 0,
    updatedProducts: 0,
    warnings: [],
    errors: status.errorMessage ? [{ message: status.errorMessage }] : [],
    skippedRows: Math.max(0, status.totalRows - status.progressRows),
    durationMs: status.elapsedMs ?? undefined,
    filename: status.filename,
    status: status.status,
  };
}

interface Props {
  catalogId: string;
  /** Shown so the operator can confirm the destination before uploading. */
  catalogName?: string;
  catalogType?: string;
  onClose: () => void;
  onImportComplete: () => void;
}

export function ImportWizard({ catalogId, catalogName, catalogType, onClose, onImportComplete }: Props) {
  const [stage, setStage] = useState<Stage>("upload");
  const [error, setError] = useState<string | null>(null);
  const [uploadData, setUploadData] = useState<UploadResponse | null>(null);
  const [filename, setFilename] = useState("");
  const [results, setResults] = useState<ImportResultData | null>(null);
  const [status, setStatus] = useState<ImportStatus | null>(null);

  async function handleFileSelected(file: File) {
    setError(null);
    setFilename(file.name);

    try {
      const res = await api.uploadFile<UploadResponse>(
        `/catalogs/${catalogId}/imports`,
        file,
      );
      setUploadData(res.data);
      setStage("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    }
  }

  /**
   * Confirms the import. The API returns 202 once the job is durably queued —
   * not when it finishes — so from here the operator may leave the page.
   */
  async function handleConfirm(mappings: Record<string, string>) {
    if (!uploadData) return;
    setStage("importing");
    setError(null);

    try {
      await api.post(`/imports/${uploadData.importBatchId}/confirm`, { fieldMappings: mappings });
      pollStatus(uploadData.importBatchId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
      setStage("mapping");
    }
  }

  /**
   * Polls while the tab is visible. Closing the tab or navigating away only
   * stops the polling — the worker keeps processing regardless.
   */
  function pollStatus(batchId: string) {
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        const res = await api.get<ImportStatus>(`/imports/${batchId}/status`);
        setStatus(res.data);
        if (res.data.isTerminal) {
          stopped = true;
          setStage("results");
          onImportComplete();
          return;
        }
      } catch {
        // A transient poll failure must not abort the import; try again.
      }
      if (!stopped) {
        window.setTimeout(tick, document.hidden ? 10000 : 2500);
      }
    };
    void tick();
    return () => { stopped = true; };
  }

  async function handleCancel() {
    if (!uploadData) return;
    try {
      await api.post(`/imports/${uploadData.importBatchId}/cancel`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel");
    }
  }

  function handleViewCatalog() {
    onImportComplete();
    onClose();
  }

  function handleUploadAnother() {
    setStage("upload");
    setUploadData(null);
    setResults(null);
    setError(null);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      style={{
        border: "1px solid var(--border)", borderRadius: 10,
        background: "var(--surface)", overflow: "hidden",
      }}
    >
      {/* Destination banner — the operator must see where this import lands. */}
      {catalogName && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "8px 16px", borderBottom: "1px solid var(--border)",
          background: "var(--surface-overlay)", fontSize: 12,
        }}>
          <span style={{ color: "var(--text-muted)" }}>Importing into</span>
          <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{catalogName}</span>
          <CatalogTypeBadge catalogType={catalogType} />
        </div>
      )}

      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 16px", borderBottom: "1px solid var(--border)",
        background: "var(--surface-raised)",
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>Import Products</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {stage === "upload" && "Select a CSV or JSON file"}
            {stage === "preview" && "Review parsed data"}
            {stage === "mapping" && "Map source fields to canonical fields"}
            {stage === "importing" && "Importing..."}
            {stage === "results" && "Import complete"}
          </div>
        </div>
        {stage !== "importing" && (
          <button onClick={onClose} style={{
            width: 28, height: 28, borderRadius: 6, border: "1px solid var(--border)",
            background: "var(--surface)", display: "flex", alignItems: "center",
            justifyContent: "center", cursor: "pointer", color: "var(--text-muted)",
          }}>
            <X size={14} />
          </button>
        )}
      </div>

      {/* Error bar */}
      {error && (
        <div style={{
          padding: "8px 16px", background: "var(--red-dim)",
          borderBottom: "1px solid rgba(239,68,68,0.2)",
          fontSize: 12, color: "var(--red)",
        }}>
          {error}
        </div>
      )}

      {/* Content */}
      <div style={{ padding: 16 }}>
        <AnimatePresence mode="wait">
          {stage === "upload" && (
            <motion.div key="upload" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <FileDropZone onFileSelected={handleFileSelected} maxSizeMb={50} />
            </motion.div>
          )}

          {stage === "preview" && uploadData && (
            <motion.div key="preview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <ImportPreview
                headers={uploadData.preview.headers}
                sampleRows={uploadData.preview.sampleRows}
                totalRows={uploadData.preview.totalRows}
                warnings={uploadData.preview.warnings}
                filename={filename}
                templateMatch={uploadData.templateMatch}
                duplicates={uploadData.duplicates}
                projection={uploadData.projection}
                onContinue={() => {
                  // An exact template match already resolves every column, so the
                  // mapping screen would ask the operator to re-confirm work they
                  // have already done. They can still open it via Review Mapping.
                  if (uploadData.templateMatch?.kind === "exact") {
                    void handleConfirm(uploadData.suggestedMappings);
                  } else {
                    setStage("mapping");
                  }
                }}
                onReviewMapping={() => setStage("mapping")}
                onCancel={onClose}
              />
            </motion.div>
          )}

          {stage === "mapping" && uploadData && (
            <motion.div key="mapping" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <FieldMapper
                headers={uploadData.preview.headers}
                suggestedMappings={uploadData.suggestedMappings}
                onConfirm={handleConfirm}
                onBack={() => setStage("preview")}
              />
            </motion.div>
          )}

          {stage === "importing" && (
            <motion.div key="importing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <ImportProgress
                isComplete={false}
                status={status}
                onCancel={handleCancel}
              />
            </motion.div>
          )}

          {stage === "results" && results && (
            <motion.div key="results" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <ImportResults
                results={results ?? statusToResults(status)}
                filename={filename}
                catalogName={catalogName}
                onViewCatalog={handleViewCatalog}
                onUploadAnother={handleUploadAnother}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
