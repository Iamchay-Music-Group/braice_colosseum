import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthNonce } from './entities/auth-nonce.entity';
import { AuthService } from './auth.service';
import { NonceService } from './nonce.service';
import { SignatureService } from './signature.service';
import { PasswordService } from './password.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuthNonce]),
    UsersModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { algorithm: 'HS256' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    NonceService,
    SignatureService,
    PasswordService,
    JwtAuthGuard,
  ],
  exports: [AuthService, NonceService, SignatureService, PasswordService, JwtAuthGuard],
})
export class AuthModule {}
