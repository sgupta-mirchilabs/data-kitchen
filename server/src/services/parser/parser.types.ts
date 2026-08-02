export interface ParsedRow {
  rowNumber: number;
  data: Record<string, string>;
}

export interface ParseWarning {
  rowNumber?: number;
  column?: string;
  message: string;
  type: "duplicate_header" | "empty_row" | "column_count_mismatch" | "encoding" | "structure";
}

export interface ParseResult {
  headers: string[];
  rows: ParsedRow[];
  warnings: ParseWarning[];
  metadata: ParseMetadata;
}

export interface ParseMetadata {
  delimiter?: string;
  encoding: string;
  totalRows: number;
  jsonStructure?: "array" | "object_with_products" | null;
}

export interface PreviewResult {
  headers: string[];
  sampleRows: ParsedRow[];
  totalRows: number;
  warnings: ParseWarning[];
  metadata: ParseMetadata;
}
