import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ExpressionBoardController } from './expression-board.controller';
import { ExpressionBoardService } from './expression-board.service';
import { FilesModule } from '../files/files.module';
import { QUEUES } from '../jobs/queues.constants';

@Module({
  imports: [
    BullModule.registerQueue({
      name: QUEUES.EXPRESSION_BOARD,
    }),
    FilesModule,
  ],
  controllers: [ExpressionBoardController],
  providers: [ExpressionBoardService],
  exports: [ExpressionBoardService],
})
export class ExpressionBoardModule {}
