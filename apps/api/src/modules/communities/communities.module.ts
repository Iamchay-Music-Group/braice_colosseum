import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Community } from './entities/community.entity';
import { CommunitiesService } from './communities.service';
import { CommunitiesController } from './communities.controller';
import { MembershipsModule } from '../memberships/memberships.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Community]),
    MembershipsModule,
    // AuthModule exports JwtAuthGuard, which guards the controller.
    AuthModule,
  ],
  controllers: [CommunitiesController],
  providers: [CommunitiesService],
  exports: [CommunitiesService],
})
export class CommunitiesModule {}
