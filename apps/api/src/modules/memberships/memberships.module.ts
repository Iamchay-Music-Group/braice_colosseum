import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Membership } from './entities/membership.entity';
import { MembershipsService } from './memberships.service';
import { MembershipsController } from './memberships.controller';
import { Community } from '../communities/entities/community.entity';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';

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
    // Role changes are the one privilege edit that had no trail. AuditModule
    // imports only TypeOrmModule entities and AuthModule, so this direction
    // stays clear of the CommunitiesModule cycle above.
    AuditModule,
  ],
  controllers: [MembershipsController],
  providers: [MembershipsService],
  exports: [MembershipsService],
})
export class MembershipsModule {}
