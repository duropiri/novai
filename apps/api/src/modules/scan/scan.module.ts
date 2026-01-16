import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ScanController } from './scan.controller';
import { ScanService } from './scan.service';
import { ScanGateway } from './scan.gateway';
import { FilesModule } from '../files/files.module';
import { FFmpegService } from '../../services/ffmpeg.service';

@Module({
  imports: [
    FilesModule,
    BullModule.registerQueue(
      { name: 'scan-video' },
      { name: 'lora-training' },
      { name: 'character-diagram' },
      { name: 'reference-kit' },
      { name: 'expression-board' },
    ),
  ],
  controllers: [ScanController],
  providers: [ScanService, ScanGateway, FFmpegService],
  exports: [ScanService],
})
export class ScanModule {}
