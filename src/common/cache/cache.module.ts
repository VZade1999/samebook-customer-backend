import { Controller, Get, Global, Module, Req, Res, UseGuards } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Request, Response } from 'express';
import { CacheBumpInterceptor } from './invalidates-cache';
import { AuthGuard } from '../../middlewares/auth.guard';
import { CacheService } from './cache.service';

/** Cache health for admins: enabled? hit/miss counters of this server instance. */
@UseGuards(AuthGuard)
@Controller('cache')
export class CacheController {
  constructor(private readonly cache: CacheService) {}

  @Get('/status')
  status(@Req() req: Request, @Res() res: Response) {
    const roles: string[] = (req as any).user?.roles || [];
    if (!roles.includes('SUPER_ADMIN') && !roles.includes('ADMIN')) {
      return res.status(403).send({ success: false, message: 'Admins only' });
    }
    return res.status(200).send({ success: true, message: 'Cache status', data: this.cache.status() });
  }
}

@Global()
@Module({
  controllers: [CacheController],
  providers: [CacheService, { provide: APP_INTERCEPTOR, useClass: CacheBumpInterceptor }],
  exports: [CacheService],
})
export class CacheModule {}
