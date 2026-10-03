import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

/**
 * The body of POST /access-requests/:id/governance/approve.
 *
 * This is the set of members whose approval is being recorded, and it is the
 * input to the tally — so it needs to be a validated array of user ids rather
 * than an untyped `@Body('approvedBy')` array. Those parameter decorators read
 * the key straight off the raw body, which means the global ValidationPipe has
 * no DTO to inspect and `forbidNonWhitelisted` never runs: nothing about the
 * shape was checked, and `uniqueApprovers.length` counted whatever arrived.
 *
 * Every id is still only a claim about a member. The service checks that each
 * one is an active member of this community before counting it.
 */
export class RecordDecisionDto {
  @ApiProperty({
    type: [String],
    example: ['b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'],
    description:
      'User ids of the members whose approval is being recorded. Each must be ' +
      'an ACTIVE member of the community the request belongs to; unknown or ' +
      'inactive ids are rejected rather than counted.',
  })
  @IsArray()
  @ArrayMaxSize(5000, {
    message: 'approvedBy may contain at most 5000 user ids',
  })
  @IsUUID(undefined, { each: true })
  approvedBy!: string[];
}
