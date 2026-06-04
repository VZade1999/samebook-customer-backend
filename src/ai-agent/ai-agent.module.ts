import { Module } from '@nestjs/common';
import { AiAgentController } from './ai-agent.controller';
import { AiAgentService } from './ai-agent.service';
import { AppLogger } from 'src/common/logger/logger.service';
import { CustomerService } from 'src/customers/customers.service';
import { ProductService } from 'src/products/products.service';

@Module({
  controllers: [AiAgentController],
  providers: [AiAgentService, AppLogger, CustomerService, ProductService],
  exports: [AiAgentService],
})
export class AiAgentModule {}
