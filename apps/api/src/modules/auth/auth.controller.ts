import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RequestNonceDto } from './dto/request-nonce.dto';
import { VerifySignatureDto } from './dto/verify-signature.dto';
import {
  ChangePasswordDto,
  LinkWalletDto,
  LoginDto,
  RegisterDto,
} from './dto/account.dto';
import {
  CurrentPrincipal,
  JwtAuthGuard,
} from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from './auth.service';

/**
 * Account authentication is email + password. The Solana endpoints here are
 * NOT sign-in: `/wallet/*` is a proof-of-ownership flow used to attach an
 * on-chain grantee pubkey to an account, and `/nonce` + `/verify` are an
 * optional second credential that is off unless WALLET_AUTH_ENABLED is set.
 */
@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({
    summary: 'Create an account',
    description:
      'Registers an email + password and returns a short-lived access token. ' +
      'Every new account is a MEMBER: no request field can assign a role, ' +
      'and no wallet is required.',
  })
  @ApiResponse({ status: 201, description: 'Account created, token returned' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Sign in with email and password',
    description:
      'Verifies the password and returns a short-lived access token. ' +
      'Every failure returns the same message, and repeated failures lock the ' +
      'account temporarily.',
  })
  @ApiResponse({ status: 200, description: 'Authenticated, token returned' })
  @ApiResponse({ status: 401, description: 'Invalid email or password' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('password')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Change your password',
    description:
      'Rotates the password on the authenticated account. The current ' +
      'password is required even though the caller holds a valid token.',
  })
  @ApiResponse({ status: 200, description: 'Password changed' })
  @ApiResponse({ status: 401, description: 'Missing token, or wrong current password' })
  changePassword(
    @CurrentPrincipal() principal: JwtPayload,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService
      .changePassword(principal.sub, dto.currentPassword, dto.newPassword)
      .then(() => ({ changed: true }));
  }

  // --- Solana: wallet ownership, not authentication --------------------------

  @Post('wallet/challenge')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Request a challenge proving control of a wallet',
    description:
      'Returns a single-use nonce and the exact message to sign. Signing it ' +
      'proves the caller holds the private key; it does not sign anybody in. ' +
      'The resulting proof is what lets a permission be anchored on-chain to ' +
      'this wallet.',
  })
  @ApiResponse({ status: 200, description: 'Challenge issued' })
  @ApiResponse({ status: 400, description: 'Invalid Solana public key' })
  @ApiResponse({ status: 401, description: 'Missing or invalid token' })
  requestWalletChallenge(@Body() dto: RequestNonceDto) {
    return this.authService.requestWalletChallenge(dto.walletAddress);
  }

  @Post('wallet/link')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Attach a Solana wallet to your account',
    description:
      'Verifies the signature over a challenge and stores the wallet on the ' +
      'authenticated account. The account comes from the bearer token and ' +
      'cannot be overridden in the body. Linking a wallet grants no role and ' +
      'no permission.',
  })
  @ApiResponse({ status: 200, description: 'Wallet linked' })
  @ApiResponse({ status: 401, description: 'Bad signature, unknown nonce, or expired nonce' })
  @ApiResponse({ status: 409, description: 'Wallet already linked to another account' })
  linkWallet(
    @CurrentPrincipal() principal: JwtPayload,
    @Body() dto: LinkWalletDto,
  ) {
    return this.authService.linkWallet(principal.sub, dto);
  }

  // --- Optional wallet sign-in -----------------------------------------------

  @Post('nonce')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Request a sign-in nonce (wallet auth, opt-in)',
    description:
      'Only available when WALLET_AUTH_ENABLED is set. Returns a single-use ' +
      'nonce and the message to sign with signMessage (ed25519).',
  })
  @ApiResponse({ status: 200, description: 'Nonce issued' })
  @ApiResponse({ status: 400, description: 'Invalid Solana public key' })
  @ApiResponse({ status: 403, description: 'Wallet sign-in is disabled' })
  requestNonce(@Body() dto: RequestNonceDto) {
    return this.authService.requestNonce(dto.walletAddress);
  }

  @Post('verify')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Exchange a signed nonce for a JWT (wallet auth, opt-in)',
    description:
      'Verifies the ed25519 signature, burns the nonce, and returns a ' +
      'short-lived access token. The wallet must already be linked to an ' +
      'account — this endpoint cannot create one.',
  })
  // 200, not 201: nothing is created. The 201 was a leftover from when this
  // endpoint minted a user on first contact, and a client retrying after a
  // dropped response would be told it had created something when it had not.
  @ApiResponse({ status: 200, description: 'Authenticated, token returned' })
  @ApiResponse({ status: 401, description: 'Bad signature, unknown nonce, replay, or unlinked wallet' })
  @ApiResponse({ status: 403, description: 'Wallet sign-in is disabled' })
  verify(@Body() dto: VerifySignatureDto) {
    return this.authService.verifySignature(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Return the authenticated principal',
    description:
      'Identity as it currently stands. The account claims (email, userType) are ' +
      'read from the database rather than echoed from the token, so a role ' +
      'granted after sign-in — governance promoting MEMBER to BRAND, say — is ' +
      'visible immediately instead of at the next login. Token claims (sub, ' +
      'amr, jti, exp) are returned as issued. Call this rather than decoding ' +
      'the token client-side.',
  })
  @ApiResponse({ status: 200, description: 'Current principal' })
  @ApiResponse({ status: 401, description: 'Missing or invalid token' })
  @ApiResponse({ status: 404, description: 'Token is valid but the account is gone' })
  me(@CurrentPrincipal() principal: JwtPayload) {
    return this.authService.currentPrincipal(principal);
  }
}
