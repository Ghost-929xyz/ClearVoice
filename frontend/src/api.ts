const DESKTOP_API_BASE = 'http://127.0.0.1:8000';

export function apiUrl(path: string) {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  if (window.location.protocol === 'file:') {
    return `${DESKTOP_API_BASE}${path}`;
  }
  return path;
}
