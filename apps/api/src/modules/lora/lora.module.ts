import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { LoraController } from './lora.controller';
import { LoraService } from './lora.service';
import { FalService } from '../../services/fal.service';
import { FilesModule } from '../files/files.module';
import { JobsModule } from '../jobs/jobs.module';
import { QUEUES } from '../jobs/queues.constants';

@Module({
  imports: [
    FilesModule,
    JobsModule,
    BullModule.registerQueue({ name: QUEUES.LORA_TRAINING }),
  ],
  controllers: [LoraController],
  providers: [LoraService, FalService],
  exports: [LoraService, FalService],
})
export class LoraModule {}
