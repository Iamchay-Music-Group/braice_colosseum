import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { BlockchainService } from '../modules/blockchain/blockchain.service';
import { AiService } from '../modules/ai/ai.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly blockchainService: BlockchainService,
    private readonly aiService: AiService,
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
    //
    // The LLM is optional for the same reason, and its absence is reported as
    // `disabled` rather than folded into the status — permission enforcement is
    // the product and is entirely independent of whether a model is reachable.
    // `deterministic` is spelled out so an operator can tell "no key" from
    // "key present, model unreachable", which is the difference between a
    // deployment mistake and an expected degraded mode.
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      dependencies: {
        database,
        blockchain: this.blockchainService.isEnabled() ? 'enabled' : 'disabled',
        // Reported as 'deterministic' rather than 'disabled': the endpoint is
        // live and answering, it is just not calling a model. Collapsing the
        // two would read as a broken deployment rather than a supported mode.
        ai: this.aiService.isEnabled() ? 'enabled' : 'deterministic',
      },
    };
  }
}
