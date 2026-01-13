import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ReferenceKitController } from './reference-kit.controller';
import { ReferenceKitService } from './reference-kit.service';
import { FilesModule } from '../files/files.module';
import { JobsModule } from '../jobs/jobs.module';
import { QUEUES } from '../jobs/queues.constants';

@Module({
  imports: [
    FilesModule,
    JobsModule,
    BullModule.registerQueue({ name: QUEUES.REFERENCE_KIT }),
  ],
  controllers: [ReferenceKitController],
  providers: [ReferenceKitService],
  exports: [ReferenceKitService],
})
export class ReferenceKitModule {}
