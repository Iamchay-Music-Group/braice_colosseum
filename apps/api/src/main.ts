import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');

  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = new DocumentBuilder()
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

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT || 3001;
  // Bind explicitly rather than letting the server default. In a container the
  // interface has to be reachable from outside the network namespace the ECS
  // task runs in, and saying so is clearer than relying on the Node default.
  await app.listen(port, '0.0.0.0');
  console.log(`BRAICE API running on http://localhost:${port}/api`);
  console.log(`Swagger docs at http://localhost:${port}/docs`);
}

bootstrap();
