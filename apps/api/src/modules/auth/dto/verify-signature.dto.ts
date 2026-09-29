import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Wallet sign-in payload. Only reachable when WALLET_AUTH_ENABLED is set.
 *
 * There is no displayName here. It used to name a user that this endpoint
 * created on first sign-in; accounts are now created by POST /auth/register
 * with an email and password, so a client has no reason to name an account
 * here and no way to rename one.
 */
export class VerifySignatureDto {
  @ApiProperty({
    description: 'The nonce previously issued by POST /api/auth/nonce',
  })
  @IsString()
  @IsNotEmpty()
  nonce!: string;

  @ApiProperty({
    description: 'Base58 wallet address that produced the signature',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  walletAddress!: string;

  @ApiProperty({
    description: 'Base58-encoded ed25519 signature over the nonce message',
  })
  @IsString()
  @IsNotEmpty()
  signature!: string;
}
