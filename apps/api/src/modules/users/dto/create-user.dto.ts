import { ApiProperty } from '@nestjs/swagger';

/**
 * Account roles.
 *
 * CREATOR, PARTNER and APPLICATION describe a user's relationship to a
 * community; they are assigned by governance or an operator tool, never by the
 * person registering. `POST /api/auth/register` always creates a MEMBER.
 *
 * Note there is no ADMIN here. Administrative capability is a permission in
 * the authorization module, not a role a signup can claim — which is the
 * whole reason the old public `POST /api/users` endpoint (which accepted an
 * arbitrary userType, CREATOR included) was removed.
 */
export enum CreateUserType {
  CREATOR = 'CREATOR',
  MEMBER = 'MEMBER',
  PARTNER = 'PARTNER',
  APPLICATION = 'APPLICATION',
}

export const USER_TYPE_VALUES: readonly CreateUserType[] = [
  CreateUserType.CREATOR,
  CreateUserType.MEMBER,
  CreateUserType.PARTNER,
  CreateUserType.APPLICATION,
];

/** Swagger metadata for the enum, kept alongside it so the two stay in sync. */
export const UserTypeApiProperty = () =>
  ApiProperty({
    enum: USER_TYPE_VALUES,
    example: CreateUserType.MEMBER,
    description: 'Account role, assigned by governance rather than by the user',
  });
