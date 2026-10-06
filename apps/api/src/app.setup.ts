/**
 * Shared HTTP bootstrap.
 *
 * Everything that shapes the HTTP surface — global prefix, CORS, validation,
 * Swagger — lives here so that the two ways this API is started cannot drift
 * apart:
 *
 *   - `main.ts` for local development and long-running containers: create the
 *     app, configure it, then `listen()` on a port.
 *   - `vercel.ts` for Vercel: create the app, configure it, then `init()` and
 *     hand requests to the Express instance. There is no port to bind.
 *
 * The duplication this avoids is not theoretical. A global prefix configured in
 * only one of the two paths produces a deployment where every route 404s, and
 * nothing in the build fails — the first symptom is a request-level mystery.
 */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Where the Swagger UI is mounted.
 *
 * `/docs` is the documented path and stays first. The second entry exists
 * because the API's real routes sit under `/api`, so it is also reachable as
 * `/api/docs`.
 *
 * Vercel exposes a serverless function at the `/api/*` prefix (see
 * `api/[...path].js`), and `/docs` only reaches it through the rewrites in
 * `vercel.json`. Whether that rewrite presents the function with the original
 * path or the rewritten one is a detail of the platform rather than of this
 * app, so both shapes are mounted and the UI resolves either way. Mounting
 * Swagger twice is idempotent — `SwaggerModule.setup` registers its own routes
 * and static assets under the path it is given, and the two paths do not
 * overlap.
 */
export const SWAGGER_PATHS = ['docs', 'api/docs'] as const;

/**
 * OpenAPI document definition.
 *
 * Split out of {@link configureApp} only so the tags are named in one place:
 * this list is the API's own documentation of its surface, and it is read far
 * more often than it is written.
 */
export function buildOpenApiConfig(): ReturnType<DocumentBuilder['build']> {
  return new DocumentBuilder()
    .setTitle('BRAICE API')
    .setDescription('Community Governance Permission Infrastructure')
    .setVersion('0.1.0')
    .addTag('Auth', 'Email + password sign-in, and optional Solana wallet linking')
    .addTag('Users', 'Read-only user directory (no self-assigned roles)')
    .addTag('Communities', 'Community CRUD and governance config')
    .addTag('Memberships', 'Self-service join and leave; operator-only removal')
    .addTag(
      'Activity',
      'Individual activity ingestion (operator only). There is no route that ' +
      'returns an individual record; only a count.',
    )
    .addTag('Access Requests', 'Permission proposals awaiting governance')
    .addTag('Datasets', 'Community-level aggregates. Governed reads.')
    .addTag('AI', 'Permission-checked analysis of community intelligence')
    .addTag('Audit', 'Decision trail, read by operators and grantees')
    .build();
}

/**
 * Apply every HTTP-level setting the API relies on.
 *
 * Takes an app and returns the same app so a caller can chain
 * `NestFactory.create(...).then(configureApp)` without a second statement.
 * Mutating in place rather than rebuilding is what guarantees the local and
 * serverless paths are identical: there is only one implementation to call.
 */
export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix('api');

  app.enableCors({
    origin: [
      'https://braice.iamchaymusicgroup.com',
      'https://dev.d3hz3f8qwa1rpe.amplifyapp.com',
      'http://localhost:3000',
    ],
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const document = SwaggerModule.createDocument(app, buildOpenApiConfig());

  for (const path of SWAGGER_PATHS) {
    SwaggerModule.setup(path, app, document);
  }

  return app;
}