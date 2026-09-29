import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionEngine } from '@braice/permission-engine';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Permission } from './entities/permission.entity';
import { CommunityDataset } from '../datasets/entities/community-dataset.entity';
import { Community } from '../communities/entities/community.entity';
import { User } from '../users/entities/user.entity';
import { PermissionsService } from './permissions.service';
import { PermissionsController } from './permissions.controller';
import { HashService } from '../blockchain/hash.service';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { AuthModule } from '../auth/auth.module';

/**
 * THE MOST IMPORTANT MODULE.
 *
 * Every protected request routes through PermissionsService.checkAccess().
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Permission, CommunityDataset, Community, User]),
    BlockchainModule,
    // AuthModule exports JwtAuthGuard, which guards every permission route.
    AuthModule,
  ],
  controllers: [PermissionsController],
  providers: [
    PermissionsService,
    HashService,
    { provide: PermissionEngine, useClass: PermissionEngine },
    JwtAuthGuard,
  ],
  exports: [PermissionsService, HashService, PermissionEngine, JwtAuthGuard],
})
export class PermissionsModule {}
