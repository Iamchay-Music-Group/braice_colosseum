import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AiService } from './ai.service';
import { AiQueryDto } from './dto/ai-query.dto';
import { AiResponseDto } from './dto/ai-response.dto';
import {
  CurrentPrincipal,
  JwtAuthGuard,
} from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/auth.service';

@ApiTags('ai')
@ApiBearerAuth()
// Per-controller, matching every other protected route. There is no global
// guard, so omitting this would publish the AI endpoint to anonymous callers
// and only the permission check would stand between them and a denial.
@UseGuards(JwtAuthGuard)
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  /**
   * POST /api/ai/query
   *
   * The only AI entry point. It is authenticated, and the principal comes from
   * the verified JWT — the body carries no identity field, so a caller cannot
   * ask on someone else's behalf.
   *
   * Always 200, including when the permission engine denies. A refusal is a
   * successful, structured outcome carrying the real policy reason; conflating
   * it with a transport error would tell an operator that the policy had
   * failed rather than that it had worked.
   */
  @Post('query')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ask a question about a community',
    description:
      'Answers only from data the caller\'s active permission authorizes for ' +
      'the declared purpose. Returns `denied: true` with a `denialReason` ' +
      'when the permission engine refuses. Check `answerSource` to ' +
      'distinguish a model-written answer from one computed from the ' +
      'aggregate when no model is configured.',
  })
  @ApiOkResponse({ type: AiResponseDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  async query(
    @CurrentPrincipal() principal: JwtPayload,
    @Body() dto: AiQueryDto,
  ): Promise<AiResponseDto> {
    return this.aiService.query(principal.sub, dto);
  }
}
