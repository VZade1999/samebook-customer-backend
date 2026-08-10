import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AppLogger } from '../common/logger/logger.service';
import { verifyAccessToken } from '../auth/jwt.util';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly appLogger: AppLogger) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const log = this.appLogger.forContext('AuthGuard', 'canActivate', {
      ip: request.ip ?? request.socket?.remoteAddress ?? 'unknown',
    });

    const token = request.cookies?.accessToken;
    if (!token) {
      log.warn('Rejected — access token missing');
      throw new UnauthorizedException('Access token missing');
    }

    try {
      const decoded = verifyAccessToken(token);
      request.user = {
        user_id: decoded.userId,
        company_id: decoded.companyId,
        email: decoded.email,
        permissions: decoded.permissions || [],
        roles: decoded.roles || [],
      };
      return true;
    } catch (error) {
      log.warn('Rejected — invalid or expired token');
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
