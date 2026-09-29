import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AggregationLevel, DenialReason } from '@braice/permission-engine';

/**
 * The response contract for POST /api/ai/query.
 *
 * `answerSource` is the field that keeps this honest. A caller must always be
 * able to tell a model-written answer from one composed arithmetically from
 * the aggregate, because "the AI said" and "the numbers say" are different
 * claims and only one of them is true on a deployment with no API key.
 */
export class AiResponseDto {
  @ApiProperty({
    example:
      'Streetwear is the strongest interest at 42% of 1000 aggregated records.',
    description:
      'The answer. When denied, this states the refusal and the policy reason.',
  })
  answer!: string;

  @ApiProperty({
    enum: ['llm', 'deterministic'],
    example: 'llm',
    description:
      'How the answer was produced. "llm" means a configured model wrote it. ' +
      '"deterministic" means it was computed from the authorized dataset ' +
      'because no model is configured.',
  })
  answerSource!: 'llm' | 'deterministic';

  @ApiProperty({
    example: false,
    description: 'True when the permission engine refused the data access',
  })
  denied!: boolean;

  @ApiPropertyOptional({
    enum: DenialReason,
    example: DenialReason.INDIVIDUAL_DATA_RESTRICTED,
    description: 'Why access was denied. Absent when allowed.',
  })
  denialReason?: DenialReason;

  @ApiPropertyOptional({
    description: 'The permission that produced the decision',
  })
  permissionId?: string;

  @ApiPropertyOptional({
    description: 'The dataset the answer was derived from',
  })
  resourceId?: string;

  @ApiPropertyOptional({
    enum: AggregationLevel,
    example: AggregationLevel.COMMUNITY,
    description: 'Server-derived data boundary. Never the caller\'s choice.',
  })
  aggregationLevel?: AggregationLevel;
}
