import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Community } from './entities/community.entity';
// Registered here so CommunitiesService can enrol the operator in the same
// transaction as the community row. MembershipsModule is imported for the roster
// routes on the controller, not for this repository.
import { Membership } from '../memberships/entities/membership.entity';
import { CommunitiesService } from './communities.service';
import { CommunitiesController } from './communities.controller';
import { MembershipsModule } from '../memberships/memberships.module';
import { AuthModule } from '../auth/auth.module';
// For the post-commit initialize_community anchor. Not for anything on the
// authorization path, and it is not required for the module to boot.
import { BlockchainModule } from '../blockchain/blockchain.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Community, Membership]),
    MembershipsModule,
    // AuthModule exports JwtAuthGuard, which guards the controller.
    AuthModule,
    BlockchainModule,
  ],
  controllers: [CommunitiesController],
  providers: [CommunitiesService],
  exports: [CommunitiesService],
})
export class CommunitiesModule {}
