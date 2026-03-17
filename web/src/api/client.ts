/**
 * API client for Neon-backed endpoints. Sends Clerk session token with each request.
 */

let tokenGetter: (() => Promise<string | null>) | null = null;

export function setTokenGetter(getter: () => Promise<string | null>) {
  tokenGetter = getter;
}

async function getToken(): Promise<string | null> {
  if (!tokenGetter) return null;
  return tokenGetter();
}

async function request<T = unknown>(
  path: string,
  options: { method?: string; body?: object; headers?: HeadersInit } = {}
): Promise<T> {
  const token = await getToken();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  if (token) (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;

  const url = path.startsWith('http') ? path : `/api${path}`;
  const body = options.body !== undefined ? JSON.stringify(options.body) : undefined;
  const res = await fetch(url, {
    method: options.method ?? 'GET',
    headers,
    body,
  });

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || res.statusText || String(res.status));
  return data as T;
}

export const api = {
  get: <T = unknown>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T = unknown>(path: string, body: object) => request<T>(path, { method: 'POST', body }),
  patch: <T = unknown>(path: string, body: object) => request<T>(path, { method: 'PATCH', body }),
  delete: (path: string) => request(path, { method: 'DELETE' }),
};
