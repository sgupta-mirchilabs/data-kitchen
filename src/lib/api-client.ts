const BASE_URL = import.meta.env.VITE_API_URL ?? "/api/v1";

interface ApiResponse<T> {
  data: T;
  meta?: { page: number; limit: number; total: number; totalPages: number };
}

interface ApiError {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function handleResponse<T>(response: Response): Promise<ApiResponse<T>> {
  if (!response.ok) {
    let body: ApiError | null = null;
    try {
      body = await response.json();
    } catch { /* ignore parse failures */ }
    throw new ApiClientError(
      response.status,
      body?.error?.code ?? "UNKNOWN",
      body?.error?.message ?? `HTTP ${response.status}`,
      body?.error?.details,
    );
  }
  return response.json();
}

export const api = {
  async get<T>(path: string): Promise<ApiResponse<T>> {
    const response = await fetch(`${BASE_URL}${path}`);
    return handleResponse<T>(response);
  },

  async post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return handleResponse<T>(response);
  },

  async uploadFile<T>(path: string, file: File, fields?: Record<string, string>): Promise<ApiResponse<T>> {
    const formData = new FormData();
    formData.append("file", file);
    if (fields) {
      for (const [key, value] of Object.entries(fields)) {
        formData.append(key, value);
      }
    }
    const response = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      body: formData,
    });
    return handleResponse<T>(response);
  },

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(3000) });
      if (!response.ok) return false;
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) return false;
      const body = await response.json();
      return body?.status === "ok";
    } catch {
      return false;
    }
  },
};

export { ApiClientError };
