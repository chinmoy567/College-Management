---
name: cms-performance-pwa
description: Check and improve speed on slow phones and set up the PWA (manifest, service worker, icons, install prompt) for the College Management System. Use for performance or "add to home screen" work.
---

# Performance and PWA

- Targets: fast on a mid-range phone over slow mobile data (throttle to Slow 4G in the browser to test).
- Lazy-load heavy libraries (react-pdf, Recharts), lazy-load images, resize images on upload (sharp), paginate long lists, avoid large client bundles; check weight before adding a library.
- Use TanStack Query caching to avoid refetch storms; avoid layout shift.
- PWA: web app manifest (name, icons, theme color, `display: standalone`), a small service worker, offline fallback page; never cache private API responses or signed URLs.
- Measure with Lighthouse at mobile settings before and after; report numbers.
