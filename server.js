/**
 * Vercel entrypoint.
 *
 * Vercel looks for a `server.js` at the project root and turns it into a
 * single Vercel Function, capturing the HTTP server that `listen()` opens
 * during module startup. That is exactly what `nest build`'s output already
 * does on boot, so the entrypoint's whole job is to load it.
 *
 * Why the project root and not `apps/api`: the NestJS zero-config entrypoint
 * names (`src/main.ts`, `main.ts`, `server.ts`) are resolved relative to the
 * project root, and this repository's deployable app is at `apps/api`. Pointing
 * the Vercel project at `apps/api` instead would leave no lockfile, no
 * workspace siblings and no way to satisfy the three `workspace:*` dependencies
 * the API imports — the same reason the Dockerfile builds from the repository
 * root.
 *
 * This file is deliberately a loader and nothing else. The CORS origin, the
 * global prefix, the validation pipe and the port all live in
 * `apps/api/src/main.ts`, so there is exactly one place that decides how the
 * API is configured and this one cannot drift from it.
 *
 * Not an HTTP handler: exporting a `(request, response)` function would put the
 * API behind an adapter and change how every route, interceptor and the
 * Swagger UI are mounted. The server-capture form keeps the request path
 * identical to the container in `Dockerfile`.
 */

require('./apps/api/dist/main.js');