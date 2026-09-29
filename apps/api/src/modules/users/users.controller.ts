import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { UsersService } from './users.service';

/**
 * Read-only user directory.
 *
 * There is deliberately no POST here. The endpoint that used to sit at
 * `POST /api/users` was unauthenticated and accepted an arbitrary `userType`,
 * which let anyone self-register as a CREATOR simply by posting one. Account
 * creation now happens at `POST /api/auth/register` (email + password, always
 * MEMBER, no role field on the request).
 *
 * These lookups are unauthenticated because governance flows need to resolve a
 * member to a user id before a token exists. They expose only the public
 * profile columns — `password_hash` is `select: false` at the entity level, so
 * the digest is never loaded here even if this controller returned raw rows.
 */
@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({
    summary: 'List all users',
    description: 'Get all users ordered by creation date (newest first)',
  })
  @ApiResponse({ status: 200, description: 'List of users' })
  findAll() {
    return this.usersService.findAll();
  }

  @Get('wallet/:address')
  @ApiOperation({
    summary: 'Get user by wallet address',
    description:
      'Look up a user by the Solana wallet linked to their account. The ' +
      'wallet is an on-chain anchoring attribute, not a credential.',
  })
  @ApiParam({ name: 'address', description: 'Solana wallet address' })
  @ApiResponse({ status: 200, description: 'User found' })
  @ApiResponse({ status: 404, description: 'User not found' })
  findByWallet(@Param('address') address: string) {
    return this.usersService.findByWallet(address);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user by ID' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'User found' })
  @ApiResponse({ status: 404, description: 'User not found' })
  findById(@Param('id') id: string) {
    return this.usersService.findById(id);
  }
}
