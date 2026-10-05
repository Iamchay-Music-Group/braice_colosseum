/**
 * Vercel serverless entry point.
 *
 * The function Vercel builds for this app is the thin shim at
 * `api/[...path].js`, which re-exports the default export below. The logic
 * lives in `src/` — rather than in a JavaScript file at `api/` — so that it is
 * compiled and type-checked by `nest build` like the rest of the API, and so
 * that Vercel never has to transpile TypeScript whose `tsconfig` extends a base
 * config outside the project directory.
 *
 * Two properties matter here and both are load-bearing:
 *
 *   1. NO `app.listen()`. A serverless function is invoked per request and has
 *      no port to bind; binding one either hangs the invocation or leaks a
 *      listener per cold start. `init()` prepares the app without listening, and
 *      the Express instance is then used directly as a request listener.
 *   2. ONE app per function instance. Nest's providers, TypeORM's connection
 *      pool and the AI provider chain are all built once at startup. Creating
 *      them per request would open a new Postgres pool on every call and
 *      exhaust the database's connection limit, so the promise is cached.
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