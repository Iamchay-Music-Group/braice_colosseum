import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthorizationService } from './authorization.service';
import { AuthorizeRequestDto } from './dto/authorize-request.dto';
import { AuthorizationResponseDto } from './dto/authorization-response.dto';
import {
  CurrentPrincipal,
  JwtAuthGuard,
} from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/auth.service';

@ApiTags('Authorization')
@Controller('authorize')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AuthorizationController {
  constructor(private readonly authorizationService: AuthorizationService) {}

  @Post()
  @ApiOperation({
    summary: 'Check whether the caller is authorized',
    description:
      'The principal is taken from the bearer token, not the request body. ' +
      'A denial is a normal 201 response with allowed:false, not an error ' +
      'code, so a client can distinguish "policy said no" from "call failed".',
  })
  @ApiResponse({ status: 201, description: 'Decision returned' })
  @ApiResponse({ status: 401, description: 'Missing or invalid token' })
  authorize(
    @CurrentPrincipal() principal: JwtPayload,
    @Body() dto: AuthorizeRequestDto,
  ): Promise<AuthorizationResponseDto> {
    return this.authorizationService.authorize(principal.sub, dto);
  }
}
