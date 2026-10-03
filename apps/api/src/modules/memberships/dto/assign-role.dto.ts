import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { MembershipRole } from '../entities/membership-role.enum';

/**
 * Assign a role to an existing member.
 *
 * A class rather than `@Body('role')`, because a bare field read gives the
 * global ValidationPipe nothing to reflect over: `whitelist` and
 * `forbidNonWhitelisted` have nothing to apply, so the value would reach the
 * service unvalidated and land in the database. The same reason the governance
 * bodies were converted.
 *
 * There is no `userId` here. The target is the route parameter and the caller is
 * the token, so a body cannot name a different account for either.
 */
export class AssignRoleDto {
  @ApiProperty({
    enum: MembershipRole,
    example: MembershipRole.MODERATOR,
    description:
      'Target role. OPERATOR is a transfer: the caller gives up the seat, so a ' +
      'community never ends up with two operators or none.',
  })
  @IsEnum(MembershipRole, {
    message: `role must be one of ${Object.values(MembershipRole).join(', ')}`,
  })
  role!: MembershipRole;
}