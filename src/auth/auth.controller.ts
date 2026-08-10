import {
  Controller,
  Post,
  UsePipes,
  ValidationPipe,
  Req,
  Res,
  Body,
  Get,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';

import { AppLogger } from '../common/logger/logger.service';
import { errorRes, failedRes, successRes } from 'src/Util/response.util';
import { getCookieOptions } from './cookie.util';
import { AuthDto } from './dto/auth.dto';
import { RegisterDto } from './dto/register.dto';

const USER_SAFE_MESSAGES: Record<string, string> = {
  DATABASE_ERROR: 'Service temporarily unavailable. Please try again.',
  AUTH_INTERNAL_ERROR: 'Authentication failed. Please try again.',
  TOKEN_GENERATION_ERROR: 'Login could not be completed. Please try again.',
};

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly appLogger: AppLogger,
  ) {}

  @Get('/health-check')
  @UsePipes(ValidationPipe)
  async healthCheck(@Req() req: Request, @Res() res: Response) {
    try {
      return successRes(res, 'Health Check success', {});
    } catch (error) {
      return errorRes(res, error);
    }
  }

  @Post('/login')
  @Throttle({ default: { limit: 15, ttl: 60000 } })
  @UsePipes(ValidationPipe)
  async login(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: AuthDto,
  ) {
    const log = this.appLogger.forContext('AuthController', 'login', {
      email: body.username,
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
    });

    log.info('Request received');
    try {
      const { username, password } = body;
      const response = await this.authService.login(username, password);
      if (!response.success) {
        log.warn(`Auth rejected — ${response.message}`);
        return failedRes(res, response.message, 401);
      }
      res.cookie('accessToken', response.data?.accessToken, getCookieOptions('access'));
      res.cookie('refreshToken', response.data?.refreshToken, getCookieOptions('refresh'));
      log.info('Response sent successfully');
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in login', error);
      return errorRes(res, error);
    }
  }

  @Post('/register')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @UsePipes(ValidationPipe)
  async register(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: RegisterDto,
  ) {
    const log = this.appLogger.forContext('AuthController', 'register', {
      email: body.email,
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
    });

    log.info('Request received');

    try {
      const { first_name, last_name, email, phone, password } = body;
      const response = await this.authService.register(
        first_name,
        last_name,
        email,
        phone,
        password,
      );

      if (!response.success) {
        log.warn(`Registration rejected — ${response.message}`);
        return failedRes(res, response.message);
      }

      log.info('Registration response sent successfully');
      return successRes(res, response.message, response.data);
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : String(error);
      const userMessage =
        USER_SAFE_MESSAGES[errMessage] ?? 'An unexpected error occurred.';

      log.error('Unhandled error in register', error);
      return errorRes(res, userMessage);
    }
  }

  @Post('/refresh')
  async refresh(@Req() req: Request, @Res() res: Response) {
    const log = this.appLogger.forContext('AuthController', 'refresh', {
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
    });

    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      log.warn('Refresh rejected — cookie missing');
      return failedRes(res, 'Refresh token missing', 401);
    }

    try {
      const response = await this.authService.refresh(refreshToken);
      if (!response.success) {
        log.warn(`Refresh rejected — ${response.message}`);
        res.clearCookie('accessToken', getCookieOptions('access'));
        res.clearCookie('refreshToken', getCookieOptions('refresh'));
        return failedRes(res, response.message, 401);
      }
      res.cookie('accessToken', response.data?.accessToken, getCookieOptions('access'));
      res.cookie('refreshToken', response.data?.refreshToken, getCookieOptions('refresh'));
      log.info('Refresh successful');
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in refresh', error);
      return errorRes(res, error);
    }
  }

  @Post('/logout')
  async logout(@Req() req: Request, @Res() res: Response) {
    const log = this.appLogger.forContext('AuthController', 'logout', {
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
    });

    log.info('Logout request received');

    try {
      const response = await this.authService.logout(req.cookies?.refreshToken);

      if (!response.success) {
        log.warn(`Logout failed — ${response.message}`);
        return failedRes(res, response.message);
      }

      res.clearCookie('accessToken', getCookieOptions('access'));
      res.clearCookie('refreshToken', getCookieOptions('refresh'));

      log.info('Logout successful');

      return successRes(res, response.message, null);
    } catch (error) {
      log.error('Unhandled error in logout', error);

      return errorRes(res, error);
    }
  }
}
