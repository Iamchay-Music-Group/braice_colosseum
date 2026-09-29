import { IsString, IsNotEmpty, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Operation } from '../../../common/interfaces/permission.interface';

/**
 * Authorization request.
 *
 * NOTE: there is deliberately no `principalId` and no `requestsIndividualData`
 * field.
 *
 * The principal comes from the caller's verified JWT (@CurrentPrincipal), so a
 * caller can only ever ask on its own behalf — supplying someone else's id
 * would be an impersonation vector.
 *
 * Whether individual data is reachable is decided by the engine from the
 * resource's own aggregation level, never by a caller-supplied flag, which a
 * malicious client would simply set to false.
 */
export class AuthorizeRequestDto {
  @ApiProperty({
    example: '44444444-4444-4444-8444-444444444444',
    description: 'Community dataset UUID being requested',
  })
  @IsString()
  @IsNotEmpty()
  resourceId!: string;

  @ApiProperty({
    example: 'campaign_planning',
    description: 'Stated purpose; must match the permission purpose exactly',
  })
  @IsString()
  @IsNotEmpty()
  purpose!: string;

  @ApiProperty({
    enum: Operation,
    example: Operation.ANALYZE,
    description: 'Requested operation; must match the permission operation',
  })
  @IsEnum(Operation)
  operation!: Operation;
}
