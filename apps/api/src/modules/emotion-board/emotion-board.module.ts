import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EmotionBoardController } from './emotion-board.controller';
import { EmotionBoardService } from './emotion-board.service';
import { FilesModule } from '../files/files.module';
import { QUEUES } from '../jobs/queues.constants';

@Module({
  imports: [
    BullModule.registerQueue({
      name: QUEUES.EMOTION_BOARD,
    }),
    FilesModule,
  ],
  controllers: [EmotionBoardController],
  providers: [EmotionBoardService],
  exports: [EmotionBoardService],
})
export class EmotionBoardModule {}
