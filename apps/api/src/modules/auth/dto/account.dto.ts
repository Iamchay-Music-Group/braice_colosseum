import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';

/**
 * Email + password registration.
 *
 * There is deliberately no `userType` field. Self-registration creates a
 * MEMBER and nothing else — privilege comes from governance, never from a
 * value the client can post about itself. (The old public POST /api/users
 * accepted an arbitrary userType, which let anyone self-register as CREATOR.)
 */
export class RegisterDto {
  @ApiProperty({ example: 'creator@example.com' })
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254, {
    message: 'email must be at most 254 characters (RFC 5321 limit)',
  })
  email!: string;

  /**
   * Minimum 12 characters. NIST SP 800-63B advises a floor rather than
   * composition rules, so there is deliberately no "must contain a digit"
   * check — those push users toward predictable substitutions like
   * `Password1!`. Length plus a breached-password blocklist is the stronger
   * control; the blocklist is not implemented here and is a known gap.
   */
  @ApiProperty({
    example: 'correct horse battery staple',
    minLength: 12,
    maxLength: 128,
  })
  @IsString()
  @Length(12, 128, {
    message: 'password must be between 12 and 128 characters',
  })
  password!: string;

  @ApiProperty({ example: 'Afrobeat King' })
  @IsString()
  @Length(1, 120, { message: 'displayName must be 1-120 characters' })
  displayName!: string;
}

/**
 * Password sign-in.
 *
 * Validation is deliberately minimal: a malformed email still runs a real
 * scrypt verification in AuthService so the response time does not reveal
 * whether the account exists. Over-validating the shape here would reintroduce
 * the enumeration oracle that decoy hashing exists to close.
 */
export class LoginDto {
  @ApiProperty({ example: 'creator@example.com' })
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'correct horse battery staple' })
  @IsString()
  // Not @Length(): a too-short password is simply wrong, and reporting
  // "too short" on login would tell an attacker the account exists.
  @MaxLength(1024)
  password!: string;
}

/**
 * Rotate a password. Requires the current password even though the caller is
 * already authenticated — it stops a walk-up attacker at an unlocked terminal
 * from locking the owner out.
 */
export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MaxLength(1024)
  currentPassword!: string;

  @ApiProperty({ minLength: 12, maxLength: 128 })
  @IsString()
  @Length(12, 128, {
    message: 'password must be between 12 and 128 characters',
  })
  newPassword!: string;
}

/**
 * Attach a Solana wallet to the signed-in account.
 *
 * The account is taken from the verified JWT, never from this body, so a
 * caller cannot attach a wallet to someone else's account even if they hold a
 * valid access token for their own.
 */
export class LinkWalletDto {
  @ApiProperty({
    description: 'The nonce issued by POST /api/auth/wallet/challenge',
  })
  @IsString()
  @MaxLength(64)
  nonce!: string;

  @ApiProperty({
    example: 'CLyvX5XNEo6kPhxT2bTQMwb1PbYLw7tveMeVwdHJSW34',
    description: 'Base58 wallet address being linked (32-byte public key)',
  })
  @IsString()
  @MaxLength(64)
  @Matches(/^[1-9A-HJ-NP-Za-km-z]+$/, {
    message: 'walletAddress must be base58-encoded (no 0, O, I, or l)',
  })
  walletAddress!: string;

  @ApiProperty({
    description: 'Base58-encoded ed25519 signature over the challenge message',
  })
  @IsString()
  @MaxLength(512)
  signature!: string;
}
