import { IsString, IsOptional, IsEnum, IsEmail } from 'class-validator';

export enum CreateUserType {
  CREATOR = 'CREATOR',
  MEMBER = 'MEMBER',
  BRAND = 'BRAND',
  APPLICATION = 'APPLICATION',
}

export class CreateUserDto {
  @IsString()
  displayName!: string;

  @IsOptional()
  @IsString()
  walletAddress?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsEnum(CreateUserType)
  userType!: CreateUserType;
}
