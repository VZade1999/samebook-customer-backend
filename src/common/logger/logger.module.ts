import { Global, Module } from '@nestjs/common';
import { AppLogger } from './logger.service';

@Global() // ← makes AppLogger available everywhere without re-importing the module
@Module({
  providers: [AppLogger],
  exports: [AppLogger],
})
export class LoggerModule {}
