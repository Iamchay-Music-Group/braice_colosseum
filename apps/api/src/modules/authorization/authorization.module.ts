import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommunityDataset } from '../datasets/entities/community-dataset.entity';
import { AuthorizationService } from './authorization.service';
import { AuthorizationController } from './authorization.controller';
import { PermissionsModule } from '../permissions/permissions.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from './guards/permission.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([CommunityDataset]),
    PermissionsModule,
    AuditModule,
    // AuthModule exports AuthService, which JwtAuthGuard depends on to
    // validate bearer tokens. Without this import the guard cannot resolve
    // its constructor dependency at boot.
    AuthModule,
  ],
  controllers: [AuthorizationController],
  providers: [AuthorizationService, JwtAuthGuard, PermissionGuard],
  exports: [AuthorizationService, PermissionGuard, JwtAuthGuard],
})
export class AuthorizationModule {}
