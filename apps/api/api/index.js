/**
 * Vercel function for the bare `/api` path.
 *
 * The catch-all in `[...path].js` matches `/api/<segment>` and not `/api` on its
 * own, so without this file a request to `/api` would be answered by Vercel's
 * own 404 page instead of the JSON error shape Nest returns for every other
 * unknown route.
 */
const entry = require('../dist/vercel.js');

module.exports = entry.default ?? entry;