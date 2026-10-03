import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNotEmpty, IsString, IsUUID, Max, Min } from 'class-validator';
import { Operation } from '../../../common/interfaces/permission.interface';

/**
 * The body of POST /api/access-requests.
 *
 * This was an inline object literal on the controller, which the global
 * ValidationPipe cannot inspect: with no class to reflect over, `whitelist` and
 * `forbidNonWhitelisted` have nothing to apply and every field went through
 * unchecked. It matters here more than on most routes, because this body is the
 * start of a permission grant — a malformed duration or a misspelled operation
 * would be stored verbatim and only fail much later, when governance tries to
 * turn the request into an enforceable policy.
 *
 * There is deliberately no `requesterId`. The requester is the authenticated
 * caller; naming someone else here is the impersonation vector this DTO's
 * absence closes, and it is why `forbidNonWhitelisted` matters: a client still
 * sending `requesterId` gets a 400 rather than a silently ignored field.
 */
export class CreateAccessRequestDto {
  @ApiProperty({
    example: '44444444-4444-4444-8444-444444444444',
    description: 'Community whose data is being requested',
  })
  @IsUUID()
  communityId!: string;

  @ApiProperty({
    example: '55555555-5555-4555-8555-555555555555',
    description: 'Dataset within that community the request is for',
  })
  @IsUUID()
  datasetId!: string;

  @ApiProperty({
    example: 'campaign_planning',
    description:
      'Stated purpose. Free text rather than an enum because the engine ' +
      'matches it exactly against a permission purpose — narrowing the set ' +
      'here would reject a legitimate request the engine would have honoured.',
  })
  @IsString()
  @IsNotEmpty()
  purpose!: string;

  @ApiProperty({
    enum: Operation,
    example: Operation.ANALYZE,
    description: 'Operation being requested',
  })
  @IsEnum(Operation)
  operation!: Operation;

  @ApiProperty({
    example: 2592000,
    description:
      'Requested lifetime in seconds (2592000 = 30 days). Bounded to a year ' +
      'because this is the window a permission would be issued for, and an ' +
      'unbounded request would let a caller ask for a grant that outlives any ' +
      'review the community is likely to do.',
  })
  @IsInt()
  @Min(60)
  @Max(31_536_000)
  requestedDurationSeconds!: number;
}