const BASE = '/api/v1';

export type ApiErrorDetail = { field?: string; code?: string; message?: string; [key: string]: unknown };

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ApiErrorDetail[];
  readonly correlationId?: string;

  constructor(status: number, code: string, message: string, details: ApiErrorDetail[] = [], correlationId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.correlationId = correlationId;
  }
}

export type SessionUser = {
  id: string;
  organizationId: string;
  email: string;
  fullName: string;
  roleCodes: string[];
  permissions: string[];
  allHospitals: boolean;
  hospitalIds: string[];
  hospitals?: Array<{ id: string; code: string; name: string }>;
  mfaEnabled?: boolean;
};

type SessionResponse = { user: SessionUser; accessToken: string };

let accessToken: string | null = null;
let refreshing: Promise<SessionResponse | null> | null = null;
let onSessionLost: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

export function setSessionLostHandler(handler: (() => void) | null) {
  onSessionLost = handler;
}

async function toError(response: Response): Promise<ApiError> {
  let body: { error?: { code?: string; message?: string; details?: ApiErrorDetail[]; correlationId?: string } } = {};
  try {
    body = await response.json();
  } catch {
    /* non-JSON error body */
  }
  const error = body.error ?? {};
  return new ApiError(
    response.status,
    error.code ?? 'ERROR',
    error.message ?? `Request failed (${response.status})`,
    error.details ?? [],
    error.correlationId,
  );
}

/** Exchanges the httpOnly refresh cookie for a new access token. Concurrent callers share one call. */
export function refreshSession(): Promise<SessionResponse | null> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const response = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
        if (!response.ok) return null;
        const session = (await response.json()) as SessionResponse;
        accessToken = session.accessToken;
        return session;
      } catch {
        return null;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
  blob?: boolean;
};

export function buildQuery(query?: RequestOptions['query']): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { ...options.headers };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let body: BodyInit | undefined;
  if (options.form) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  return fetch(`${BASE}${path}${buildQuery(options.query)}`, {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers,
    body,
  });
}

export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await send(path, options);
  if (response.status === 401 && !path.startsWith('/auth/')) {
    const session = await refreshSession();
    if (!session) {
      accessToken = null;
      onSessionLost?.();
      throw await toError(response);
    }
    response = await send(path, options);
  }
  if (!response.ok) throw await toError(response);
  if (response.status === 204) return undefined as T;
  if (options.blob) return (await response.blob()) as T;
  return (await response.json()) as T;
}

/** A fresh idempotency key for a single user intent (e.g. one click on "Allocate"). */
export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // randomUUID exists only in secure contexts (HTTPS or localhost); build a v4 UUID otherwise.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
