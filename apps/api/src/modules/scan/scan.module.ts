import { Module } from '@nestjs/common';
import { ScanController } from './scan.controller';
import { ScanService } from './scan.service';
import { ScanGateway } from './scan.gateway';
import { FilesModule } from '../files/files.module';

@Module({
  imports: [FilesModule],
  controllers: [ScanController],
  providers: [ScanService, ScanGateway],
  exports: [ScanService],
})
export class ScanModule {}
