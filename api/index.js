/**
 * The single Vercel function for this API. Every request the platform routes
 * to it is answered by the same Express instance (see `apps/api/src/vercel.ts`).
 *
 * Vercel only discovers functions in `<Root Directory>/api/`, so this file sits
 * at the repository root rather than in `apps/api/api/`: a function defined in
 * a subdirectory is not packaged reliably (vercel/vercel#12398), and keeping it
 * here also keeps `packages/*` inside the Root Directory so the workspace
 * packages `apps/api` imports at runtime are traced into the function bundle
 * instead of being dropped as "files outside the Root Directory".
 *
 * Why there is no `api/[...path].js` catch-all. Vercel's `[...path]` only ever
 * matches a single segment — `/api/health` would match, `/api/auth/login`
 * would not — so nested routes were answered by the platform's own 404 page
 * (`x-vercel-error: NOT_FOUND`) before the app saw them. The rewrite
 * `"/api/(.*)": "/api"` in `vercel.json` closes that gap: the CDN selects this
 * function for every `/api/*` path, and a same-application rewrite passes the
 * original request path through, so Nest still routes on `/api/auth/login`,
 * `/api/communities/42/members`, and so on.
 *
 * `entry.default ?? entry`: `dist/vercel.js` is CommonJS, so the compiled
 * default export is a property, and the fallback keeps this working if the
 * module is ever loaded as a bare function.
 */
const entry = require('../apps/api/dist/vercel.js');

module.exports = entry.default ?? entry;
