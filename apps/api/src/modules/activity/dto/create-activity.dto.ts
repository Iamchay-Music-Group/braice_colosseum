import { IsUUID, IsString, IsOptional, IsDateString, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateActivityDto {
  @ApiProperty({ description: 'UUID of the member generating activity' })
  @IsUUID()
  memberId!: string;

  @ApiProperty({ example: 'clicked', description: 'Type of activity (clicked, viewed, purchased)' })
  @IsString()
  activityType!: string;

  @ApiProperty({ example: 'streetwear', description: 'Interest category (streetwear, music, sneakers, beauty)' })
  @IsString()
  interestCategory!: string;

  @ApiPropertyOptional({ description: 'Additional context metadata' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiProperty({ example: '2026-09-23T12:00:00Z', description: 'ISO 8601 timestamp of when activity occurred' })
  @IsDateString()
  occurredAt!: string;
}
