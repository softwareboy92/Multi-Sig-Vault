const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';

export class ApiError extends Error {
  code: string;
  status: number;
  details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    status: number,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

interface ErrorResponse {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface BackendResponse<T> {
  success: boolean;
  data: T;
  pagination?: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
  meta?: {
    timestamp: string;
    request_id: string | null;
  };
}

export function transformPaginatedResponse<T>(
  response: BackendResponse<T[]>,
): {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
} {
  return {
    items: response.data,
    total: response.pagination?.total ?? response.data.length,
    page: response.pagination?.page ?? 1,
    page_size: response.pagination?.page_size ?? response.data.length,
    total_pages: response.pagination?.total_pages ?? 1,
  };
}

export function extractData<T>(response: BackendResponse<T>): T {
  return response.data;
}

// ---------------------------------------------------------------------------
// Network-aware fetch wrapper
// ---------------------------------------------------------------------------

async function safeFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (err) {
    if (err instanceof TypeError) {
      throw new ApiError(
        "NETWORK_ERROR",
        "",
        0,
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Response handler
// ---------------------------------------------------------------------------

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorData: ErrorResponse;
    try {
      const json = await response.json();
      errorData = {
        code: json.error?.code ?? json.code ?? 'API_ERROR',
        message:
          json.error?.message ?? json.message ?? json.detail ?? response.statusText ?? 'Unknown error',
        details: json.error?.details ?? json.details,
      };
    } catch {
      errorData = {
        code: 'UNKNOWN_ERROR',
        message: response.statusText || 'Unknown error',
      };
    }

    throw new ApiError(
      errorData.code,
      errorData.message,
      response.status,
      errorData.details,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

// ---------------------------------------------------------------------------
// HTTP methods
// ---------------------------------------------------------------------------

export async function apiGet<T>(endpoint: string): Promise<T> {
  const response = await safeFetch(`${API_BASE}${endpoint}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  return handleResponse<T>(response);
}

export async function apiPost<T, D = unknown>(
  endpoint: string,
  data?: D,
): Promise<T> {
  const response = await safeFetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: data ? JSON.stringify(data) : undefined,
  });
  return handleResponse<T>(response);
}

export async function apiPut<T, D = unknown>(
  endpoint: string,
  data: D,
): Promise<T> {
  const response = await safeFetch(`${API_BASE}${endpoint}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return handleResponse<T>(response);
}

export async function apiDelete<T>(endpoint: string): Promise<T> {
  const response = await safeFetch(`${API_BASE}${endpoint}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });
  return handleResponse<T>(response);
}

export async function apiPatch<T, D = unknown>(
  endpoint: string,
  data: D,
): Promise<T> {
  const response = await safeFetch(`${API_BASE}${endpoint}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return handleResponse<T>(response);
}
