import { Module } from '@nestjs/common';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { SupabaseService } from './supabase.service';

@Module({
  controllers: [FilesController],
  providers: [FilesService, SupabaseService],
  exports: [FilesService, SupabaseService],
})
export class FilesModule {}
