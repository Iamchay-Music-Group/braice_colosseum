import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Membership } from './entities/membership.entity';
import { MembershipsService } from './memberships.service';
import { MembershipsController } from './memberships.controller';
import { Community } from '../communities/entities/community.entity';
import { AuthModule } from '../auth/auth.module';

/**
 * Memberships.
 *
 * Community is registered here for MembershipsService's operator checks, not
 * imported from CommunitiesModule. CommunitiesModule already imports this
 * module for its roster routes, so a back-reference would be a module cycle.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Membership, Community]),
    // AuthModule exports JwtAuthGuard, which guards every membership route.
    AuthModule,
  ],
  controllers: [MembershipsController],
  providers: [MembershipsService],
  exports: [MembershipsService],
})
export class MembershipsModule {}
