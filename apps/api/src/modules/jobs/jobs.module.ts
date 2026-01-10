import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { LoraProcessor } from './processors/lora.processor';
import { CharacterProcessor } from './processors/character.processor';
import { FaceSwapProcessor } from './processors/face-swap.processor';
import { ImageGenerationProcessor } from './processors/image-generation.processor';
import { VariantProcessor } from './processors/variant.processor';
import { FilesModule } from '../files/files.module';
import { FalService } from '../../services/fal.service';
import { GeminiService } from '../../services/gemini.service';
import { PicsiService } from '../../services/picsi.service';
import { QUEUES } from './queues.constants';

export { QUEUES } from './queues.constants';

@Module({
  imports: [
    FilesModule,
    BullModule.registerQueue(
      { name: QUEUES.LORA_TRAINING },
      { name: QUEUES.CHARACTER_DIAGRAM },
      { name: QUEUES.FACE_SWAP },
      { name: QUEUES.IMAGE_GENERATION },
      { name: QUEUES.VARIANT },
    ),
  ],
  controllers: [JobsController],
  providers: [
    JobsService,
    FalService,
    GeminiService,
    PicsiService,
    LoraProcessor,
    CharacterProcessor,
    FaceSwapProcessor,
    ImageGenerationProcessor,
    VariantProcessor,
  ],
  exports: [JobsService],
})
export class JobsModule {}
