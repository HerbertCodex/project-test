import { Module } from '@nestjs/common';
import { CirculationModule } from './adapters/http/circulation/circulation.module.js';
import { AppController } from './adapters/app.controller.js';
import { AppService } from './application/app.service.js';

@Module({
  imports: [CirculationModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
