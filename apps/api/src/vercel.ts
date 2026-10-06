/**
 * Vercel serverless entry point.
 *
 * The function Vercel builds for this app is the thin shim at `api/index.js`,
 * which re-exports the default export below. The logic lives in `src/` — rather
 * than in a JavaScript file at `api/` — so that it is compiled and type-checked
 * by `nest build` like the rest of the API, and so that Vercel never has to
 * transpile TypeScript whose `tsconfig` extends a base config outside the
 * project directory.
 *
 * Three properties matter here and all are load-bearing:
 *
 *   1. NO `app.listen()`. A serverless function is invoked per request and has
 *      no port to bind; binding one either hangs the invocation or leaks a
 *      listener per cold start. `init()` prepares the app without listening, and
 *      the Express instance is then used directly as a request listener.
 *   2. ONE app per function instance. Nest's providers, TypeORM's connection
 *      pool and the AI provider chain are all built once at startup. Creating
 *      them per request would open a new Postgres pool on every call and
 *      exhaust the database's connection limit, so the promise is cached.
 *   3. MIGRATIONS BEFORE QUERIES. Nothing else runs the SQL in
 *      `database/migrations` against production — `pnpm db:migrate` is a
 *      local/CI command — so the first query of a fresh database used to die
 *      with `relation "users" does not exist`. `ensureMigrated()` applies the
 *      pending migrations once per instance, before TypeORM ever executes a
 *      statement, and the files are added to the function bundle through
 *      `includeFiles` in `vercel.json`.
 *
 * A failed initialization clears the cache rather than keeping the rejection:
 * the usual cause is the managed database not accepting connections on the very
 * first cold start, and caching that failure would make the instance
 * permanently dead for every later request instead of recovering on the next
 * one.
 */
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { configureApp } from './app.setup';
import { AppModule } from './app.module';
import { runMigrations } from './scripts/migrate';

/**
 * The shape a request listener needs to have.
 *
 * Spelled out instead of using Express's own request handler type because the
 * repository's `@types/express` major and the `@nestjs/platform-express` major
 * do not agree, and importing the express types here would drag that mismatch
 * into the build for no benefit — the instance is only ever called.
 */
type RequestListener = (req: IncomingMessage, res: ServerResponse) => unknown;

let appPromise: Promise<INestApplication> | undefined;
let migrationPromise: Promise<void> | undefined;

/**
 * Apply pending SQL migrations, at most once per function instance.
 *
 * A failure is logged rather than rethrown: if the database was unreachable
 * only for a moment, TypeORM's own connect below still decides whether the
 * boot survives, and the cached promise is cleared so the next invocation
 * retries the migrations instead of running queries against a schema that
 * was never applied. If a migration file itself is broken, the error stays
 * visible in the function logs on every retry until the next deploy.
 */
async function ensureMigrated(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      const connectionString = process.env.DATABASE_URL;
      if (!connectionString) {
        throw new Error('DATABASE_URL is not set; cannot run migrations');
      }
      await runMigrations(connectionString);
    })().catch((error: unknown) => {
      migrationPromise = undefined;
      console.error('[migrations] failed; continuing boot:', error);
    });
  }

  return migrationPromise;
}

/**
 * The initialized Nest application for this function instance.
 *
 * Concurrent invocations during a cold start all await the same promise, so the
 * application — and its database pool — is built exactly once no matter how
 * many requests arrive at the same moment.
 */
async function getServerlessApp(): Promise<INestApplication> {
  if (!appPromise) {
    appPromise = (async () => {
      await ensureMigrated();
      const app = configureApp(await NestFactory.create(AppModule));
      await app.init();
      return app;
    })().catch((error: unknown) => {
      appPromise = undefined;
      throw error;
    });
  }

  return appPromise;
}

/**
 * Handle one request.
 *
 * Express is a `(req, res, next)` function, so the instance is handed the
 * arguments directly. Going through the adapter rather than reimplementing
 * routing here is what keeps middleware, guards, filters, CORS and the Swagger
 * routes behaving identically to the local server.
 */
async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<unknown> {
  const app = await getServerlessApp();
  const requestListener = app.getHttpAdapter().getInstance() as RequestListener;

  return requestListener(req, res);
}

export default handler;
export { handler, getServerlessApp };