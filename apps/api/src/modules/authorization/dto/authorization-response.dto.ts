import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DenialReason, AggregationLevel } from '@braice/permission-engine';

export class AuthorizationResponseDto {
  @ApiProperty({ example: true, description: 'Whether access is granted' })
  allowed!: boolean;

  @ApiPropertyOptional({
    enum: DenialReason,
    example: DenialReason.PERMISSION_REVOKED,
    description: 'Why access was denied (absent when allowed)',
  })
  reason?: DenialReason;

  @ApiPropertyOptional({
    description: 'The permission that produced the decision',
  })
  permissionId?: string;

  @ApiPropertyOptional({ description: 'Owning community of the resource' })
  communityId?: string;

  @ApiPropertyOptional({
    enum: AggregationLevel,
    example: AggregationLevel.COMMUNITY,
    description:
      'Server-derived data boundary. Always COMMUNITY for dataset resources, ' +
      'which is why individual member data is unreachable through this path.',
  })
  aggregationLevel?: AggregationLevel;
}
