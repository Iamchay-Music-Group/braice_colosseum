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
    .addTag('Memberships', 'Community membership management')
    .addTag('Activity', 'Individual activity ingestion (internal only)')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`BRAICE API running on http://localhost:${port}/api`);
  console.log(`Swagger docs at http://localhost:${port}/docs`);
}

bootstrap();
