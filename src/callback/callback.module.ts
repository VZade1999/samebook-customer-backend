import { Module } from '@nestjs/common';
import { CallbackController } from './callback.controller';
import { CallbackService } from './callback.service';
import { MailModule } from '../common/mail/mail.module';

@Module({
  imports: [MailModule],
  controllers: [CallbackController],
  providers: [CallbackService],
})
export class CallbackModule {}
