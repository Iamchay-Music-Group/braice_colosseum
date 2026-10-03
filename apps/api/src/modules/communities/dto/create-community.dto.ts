import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApprovalMode } from '../../governance/entities/governance-decision.entity';

export class GovernanceConfigDto {
  @ApiProperty({
    enum: ApprovalMode,
    example: ApprovalMode.CREATOR_AND_THRESHOLD,
    description:
      'Who has to agree. CREATOR_ONLY is the operator alone, ' +
      'CREATOR_AND_THRESHOLD is the operator plus a majority of active ' +
      'members, THRESHOLD_ONLY is active members alone.',
  })
  @IsEnum(ApprovalMode, {
    message: `approvalMode must be one of: ${Object.values(ApprovalMode).join(', ')}`,
  })
  approvalMode!: ApprovalMode;

  @ApiProperty({
    example: 60,
    description:
      'Percentage of ACTIVE members whose approval carries a threshold vote. ' +
      'Ignored under CREATOR_ONLY. Derived against live membership at decision ' +
      'time, so it moves as people join and leave.',
  })
  @IsInt()
  @Min(1)
  @Max(100)
  thresholdPercentage!: number;
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
    type: GovernanceConfigDto,
  })
  /**
   * `@ValidateNested` plus `@Type` rather than `@IsObject`.
   *
   * `@IsObject` alone checks that governanceConfig is an object and stops
   * there: with nothing transforming it into a `GovernanceConfigDto`, the pipe
   * has no class to check the nested fields against, so both were stored exactly
   * as sent. That is how a `thresholdPercentage` of `"60"` or a misspelt
   * `approvalMode` reached the database — and a misspelt mode is the dangerous
   * one, because `applyRules` falls through to CREATOR_AND_THRESHOLD for an
   * unrecognised value. A community that asked for CREATOR_ONLY and typed it
   * slightly wrong would silently have run the strictest mode instead, and the
   * community would never see the difference.
   *
   * `@IsObject` is kept alongside it because the two answer different
   * questions: it rejects the property being absent altogether, which
   * `@ValidateNested` alone does not, while the nested decorators decide
   * whether what is present is usable.
   */
  @IsObject()
  @ValidateNested()
  @Type(() => GovernanceConfigDto)
  governanceConfig!: GovernanceConfigDto;
}