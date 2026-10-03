import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { PermissionsService } from './permissions.service';
import { Permission } from './entities/permission.entity';
import { JwtAuthGuard, CurrentPrincipal } from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/auth.service';

@ApiTags('Permissions')
@Controller('permissions')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  @ApiOperation({ summary: 'List all permissions' })
  @ApiResponse({ status: 200, description: 'Permission list' })
  findAll(): Promise<Permission[]> {
    return this.permissionsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get permission details' })
  @ApiParam({ name: 'id', description: 'Permission UUID' })
  @ApiResponse({ status: 200, description: 'Permission found' })
  @ApiResponse({ status: 404, description: 'Permission not found' })
  findById(@Param('id') id: string): Promise<Permission> {
    return this.permissionsService.findById(id);
  }

  @Post(':id/revoke')
  @ApiOperation({
    summary: 'Revoke a permission',
    description:
      "Creator/operator only. Enforcement is server-side: the caller's " +
      'verified identity is compared against the operator of the community ' +
      'that owns the resource.',
  })
  @ApiParam({ name: 'id', description: 'Permission UUID' })
  @ApiResponse({ status: 201, description: 'Permission revoked' })
  @ApiResponse({ status: 403, description: 'Caller is not the operator' })
  @ApiResponse({ status: 404, description: 'Permission not found' })
  revoke(
    @Param('id') id: string,
    @CurrentPrincipal() principal: JwtPayload,
  ): Promise<Permission> {
    return this.permissionsService.revoke(id, principal.sub);
  }
}
