import { acquireAccessToken, isEntraConfigured } from "../auth/authConfig";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api/v1";

const ORG_STORAGE_KEY = "dk-selected-org-id";

/**
 * Builds request headers.
 *
 * In cloud builds Entra is configured and the bearer token comes from MSAL. In
 * local development Entra is absent and VITE_DEV_AUTH_TOKEN is used instead —
 * that variable is never set in a cloud build, so no shared token is ever
 * embedded in a published bundle.
 */
async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};

  if (isEntraConfigured) {
    const token = await acquireAccessToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  } else {
    const devToken = import.meta.env.VITE_DEV_AUTH_TOKEN;
    if (devToken) headers["Authorization"] = `Bearer ${devToken}`;
  }

  const orgId = sessionStorage.getItem(ORG_STORAGE_KEY);
  if (orgId) {
    headers["X-Organization-Id"] = orgId;
  }

  return headers;
}

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

    const code = body?.error?.code ?? "UNKNOWN";

    if (code === "INVALID_ORGANIZATION" || code === "FORBIDDEN") {
      sessionStorage.removeItem(ORG_STORAGE_KEY);
    }

    throw new ApiClientError(
      response.status,
      code,
      body?.error?.message ?? `HTTP ${response.status}`,
      body?.error?.details,
    );
  }
  return response.json();
}

const ORG_NAME_KEY = "dk-selected-org-name";

export function setSelectedOrganization(orgId: string, orgName?: string): void {
  sessionStorage.setItem(ORG_STORAGE_KEY, orgId);
  // Display-only. Never used for authorization — the server re-validates the
  // organization id on every request.
  if (orgName) sessionStorage.setItem(ORG_NAME_KEY, orgName);
}

export function getSelectedOrganization(): string | null {
  return sessionStorage.getItem(ORG_STORAGE_KEY);
}

export function getSelectedOrganizationName(): string | null {
  return sessionStorage.getItem(ORG_NAME_KEY);
}

export function clearSelectedOrganization(): void {
  sessionStorage.removeItem(ORG_STORAGE_KEY);
  sessionStorage.removeItem(ORG_NAME_KEY);
}

export const api = {
  async get<T>(path: string): Promise<ApiResponse<T>> {
    const response = await fetch(`${BASE_URL}${path}`, {
      headers: { ...(await authHeaders()) },
    });
    return handleResponse<T>(response);
  },

  async post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return handleResponse<T>(response);
  },

  async patch<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
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
      headers: { ...(await authHeaders()) },
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
