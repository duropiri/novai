import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { JobsModule } from './modules/jobs/jobs.module';
import { FilesModule } from './modules/files/files.module';
import { LoraModule } from './modules/lora/lora.module';
import { CharacterModule } from './modules/character/character.module';
import { CollectionsModule } from './modules/collections/collections.module';
import { VideosModule } from './modules/videos/videos.module';
import { SwapModule } from './modules/swap/swap.module';
import { ImageGenerationModule } from './modules/image-generation/image-generation.module';
import { AudioModule } from './modules/audio/audio.module';
import { HooksModule } from './modules/hooks/hooks.module';
import { VariantsModule } from './modules/variants/variants.module';
import { StatsModule } from './modules/stats/stats.module';
import { SettingsModule } from './modules/settings/settings.module';
import { ImageCollectionsModule } from './modules/image-collections/image-collections.module';
import { ReferenceKitModule } from './modules/reference-kit/reference-kit.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get('REDIS_HOST', 'localhost'),
          port: configService.get('REDIS_PORT', 6379),
          password: configService.get('REDIS_PASSWORD'),
        },
      }),
      inject: [ConfigService],
    }),
    JobsModule,
    FilesModule,
    LoraModule,
    CharacterModule,
    CollectionsModule,
    VideosModule,
    SwapModule,
    ImageGenerationModule,
    AudioModule,
    HooksModule,
    VariantsModule,
    StatsModule,
    SettingsModule,
    ImageCollectionsModule,
    ReferenceKitModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
