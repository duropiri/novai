import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { VariantsController } from './variants.controller';
import { VariantsService } from './variants.service';
import { FilesModule } from '../files/files.module';
import { JobsModule, QUEUES } from '../jobs/jobs.module';

@Module({
  imports: [
    FilesModule,
    JobsModule,
    BullModule.registerQueue({ name: QUEUES.VARIANT }),
  ],
  controllers: [VariantsController],
  providers: [VariantsService],
  exports: [VariantsService],
})
export class VariantsModule {}
