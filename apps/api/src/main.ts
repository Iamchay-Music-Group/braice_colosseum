import { NestFactory } from '@nestjs/core';
import { configureApp } from './app.setup';
import { AppModule } from './app.module';

async function bootstrap() {
  // configureApp applies the global prefix, CORS, validation and Swagger — the
  // same set the Vercel entry point applies (see app.setup.ts).
  const app = configureApp(await NestFactory.create(AppModule));

  const port = process.env.PORT || 3001;
  // Bind explicitly rather than letting the server default. In a container the
  // interface has to be reachable from outside the network namespace the ECS
  // task runs in, and saying so is clearer than relying on the Node default.
  await app.listen(port, '0.0.0.0');
  console.log(`BRAICE API running on http://localhost:${port}/api`);
  console.log(`Swagger docs at http://localhost:${port}/docs`);
}

bootstrap();