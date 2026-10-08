function withProtocol(host?: string): string | undefined {
  if (!host) return undefined;
  return host.startsWith('http') ? host : `https://${host}`;
}

function toWorkingAppUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.hostname === 'marketpollen.com') url.hostname = 'www.marketpollen.com';
    return url.origin;
  } catch {
    return raw.replace(/\/$/, '');
  }
}

export function appUrl(): string {
  return (
    toWorkingAppUrl(withProtocol(process.env.VITE_APP_URL)) ||
    toWorkingAppUrl(withProtocol(process.env.VERCEL_PROJECT_PRODUCTION_URL)) ||
    toWorkingAppUrl(withProtocol(process.env.VERCEL_URL)) ||
    'http://localhost:5173'
  );
}
