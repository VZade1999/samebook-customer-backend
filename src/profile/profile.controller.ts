import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AppLogger } from 'src/common/logger/logger.service';
import { ProfileService, ProfileRequester } from './profile.service';
import { errorRes, failedRes, successRes } from 'src/Util/response.util';
import { UpdateProfileDto } from './dto/updateProfile.dto';
import { AuthGuard } from './../middlewares/auth.guard';

// Self-service only: every route here resolves to the caller's own user row
// (req.user.user_id, set by AuthGuard from the JWT) — there is no viewing or
// editing anyone else's profile here, so no permission gate is needed beyond
// being authenticated.
@UseGuards(AuthGuard)
@Controller('profile')
export class ProfileController {
  constructor(
    private readonly profileService: ProfileService,
    private readonly appLogger: AppLogger,
  ) {}

  @Get('/me')
  async getMyProfile(@Req() req: Request, @Res() res: Response) {
    const log = this.appLogger.forContext('ProfileController', 'getMyProfile', {
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
    });

    log.info('Request received');
    try {
      const response = await this.profileService.getProfile(this.getRequester(req));
      if (!response.success) {
        log.warn(`Profile fetch rejected — ${response.message}`);
        return failedRes(res, response.message);
      }
      log.info('Profile response sent successfully');
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in getMyProfile', error);
      return errorRes(res, error);
    }
  }

  @Post('/update')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async updateMyProfile(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: UpdateProfileDto,
  ) {
    const log = this.appLogger.forContext('ProfileController', 'updateMyProfile', {
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
    });

    log.info('Request received');
    try {
      const response = await this.profileService.updateProfile(body, this.getRequester(req));
      if (!response.success) {
        log.warn(`Profile update rejected — ${response.message}`);
        return failedRes(res, response.message);
      }
      log.info('Profile updated successfully');
      return successRes(res, response.message, response.data);
    } catch (error) {
      log.error('Unhandled error in updateMyProfile', error);
      return errorRes(res, error);
    }
  }

  private getRequester(req: Request): ProfileRequester {
    const user = (req as any).user;
    return { userId: user?.user_id, companyId: user?.company_id };
  }
}
