import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { resolve } from 'path';
import { loadAuthConfig, validateAuthConfig } from './config/configuration';
import { loadAiConfig, validateAiConfig } from './config/ai.config';
import { UsersModule } from './modules/users/users.module';
import { CommunitiesModule } from './modules/communities/communities.module';
import { MembershipsModule } from './modules/memberships/memberships.module';
import { ActivityModule } from './modules/activity/activity.module';
import { AuthModule } from './modules/auth/auth.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { AuthorizationModule } from './modules/authorization/authorization.module';
import { AuditModule } from './modules/audit/audit.module';
import { BlockchainModule } from './modules/blockchain/blockchain.module';
import { DatasetsModule } from './modules/datasets/datasets.module';
import { AccessRequestsModule } from './modules/access-requests/access-requests.module';
import { GovernanceModule } from './modules/governance/governance.module';
import { AiModule } from './modules/ai/ai.module';
import { HealthController } from './common/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Resolve the repo-root .env explicitly instead of relying on the default
      // `process.cwd()` lookup.
      //
      // With the default, `npm run dev` from apps/api loaded apps/api/.env while
      // `pnpm db:migrate` read the repo-root .env — two files disagreeing about
      // DATABASE_URL, so migrations were applied to one database and the API
      // served another. That is what produced "column password_hash does not
      // exist" at runtime even though migration 003 had just succeeded.
      //
      // The repo-root file is authoritative and wins; the others are fallbacks
      // for layouts that have no root .env. Paths are resolved against this
      // file's location, so behaviour no longer depends on the launch directory.
      envFilePath: [
        resolve(__dirname, '../../../../.env'),
        resolve(process.cwd(), '.env'),
        resolve(process.cwd(), '../../.env'),
      ],
      // Fail fast on a missing or weak JWT signing key, rather than booting
      // and minting tokens anyone can forge. This runs before any provider is
      // constructed, so a misconfigured deployment never serves a request.
      //
      // The raw env is returned unchanged: services read it with config.get(),
      // and validateAuthConfig only inspects it.
      validate: (raw: Record<string, unknown>) => {
        const get = (key: string) => {
          const value = raw[key];
          return value === undefined ? undefined : String(value);
        };

        validateAuthConfig(loadAuthConfig(get));

        // A blank AI_API_KEY is legal — the AI module answers deterministically
        // and reports answerSource:'deterministic'. An unrecognised
        // AI_PROVIDER is not: it would silently send the key nowhere useful
        // and read as "the AI is broken" rather than "the env var is wrong".
        validateAiConfig(loadAiConfig(get));

        return raw;
      },
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.get('DATABASE_URL', 'postgresql://braice:braice_secret@localhost:5433/braice_db'),
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    UsersModule,
    CommunitiesModule,
    MembershipsModule,
    ActivityModule,
    AuthModule,
    AuditModule,
    BlockchainModule,
    PermissionsModule,
    AuthorizationModule,
    DatasetsModule,
    AccessRequestsModule,
    GovernanceModule,
    AiModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}

