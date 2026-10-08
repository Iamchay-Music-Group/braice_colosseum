import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UserResponseDto {
  @ApiProperty({ example: '1c833ded-06d2-41a0-8543-c31067438d6f' })
  id!: string;

  @ApiPropertyOptional({ example: 'wallet_abc123' })
  walletAddress!: string | null;

  @ApiPropertyOptional({ example: 'user@example.com' })
  email!: string | null;

  @ApiProperty({ example: 'Afrobeat King' })
  displayName!: string;

  @ApiProperty({ example: 'CREATOR', enum: ['CREATOR', 'MEMBER', 'PARTNER', 'APPLICATION', 'ADMIN'] })
  userType!: string;

  @ApiProperty({ example: '2026-09-23T12:00:00.000Z' })
  createdAt!: Date;
}
