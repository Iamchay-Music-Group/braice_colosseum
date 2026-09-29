import { IsString, IsNotEmpty, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RequestNonceDto {
  @ApiProperty({
    example: 'CLyvX5XNEo6kPhxT2bTQMwb1PbYLw7tveMeVwdHJSW34',
    description: 'Base58-encoded Solana wallet address (32-byte public key)',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^[1-9A-HJ-NP-Za-km-z]+$/, {
    message: 'walletAddress must be base58-encoded (no 0, O, I, or l)',
  })
  walletAddress!: string;
}
