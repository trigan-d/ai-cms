/**
 * Per-tenant PWA layer. Every published tenant site is installable WITHOUT the AI
 * having to author manifest/service-worker boilerplate: the platform serves these at
 * fixed paths on the tenant's origin and injects the tags into served HTML.
 *
 * Paths (on <sub>.platform.ru): /manifest.webmanifest, /sw.js, /pwa-icon.svg
 */

const DEFAULT_THEME = "#2563eb";

export const PWA_PATHS = {
  manifest: "manifest.webmanifest",
  sw: "sw.js",
  icon: "pwa-icon.svg",
} as const;

export function isPwaPath(rel: string): boolean {
  return rel === PWA_PATHS.manifest || rel === PWA_PATHS.sw || rel === PWA_PATHS.icon;
}

export function manifestJson(name: string, themeColor = DEFAULT_THEME): string {
  return JSON.stringify(
    {
      name,
      short_name: name.slice(0, 20),
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#ffffff",
      theme_color: themeColor,
      icons: [
        {
          src: `/${PWA_PATHS.icon}`,
          sizes: "any",
          type: "image/svg+xml",
          purpose: "any maskable",
        },
      ],
    },
    null,
    2,
  );
}

/** Minimal app-shell service worker: cache-first for same-origin GET, network fallback. */
export function serviceWorkerJs(): string {
  return `const CACHE = 'aicms-v1';
self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(req).then((hit) => {
        const net = fetch(req).then((res) => {
          if (res && res.status === 200) cache.put(req, res.clone());
          return res;
        }).catch(() => hit);
        return hit || net;
      })
    )
  );
});
`;
}

/** A simple rounded-square icon with the site's initial — avoids needing PNG assets. */
export function iconSvg(name: string, themeColor = DEFAULT_THEME): string {
  const letter = (name.trim()[0] ?? "•").toUpperCase();
  const safe = letter.replace(/[<>&"]/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="${themeColor}"/>
  <text x="50%" y="50%" dy="0.36em" text-anchor="middle"
        font-family="system-ui, sans-serif" font-size="300" font-weight="700"
        fill="#ffffff">${safe}</text>
</svg>`;
}

const HEAD_TAGS = (themeColor: string) =>
  `<link rel="manifest" href="/${PWA_PATHS.manifest}">` +
  `<meta name="theme-color" content="${themeColor}">` +
  `<link rel="apple-touch-icon" href="/${PWA_PATHS.icon}">` +
  `<script>if('serviceWorker' in navigator){addEventListener('load',()=>navigator.serviceWorker.register('/${PWA_PATHS.sw}').catch(()=>{}))}</script>`;

/** Inject PWA tags into a served HTML document (idempotent-ish: skips if already present). */
export function injectPwaTags(html: string, themeColor = DEFAULT_THEME): string {
  if (html.includes('rel="manifest"')) return html;
  const tags = HEAD_TAGS(themeColor);
  if (html.includes("</head>")) return html.replace("</head>", tags + "</head>");
  if (html.includes("<head>")) return html.replace("<head>", "<head>" + tags);
  return tags + html;
}
