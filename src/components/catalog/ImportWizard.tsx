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

  async function handleConfirm(mappings: Record<string, string>) {
    if (!uploadData) return;
    setStage("importing");
    setError(null);

    try {
      const res = await api.post<ImportResultData>(
        `/imports/${uploadData.importBatchId}/confirm`,
        { fieldMappings: mappings },
      );
      setResults(res.data);
      setStage("results");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
      setStage("mapping");
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
                onContinue={() => setStage("mapping")}
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
              <ImportProgress isComplete={false} />
            </motion.div>
          )}

          {stage === "results" && results && (
            <motion.div key="results" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <ImportResults
                results={results}
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
