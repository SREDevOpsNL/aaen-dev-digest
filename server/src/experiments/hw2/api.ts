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

export class ExperimentApi {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {}

  async request<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    const parsed = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) {
      const message = (parsed as { error?: { message?: string } } | null)?.error?.message ?? res.statusText;
      throw new ApiError(res.status, parsed, `${method} ${path} → ${res.status}: ${message}`);
    }
    return parsed as T;
  }

  get<T>(path: string) {
    return this.request<T>('GET', path);
  }
  post<T>(path: string, body: unknown, headers: Record<string, string> = {}) {
    return this.request<T>('POST', path, body, headers);
  }
  put<T>(path: string, body: unknown) {
    return this.request<T>('PUT', path, body);
  }
}
