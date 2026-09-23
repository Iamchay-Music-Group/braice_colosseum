import { IsString, IsOptional, IsObject, IsNumber, IsUUID } from 'class-validator';

export class GovernanceConfigDto {
  @IsString()
  approvalMode!: string;

  @IsNumber()
  thresholdPercentage!: number;

  [key: string]: unknown;
}

export class CreateCommunityDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsUUID()
  operatorId!: string;

  @IsObject()
  governanceConfig!: GovernanceConfigDto;
}
