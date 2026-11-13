import { Body, Controller, Get, Headers, Param, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import * as crypto from 'crypto';
import { Request, Response } from 'express';
import { AppLogger } from '../../common/logger/logger.service';
import { CrmSourcesService } from './crm-sources.service';

const THANK_YOU = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Thank you</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f6f7fb;color:#0b1324}
.c{max-width:420px;margin:24px;padding:32px 28px;border-radius:18px;background:#fff;box-shadow:0 20px 50px -30px rgba(15,23,42,.45);text-align:center}
.i{width:56px;height:56px;margin:0 auto 14px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#e7f7ee;color:#0a8a3a;font-size:28px}
h1{font-size:21px;margin:0 0 8px}p{margin:0;color:#5b6474;line-height:1.55}</style></head>
<body><div class="c"><div class="i">✓</div><h1>Thank you!</h1><p>We've received your enquiry and will get back to you shortly.</p></div></body></html>`;

/**
 * Public endpoints of the CRM — no login:
 *  - POST /crm/intake/:token  leads from IndiaMART push, website forms, Zapier…
 *    The secret token in the URL identifies the company's lead source.
 *  - GET  /crm/cron/sync      the scheduled IndiaMART pull (Vercel Cron, CRON_SECRET).
 */
@Controller('crm')
export class CrmPublicController {
  constructor(
    private readonly sources: CrmSourcesService,
    private readonly appLogger: AppLogger,
  ) {}

  @Get('/intake/:token')
  async status(@Param('token') token: string, @Res() res: Response) {
    try {
      const r = await this.sources.intakeStatus(token);
      return res.status(r.success ? 200 : (r as any).status).json({ success: r.success, message: r.message });
    } catch (err) {
      this.appLogger.forContext('CrmPublicController', 'status', {}).error('Intake status failed', err);
      return res.status(500).json({ success: false, message: 'Something went wrong' });
    }
  }

  @Post('/intake/:token')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async receive(@Param('token') token: string, @Body() body: any, @Req() req: Request, @Res() res: Response) {
    const browserForm =
      !!req.is('application/x-www-form-urlencoded') && String(req.headers.accept || '').includes('text/html');
    try {
      const r: any = await this.sources.intake(token, body && typeof body === 'object' ? body : {});
      if (!r.success) return res.status(r.status || 400).json({ success: false, message: r.message });
      if (browserForm) {
        if (r.data?.redirect_url) return res.redirect(303, r.data.redirect_url);
        return res.status(200).type('html').send(THANK_YOU);
      }
      return res.status(200).json({
        success: true,
        message: r.message,
        data: { lead: r.data?.lead ?? null, status: r.data?.status, received: r.data?.received ?? 1 },
      });
    } catch (err) {
      this.appLogger.forContext('CrmPublicController', 'receive', {}).error('Lead intake failed', err);
      return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.' });
    }
  }

  @Get('/cron/sync')
  async cron(@Headers('authorization') auth: string | undefined, @Res() res: Response) {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      return res.status(503).json({ success: false, message: 'Scheduled sync is not set up (CRON_SECRET is missing)' });
    }
    const expected = Buffer.from(`Bearer ${secret}`);
    const given = Buffer.from(String(auth || ''));
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    try {
      const data = await this.sources.cronSync();
      return res.status(200).json({ success: true, message: 'Sync finished', data: { ran: data.ran, due: data.due, created: data.created } });
    } catch (err) {
      this.appLogger.forContext('CrmPublicController', 'cron', {}).error('Scheduled sync failed', err);
      return res.status(500).json({ success: false, message: 'Something went wrong' });
    }
  }
}
