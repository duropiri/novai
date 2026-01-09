import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SwapController } from './swap.controller';
import { SwapService } from './swap.service';
import { FilesModule } from '../files/files.module';
import { JobsModule, QUEUES } from '../jobs/jobs.module';

@Module({
  imports: [
    FilesModule,
    JobsModule,
    BullModule.registerQueue({ name: QUEUES.FACE_SWAP }),
  ],
  controllers: [SwapController],
  providers: [SwapService],
  exports: [SwapService],
})
export class SwapModule {}
