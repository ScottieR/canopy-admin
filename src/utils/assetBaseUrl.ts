const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

export function getAssetBaseUrl() {
  const envBase =
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) ||
    (typeof window !== 'undefined' ? window.location.origin : '');

  return trimTrailingSlash(envBase || 'http://localhost:3001');
}

export function resolveAssetUrl(path: string) {
  if (!path) return path;
  if (/^https?:\/\//i.test(path)) return path;

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getAssetBaseUrl()}${normalizedPath}`;
}
