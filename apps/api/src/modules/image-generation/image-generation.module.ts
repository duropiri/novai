import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ImageGenerationController } from './image-generation.controller';
import { ImageGenerationService } from './image-generation.service';
import { FilesModule } from '../files/files.module';
import { JobsModule, QUEUES } from '../jobs/jobs.module';

@Module({
  imports: [
    FilesModule,
    JobsModule,
    BullModule.registerQueue({ name: QUEUES.IMAGE_GENERATION }),
  ],
  controllers: [ImageGenerationController],
  providers: [ImageGenerationService],
  exports: [ImageGenerationService],
})
export class ImageGenerationModule {}
