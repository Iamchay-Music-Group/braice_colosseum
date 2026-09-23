import { IsString, IsOptional, IsObject, IsNumber, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GovernanceConfigDto {
  @ApiProperty({ example: 'CREATOR_AND_THRESHOLD', description: 'Governance approval mode' })
  @IsString()
  approvalMode!: string;

  @ApiProperty({ example: 60, description: 'Community approval threshold percentage' })
  @IsNumber()
  thresholdPercentage!: number;

  [key: string]: unknown;
}

export class CreateCommunityDto {
  @ApiProperty({ example: 'Afrobeat Creators', description: 'Community name' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ example: 'The largest afrobeat creator community' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'UUID of the creator/operator user' })
  @IsUUID()
  operatorId!: string;

  @ApiProperty({
    description: 'Governance configuration',
    example: { approvalMode: 'CREATOR_AND_THRESHOLD', thresholdPercentage: 60 },
  })
  @IsObject()
  governanceConfig!: GovernanceConfigDto;
}
