import { IsString, IsOptional, IsEnum, IsEmail } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum CreateUserType {
  CREATOR = 'CREATOR',
  MEMBER = 'MEMBER',
  BRAND = 'BRAND',
  APPLICATION = 'APPLICATION',
}

export class CreateUserDto {
  @ApiProperty({ example: 'Afrobeat King', description: 'Display name of the user' })
  @IsString()
  displayName!: string;

  @ApiPropertyOptional({ example: 'wallet_abc123', description: 'Solana wallet address' })
  @IsOptional()
  @IsString()
  walletAddress?: string;

  @ApiPropertyOptional({ example: 'user@example.com', description: 'Email address' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ enum: CreateUserType, example: CreateUserType.CREATOR, description: 'User type' })
  @IsEnum(CreateUserType)
  userType!: CreateUserType;
}
