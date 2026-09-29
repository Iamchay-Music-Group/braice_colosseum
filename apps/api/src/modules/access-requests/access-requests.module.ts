import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessRequest } from './entities/access-request.entity';
import { AccessRequestsService } from './access-requests.service';
import { AccessRequestsController } from './access-requests.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AccessRequest])],
  controllers: [AccessRequestsController],
  providers: [AccessRequestsService],
  exports: [AccessRequestsService],
})
export class AccessRequestsModule {}
