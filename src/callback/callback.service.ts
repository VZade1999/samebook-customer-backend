import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { callback_requests } from '../models/callback_requests';
import { AppLogger } from '../common/logger/logger.service';
import { MailService } from '../common/mail/mail.service';
import { CallbackRequestDto } from './dto/callback-request.dto';

@Injectable()
export class CallbackService {
  private readonly CallbackRequests: typeof callback_requests;

  constructor(
    @Inject('DATABASE_CONNECTION') private dbProvider: any,
    private readonly appLogger: AppLogger,
    private readonly mailService: MailService,
    private readonly config: ConfigService,
  ) {
    this.CallbackRequests = this.dbProvider.db.callback_requests;
  }

  async submit(dto: CallbackRequestDto) {
    const log = this.appLogger.forContext('CallbackService', 'submit', {
      name: dto.name,
    });

    if (!dto.phone && !dto.email) {
      log.warn('Rejected — neither phone nor email provided');
      return { success: false, message: 'Please provide a phone number or email address' };
    }

    let record: any;
    try {
      record = await this.CallbackRequests.create({
        name: dto.name,
        company_name: dto.company_name || null,
        phone: dto.phone || null,
        email: dto.email || null,
        message: dto.message || null,
      });
    } catch (err) {
      log.error('DB error while saving callback request', err);
      throw new Error('DATABASE_ERROR');
    }

    const notifyEmail = this.config.get<string>('CALLBACK_NOTIFY_EMAIL');
    let emailSent = false;
    if (notifyEmail) {
      const lines = [
        `New callback request from SameBook`,
        ``,
        `Name: ${dto.name}`,
        dto.company_name ? `Company: ${dto.company_name}` : null,
        dto.phone ? `Phone: ${dto.phone}` : null,
        dto.email ? `Email: ${dto.email}` : null,
        dto.message ? `Message: ${dto.message}` : null,
      ].filter(Boolean);

      emailSent = await this.mailService.sendMail({
        to: notifyEmail,
        subject: `New callback request — ${dto.name}`,
        text: lines.join('\n'),
      });

      if (emailSent) {
        try {
          await record.update({ email_sent: true });
        } catch (err) {
          log.warn('Failed to update email_sent flag (non-critical)', err);
        }
      }
    } else {
      log.warn('CALLBACK_NOTIFY_EMAIL not set — notification email skipped');
    }

    log.enrich({ requestId: record.id }).info('Callback request saved', { emailSent });

    return {
      success: true,
      message: "Thanks! We'll get back to you shortly.",
      data: { id: record.id },
    };
  }
}
