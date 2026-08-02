import { useState, useRef, type DragEvent } from "react";
import { UploadCloud, FileSpreadsheet, Braces, AlertTriangle } from "lucide-react";

const ACCEPTED_TYPES = [".csv", ".tsv", ".json"];
const ACCEPTED_MIMES = ["text/csv", "application/json", "text/tab-separated-values", "text/plain"];

interface Props {
  onFileSelected: (file: File) => void;
  maxSizeMb: number;
}

export function FileDropZone({ onFileSelected, maxSizeMb }: Props) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function validate(file: File): string | null {
    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!ACCEPTED_TYPES.includes(ext) && !ACCEPTED_MIMES.includes(file.type)) {
      return `Unsupported file type: ${ext}. Use .csv, .tsv, or .json`;
    }
    if (file.size > maxSizeMb * 1024 * 1024) {
      return `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is ${maxSizeMb} MB.`;
    }
    if (file.size === 0) {
      return "File is empty";
    }
    return null;
  }

  function handleFile(file: File) {
    const err = validate(file);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    onFileSelected(file);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      style={{
        border: `2px dashed ${dragging ? "var(--mirchi)" : error ? "var(--red)" : "var(--border)"}`,
        borderRadius: 10, padding: "48px 24px", textAlign: "center",
        cursor: "pointer",
        background: dragging ? "var(--mirchi-dim)" : "var(--surface)",
        transition: "all 0.15s ease", display: "flex", flexDirection: "column",
        alignItems: "center", gap: 12,
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.tsv,.json"
        style={{ display: "none" }}
        onChange={onInputChange}
      />

      <div style={{
        width: 48, height: 48, borderRadius: 12,
        background: "var(--surface-raised)", border: "1px solid var(--border)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <UploadCloud size={22} color="var(--text-muted)" />
      </div>

      <div>
        <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)", marginBottom: 4 }}>
          Drop your product data file here
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          .csv · .tsv · .json
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-muted)" }}>
          <FileSpreadsheet size={11} /> CSV/TSV
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-muted)" }}>
          <Braces size={11} /> JSON
        </span>
      </div>

      <div style={{
        marginTop: 4, padding: "6px 16px", borderRadius: 6,
        background: "var(--mirchi)", color: "white",
        fontSize: 12, fontWeight: 600, display: "inline-block",
      }}>
        Browse file
      </div>

      {error && (
        <div style={{
          display: "flex", alignItems: "center", gap: 6, marginTop: 4,
          fontSize: 12, color: "var(--red)",
        }}>
          <AlertTriangle size={12} /> {error}
        </div>
      )}
    </div>
  );
}
