import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/**
 * The body of POST /access-requests/:id/governance/permissions.
 *
 * `principalId` is the one field a caller is allowed to name someone else, and
 * it is a grant rather than an impersonation: the decision that authorises it
 * is recorded separately and belongs to the community. What is not allowed is
 * supplying it without being the operator, which is enforced in the service.
 *
 * A UUID rather than an untyped string so a typo is a 400 at the pipe instead
 * of a permission row pointing at nothing.
 */
export class IssuePermissionDto {
  @ApiProperty({
    example: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
    description:
      'The principal the permission is granted to — the application that will ' +
      'exercise it, not the brand that requested access.',
  })
  @IsUUID()
  principalId!: string;
}
