import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

const ACCESS_TOKEN_SECRET = 'access-secret';

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
       console.log('Headers:', request.headers)
    console.log('Authorization:', request.headers.authorization)
    console.log('Cookies:', request.headers.cookie)
    const token = request.cookies?.accessToken;

    if (!token) {
      throw new UnauthorizedException('Access token missing');
    }
console.log("ACCESS_TOKEN_SECRET",ACCESS_TOKEN_SECRET)
    try {
      const decoded: any = jwt.verify(token, ACCESS_TOKEN_SECRET);
      console.log('Decoded token:', decoded);
      request.user = {
        user_id: decoded.userId,
        company_id: decoded.companyId,
        email: decoded.email,
        permissions: decoded.permissions || [],
        roles: decoded.roles || [],
      };

      return true;
    } catch (error) {
      console.error('AuthGuard error:', error);
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
