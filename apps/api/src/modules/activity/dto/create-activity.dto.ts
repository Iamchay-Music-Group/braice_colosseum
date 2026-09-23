import { IsUUID, IsString, IsOptional, IsDateString, IsObject } from 'class-validator';

export class CreateActivityDto {
  @IsUUID()
  memberId!: string;

  @IsString()
  activityType!: string;

  @IsString()
  interestCategory!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsDateString()
  occurredAt!: string;
}
