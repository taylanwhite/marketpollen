/**
 * API client for Neon-backed endpoints. Sends Firebase ID token with each request.
 */

import { auth } from '../firebase/config';

const BASE = ''; // same origin; use Vercel dev or proxy /api in dev

async function getToken(): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken();
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

  const url = path.startsWith('http') ? path : `${BASE}/api${path}`;
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
