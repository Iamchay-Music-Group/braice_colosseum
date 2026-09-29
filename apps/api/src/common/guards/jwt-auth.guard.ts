import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { AuthService, JwtPayload } from '../../modules/auth/auth.service';
import type { Request } from 'express';

export interface AuthenticatedRequest extends Request {
  principal?: JwtPayload;
}

/**
 * Extracts the verified principal from a Bearer token.
 *
 * The principal is attached to the request and is the ONLY trusted source of
 * caller identity. Route handlers must read identity from @CurrentPrincipal()
 * and never from a request body field — a client-supplied principalId would
 * let any caller ask on behalf of anyone else.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException(
        'Missing Authorization header (expected: Bearer <token>)',
      );
    }

    request.principal = await this.authService.validateToken(token);
    return true;
  }

  private extractToken(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header) return null;

    const [scheme, value] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !value) return null;

    return value.trim();
  }
}

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): JwtPayload => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.principal) {
      throw new UnauthorizedException('No authenticated principal on request');
    }
    return request.principal;
  },
);
