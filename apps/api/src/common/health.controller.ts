import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { BlockchainService } from '../modules/blockchain/blockchain.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly blockchainService: BlockchainService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Liveness and dependency check' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  @ApiResponse({ status: 503, description: 'A required dependency is down' })
  async check() {
    let database = 'down';

    try {
      await this.dataSource.query('SELECT 1');
      database = 'up';
    } catch {
      database = 'down';
    }

    // The chain is optional by design: BRAICE enforces access correctly
    // without it, so a degraded chain must not make the service unhealthy.
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      dependencies: {
        database,
        blockchain: this.blockchainService.isEnabled() ? 'enabled' : 'disabled',
      },
    };
  }
}
