import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { LoraController } from './lora.controller';
import { LoraService } from './lora.service';
import { FalService } from '../../services/fal.service';
import { FilesModule } from '../files/files.module';
import { JobsModule } from '../jobs/jobs.module';
import { QUEUES } from '../jobs/queues.constants';
import { DatasetAnalysisService } from '../../services/dataset-analysis.service';
import { TrainingOptimizerService } from '../../services/training-optimizer.service';
import { IdentityAnalysisService } from '../../services/identity-analysis.service';
import { GeminiService } from '../../services/gemini.service';
// HiRA (High Rank Adaptation) face identity services
import { FaceEmbeddingService } from '../../services/face-embedding.service';
import { Face3DService } from '../../services/face-3d.service';

@Module({
  imports: [
    FilesModule,
    JobsModule,
    BullModule.registerQueue({ name: QUEUES.LORA_TRAINING }),
  ],
  controllers: [LoraController],
  providers: [
    LoraService,
    FalService,
    DatasetAnalysisService,
    TrainingOptimizerService,
    IdentityAnalysisService,
    GeminiService,
    // HiRA face services
    FaceEmbeddingService,
    Face3DService,
  ],
  exports: [LoraService, FalService],
})
export class LoraModule {}
