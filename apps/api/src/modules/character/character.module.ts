import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CharacterController } from './character.controller';
import { CharacterService } from './character.service';
import { FilesModule } from '../files/files.module';
import { JobsModule } from '../jobs/jobs.module';
import { QUEUES } from '../jobs/queues.constants';

@Module({
  imports: [
    FilesModule,
    JobsModule,
    BullModule.registerQueue({ name: QUEUES.CHARACTER_DIAGRAM }),
  ],
  controllers: [CharacterController],
  providers: [CharacterService],
  exports: [CharacterService],
})
export class CharacterModule {}
