import { Module } from '@nestjs/common';
import { ImageCollectionsController } from './image-collections.controller';
import { ImageCollectionsService } from './image-collections.service';
import { FilesModule } from '../files/files.module';

@Module({
  imports: [FilesModule],
  controllers: [ImageCollectionsController],
  providers: [ImageCollectionsService],
  exports: [ImageCollectionsService],
})
export class ImageCollectionsModule {}
