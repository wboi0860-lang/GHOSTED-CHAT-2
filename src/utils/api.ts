const DEFAULT_REMOTE_API_ORIGIN =
  'https://ais-pre-c6wn57hm26pl5fw3irirgt-663224413059.europe-west2.run.app';

function isNativeAppOrigin(): boolean {
  if (typeof window === 'undefined') return false;
  const { protocol, hostname, port } = window.location;
  if (protocol === 'capacitor:' || protocol === 'file:' || protocol === 'ionic:') {
    return true;
  }
  // Capacitor Android serves bundled assets on https://localhost or http://localhost (no dev port)
  if ((hostname === 'localhost' || hostname === '127.0.0.1') && !port) {
    return true;
  }
  return false;
}

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const configuredBase =
    (typeof import.meta !== 'undefined' &&
      (import.meta as any).env?.VITE_API_BASE_URL) ||
    '';

  if (configuredBase) {
    return `${String(configuredBase).replace(/\/+$/, '')}${cleanPath}`;
  }
  if (isNativeAppOrigin()) {
    return `${DEFAULT_REMOTE_API_ORIGIN}${cleanPath}`;
  }
  return cleanPath;
}
