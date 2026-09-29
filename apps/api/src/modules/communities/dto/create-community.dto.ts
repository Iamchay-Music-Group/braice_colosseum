import { IsString, IsOptional, IsObject, IsNumber } from 'class-validator';
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

  /**
   * The operator is deliberately NOT a field here.
   *
   * It used to be, and `forbidNonWhitelisted` made it required — so creating a
   * community meant naming its operator, and any caller could name anyone and
   * then act as that community's operator: approve access requests, mint
   * permissions, revoke them. The operator is now taken from the verified JWT
   * in the controller, which is the only identity a server can trust.
   *
   * Declaring it absent is what makes `POST /communities` with an `operatorId`
   * a 400 rather than a silently-ignored field, so a client still sending it
   * finds out instead of quietly creating a community owned by the wrong
   * account.
   */

  @ApiProperty({
    description: 'Governance configuration',
    example: { approvalMode: 'CREATOR_AND_THRESHOLD', thresholdPercentage: 60 },
  })
  @IsObject()
  governanceConfig!: GovernanceConfigDto;
}
