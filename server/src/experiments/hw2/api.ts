/** Minimal client for the disposable DevDigest API; the runner never calls a model provider. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The longest one request to the local stack may take, headers and body. The
 * slowest route reads the provider's endpoints (bounded at 15 s server-side).
 * Without it, fetch waits up to its own 300 s headers timeout, so a stack that
 * stops answering would hold a slot's poll that long past the runner deadline.
 */
export const API_REQUEST_TIMEOUT_MS = 60_000;

export class ExperimentApi {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
    private readonly timeoutMs: number = API_REQUEST_TIMEOUT_MS,
  ) {}

  /** `timeoutMs` can only shorten the client's bound, e.g. to what is left of a caller's deadline. */
  async request<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown, headers: Record<string, string> = {}, timeoutMs?: number): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(Math.max(1, Math.min(this.timeoutMs, timeoutMs ?? this.timeoutMs))),
    });
    const text = await res.text();
    const parsed = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) {
      const message = (parsed as { error?: { message?: string } } | null)?.error?.message ?? res.statusText;
      throw new ApiError(res.status, parsed, `${method} ${path} → ${res.status}: ${message}`);
    }
    return parsed as T;
  }

  get<T>(path: string, timeoutMs?: number) {
    return this.request<T>('GET', path, undefined, {}, timeoutMs);
  }
  post<T>(path: string, body: unknown, headers: Record<string, string> = {}) {
    return this.request<T>('POST', path, body, headers);
  }
  put<T>(path: string, body: unknown) {
    return this.request<T>('PUT', path, body);
  }
  patch<T>(path: string, body: unknown) {
    return this.request<T>('PATCH', path, body);
  }
  delete<T>(path: string, headers: Record<string, string> = {}) {
    return this.request<T>('DELETE', path, undefined, headers);
  }
}
