import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from './modules/users/users.module';
import { CommunitiesModule } from './modules/communities/communities.module';
import { MembershipsModule } from './modules/memberships/memberships.module';
import { ActivityModule } from './modules/activity/activity.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
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
  ],
})
export class AppModule {}
