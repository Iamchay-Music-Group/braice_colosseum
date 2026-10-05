/**
 * Vercel function for every `/api/*` request.
 *
 * Vercel builds one serverless function per file in `api/`. `api/[...path].js`
 * is the catch-all, so a single function serves the whole API — the global
 * `api` prefix in `app.setup.ts` means the function receives the full original
 * path (`/api/health`, `/api/users/...`) and Nest routes it from there.
 *
 * This file is JavaScript on purpose. The handler itself is
 * `apps/api/src/vercel.ts`, compiled to `apps/api/dist/vercel.js` by `nest
 * build` and type-checked with the rest of the API; putting the entry point in
 * `src/` and shimming it here means the Vercel function needs no TypeScript
 * compilation of its own, no second `tsconfig`, and no reliance on path aliases
 * when Vercel packages it.
 *
 * The path to `dist/` climbs out of `apps/api` and therefore out of a subfolder.
 * That is the whole reason this file sits at the repository root rather than in
 * `apps/api/api/`: Vercel only discovers functions in `<Root Directory>/api/`,
 * and functions defined in a subdirectory are not packaged reliably (vercel/vercel#12398).
 * It also keeps `packages/*` inside the Root Directory, so the workspace
 * packages `apps/api` imports at runtime are traced into the function bundle
 * instead of being dropped as "files outside the Root Directory".
 *
 * `?? entry` rather than `.default` alone: `dist/vercel.js` is CommonJS, so the
 * compiled default export is a property, and the fallback keeps this working if
 * the module is ever loaded as a bare function.
 */
const entry = require('../apps/api/dist/vercel.js');

module.exports = entry.default ?? entry;