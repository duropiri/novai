import { Module } from '@nestjs/common';
import { FacesController } from './faces.controller';
import { FacesService } from './faces.service';
import { FaceEmbeddingService } from '../../services/face-embedding.service';
import { Face3DService } from '../../services/face-3d.service';
import { FalService } from '../../services/fal.service';
import { FilesModule } from '../files/files.module';

@Module({
  imports: [FilesModule],
  controllers: [FacesController],
  providers: [
    FacesService,
    FaceEmbeddingService,
    Face3DService,
    FalService,
  ],
  exports: [FacesService, FaceEmbeddingService, Face3DService],
})
export class FacesModule {}
