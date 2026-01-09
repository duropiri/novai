import { Module } from '@nestjs/common';
import { HooksController } from './hooks.controller';
import { HooksService } from './hooks.service';
import { FilesModule } from '../files/files.module';

@Module({
  imports: [FilesModule],
  controllers: [HooksController],
  providers: [HooksService],
  exports: [HooksService],
})
export class HooksModule {}
