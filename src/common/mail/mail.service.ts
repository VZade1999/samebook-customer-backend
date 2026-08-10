import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { AppLogger } from '../logger/logger.service';

interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly appLogger: AppLogger,
  ) {}

  private getTransporter(): nodemailer.Transporter | null {
    if (this.transporter) return this.transporter;

    const host = this.config.get<string>('SMTP_HOST');
    const port = Number(this.config.get<string>('SMTP_PORT') || 587);
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');

    if (!host || !user || !pass) {
      return null;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
    return this.transporter;
  }

  async sendMail(input: SendMailInput): Promise<boolean> {
    const log = this.appLogger.forContext('MailService', 'sendMail', { to: input.to });
    const transporter = this.getTransporter();

    if (!transporter) {
      log.warn('SMTP not configured (SMTP_HOST/SMTP_USER/SMTP_PASS missing) — skipping send');
      return false;
    }

    const from = this.config.get<string>('SMTP_USER');

    try {
      await transporter.sendMail({
        from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });
      log.info('Email sent successfully');
      return true;
    } catch (err) {
      log.error('Failed to send email', err);
      return false;
    }
  }
}
