# Cross-origin panel cannot use CPA routes proxied by manager-server

- found: 2026-11-18, plan: 20261118-codex-speed-panel-ui, phase: evaluation
- severity: minor
- area: apps/manager-server/internal/http/middleware/cors.go

When the panel runs on another origin than manager-server, every CPA route the
manager proxies fails the browser's CORS check. `rootHandler` wraps the proxy in
`middleware.WithCORS` (`apps/manager-server/internal/http/router/router.go:86-88`,
`:129-131`), which sets `Access-Control-Allow-Origin` before
`httputil.ReverseProxy` runs (`apps/manager-server/internal/service/proxy/service.go:256-301`).
CPA sets its own `Access-Control-Allow-Origin: *` on every response (CPA
`internal/api/server.go:232`, `internal/api/server_middleware.go:433-447`), and
`ReverseProxy` adds upstream headers to the ones already set. So the response
carries two values (`*, *`, or `<origin>, *` with `USAGE_CORS_ORIGINS` set), and
browsers reject it. This affects `GET /v8/management/routing/profiles`,
`GET /v8/management/config` and every panel write. Same-origin use, where
manager-server serves `management.html`, is not affected.

Two smaller gaps on the same path:
- The manager's preflight allowlist (`cors.go:39`) does not list `If-Match`. The
  speed table's conditional key write sends `If-Match`
  (`apps/web/src/features/personal-quota-support/services/api/routingProfiles.ts`).
  CPA's own preflight echoes the requested headers, so the header works only when
  the panel talks to CPA directly.
- The manager sets no `Access-Control-Expose-Headers`. CPA exposes `ETag` and the
  `X-CPA-*` headers, and that value reaches the browser only because the proxy
  copies it.

Fix direction: in `proxyToSavedSetup`, have `ModifyResponse` drop the upstream
`Access-Control-*` headers, so the manager's values are the only ones. Add
`If-Match` to the allowlist, and expose `ETag` plus the CPA version headers the
panel reads. Add a router test: a cross-origin `GET` through the v8 proxy gets
exactly one `Access-Control-Allow-Origin`, and a preflight asking for `if-match`
is allowed.
