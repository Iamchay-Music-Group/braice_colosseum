import { IsUUID, IsOptional, IsString } from 'class-validator';

export class JoinCommunityDto {
  @IsOptional()
  @IsUUID()
  userId?: string;
}

export class MembershipResponseDto {
  id!: string;
  communityId!: string;
  userId!: string;
  role!: string;
  status!: string;
  joinedAt!: Date;
}
