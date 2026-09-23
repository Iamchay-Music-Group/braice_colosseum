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
        type: 'postgres',
        host: config.get('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.get('DB_USERNAME', 'braice'),
        password: config.get('DB_PASSWORD', 'braice_secret'),
        database: config.get('DB_NAME', 'braice_db'),
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
