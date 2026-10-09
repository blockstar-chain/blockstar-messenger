// frontend/src/lib/assetUrl.ts
// Resolve a file from /public (e.g. "/sounds/ringtone.mp3") so it loads on every
// platform. On the web and in the iOS/Android apps "/sounds/x.mp3" is fine, but
// the desktop app loads the page from file://…/out/index.html, where
// "/sounds/x.mp3" means the root of the disk (file:///sounds/x.mp3) — that's the
// ERR_FILE_NOT_FOUND testers saw, and why the desktop app had no sounds at all.
export function assetUrl(path: string): string {
  if (typeof window === 'undefined') return path;
  if (/^(https?:|data:|blob:|file:)/i.test(path)) return path;
  const clean = path.replace(/^\/+/, '');
  if (window.location.protocol === 'file:') {
    const p = window.location.pathname; // e.g. /C:/Program Files/…/out/call/index.html
    const i = p.lastIndexOf('/out/');
    const root = i >= 0 ? p.slice(0, i + 5) : p.replace(/[^/]*$/, '');
    return `file://${root}${clean}`;
  }
  return `/${clean}`;
}
