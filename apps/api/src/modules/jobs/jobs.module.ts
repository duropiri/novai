import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { LoraProcessor } from './processors/lora.processor';
import { CharacterProcessor } from './processors/character.processor';
import { FaceSwapProcessor } from './processors/face-swap.processor';
import { ImageGenerationProcessor } from './processors/image-generation.processor';
import { VariantProcessor } from './processors/variant.processor';
import { ReferenceKitProcessor } from './processors/reference-kit.processor';
import { EmotionBoardProcessor } from './processors/emotion-board.processor';
import { FilesModule } from '../files/files.module';
import { EmotionBoardModule } from '../emotion-board/emotion-board.module';
import { FalService } from '../../services/fal.service';
import { GeminiService } from '../../services/gemini.service';
import { KlingService } from '../../services/kling.service';
import { PicsiService } from '../../services/picsi.service';
import { LocalAIService } from '../../services/local-ai.service';
import { FFmpegService } from '../../services/ffmpeg.service';
import { IdentityAnalysisService } from '../../services/identity-analysis.service';
import { PromptBuilderService } from '../../services/prompt-builder.service';
import { QUEUES } from './queues.constants';

export { QUEUES } from './queues.constants';

@Module({
  imports: [
    FilesModule,
    EmotionBoardModule,
    BullModule.registerQueue(
      { name: QUEUES.LORA_TRAINING },
      { name: QUEUES.CHARACTER_DIAGRAM },
      { name: QUEUES.FACE_SWAP },
      { name: QUEUES.IMAGE_GENERATION },
      { name: QUEUES.VARIANT },
      { name: QUEUES.REFERENCE_KIT },
      { name: QUEUES.EMOTION_BOARD },
    ),
  ],
  controllers: [JobsController],
  providers: [
    JobsService,
    FalService,
    GeminiService,
    KlingService,
    PicsiService,
    LocalAIService,
    FFmpegService,
    IdentityAnalysisService,
    PromptBuilderService,
    LoraProcessor,
    CharacterProcessor,
    FaceSwapProcessor,
    ImageGenerationProcessor,
    VariantProcessor,
    ReferenceKitProcessor,
    EmotionBoardProcessor,
  ],
  exports: [JobsService],
})
export class JobsModule {}
