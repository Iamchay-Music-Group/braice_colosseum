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
      envFilePath: [
        resolve(__dirname, '../../../../.env'),
        resolve(process.cwd(), '.env'),
        resolve(process.cwd(), '../../.env'),
      ],
      validate: (raw: Record<string, unknown>) => {
        const get = (key: string) => {
          const value = raw[key];
          return value === undefined ? undefined : String(value);
        };

        validateAuthConfig(loadAuthConfig(get));
        validateAiConfig(loadAiConfig(get));

        return raw;
      },
    }),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.get(
          'DATABASE_URL',
          'postgresql://braice:braice_secret@localhost:5433/braice_db',
        ),
        ssl: {
          rejectUnauthorized: false,
        },
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
export class AppModule { }

