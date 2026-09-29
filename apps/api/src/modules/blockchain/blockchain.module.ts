import { Module } from '@nestjs/common';
import { BlockchainService } from './blockchain.service';
import { HashService } from './hash.service';

@Module({
  // HashService is registered here, not just in PermissionsModule: both
  // BlockchainService and PermissionsService inject it, and Nest scopes
  // providers per module. Leaving it out makes the whole app fail to boot with
  // "can't resolve dependencies of the BlockchainService".
  providers: [BlockchainService, HashService],
  exports: [BlockchainService, HashService],
})
export class BlockchainModule {}
