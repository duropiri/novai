import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI, GenerateContentConfig, MediaResolution } from '@google/genai';

export interface CharacterDiagramResult {
  imageBase64: string;
  mimeType: string;
}

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private readonly apiKey: string;
  private ai: GoogleGenAI | null = null;
  private readonly model = 'gemini-3-pro-image-preview'; // Nano Banana Pro

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('GOOGLE_GEMINI_API_KEY') || '';
    if (!this.apiKey) {
      this.logger.warn('GOOGLE_GEMINI_API_KEY not configured. Gemini operations will fail.');
    } else {
      this.ai = new GoogleGenAI({ apiKey: this.apiKey });
    }
  }

  // The character diagram prompt from character diagram prompt.txt
  private readonly CHARACTER_DIAGRAM_PROMPT = `Using the attached image as the sole visual reference, create a character reference sheet rendered entirely in a realistic photographic style.
The final output must be one single image containing two photographic views side-by-side on a clean, neutral background.

1. Full-Body Photograph (CRITICAL)

Generate a true full-length, standing photograph of the person that is fully visible from the top of the head to the bottom of the feet.

NO cropping is allowed.

The entire body must be visible including shoes, feet, and the ground contact point.

Leave clear padding above the head and below the feet so nothing is cut off.

Camera framing must resemble a fashion catalog / modeling reference shot, not a portrait crop.

If the reference image is cropped:

Reconstruct missing body parts conservatively and realistically using the same outfit and proportions.

Do NOT invent new shoes or footwear styles.

If shoes are not visible in the reference, generate neutral, realistic continuation footwear that matches the existing outfit exactly and does not introduce new fashion elements.

If the person is holding a phone or any object:

Remove it completely so the hands appear empty and natural.

2. Facial Close-Up

Next to the full-body view, generate a high-resolution, photorealistic facial close-up.

Match facial features, expression, skin texture, and lighting exactly.

Maintain natural pores, realistic skin detail, and accurate proportions.

Lighting and realism must match the full-body image.

Clothing Requirements (ABSOLUTE RULE)

ALWAYS use the exact outfit from the reference image.

Never change, rotate, enhance, stylize, or replace clothing.

Preserve:

Garment type

Fit and silhouette

Fabric texture

Colors

Patterns

Layering

The outfit must be identical to the reference, with only minimal extension if required to complete cropped areas.

Footwear & Lower Body Rules (FACE-SWAP SAFE)

Feet and shoes must always be visible in the full-body image.

Do NOT fabricate fashionable shoes, heels, or stylistic footwear.

If footwear is unclear, use plain, realistic, neutral shoes that align with the existing outfit.

No exaggerated proportions, floating feet, warped shoes, or AI-invented designs.

Strict Rules

Never generate a new outfit.

Never crop or cut off the body at any point.

Never add accessories or props.

Maintain a neutral, accurate, reference-grade presentation suitable for face-swap and identity consistency pipelines.`;

  /**
   * Generate a character diagram from a source image
   * Uses Gemini's image generation capabilities (Nano Banana Pro)
   */
  async generateCharacterDiagram(sourceImageUrl: string): Promise<CharacterDiagramResult> {
    if (!this.ai) {
      throw new Error('Gemini API not configured');
    }

    this.logger.log('Generating character diagram with Gemini (Nano Banana Pro)');

    // Download the source image and convert to base64
    const imageData = await this.downloadImageAsBase64(sourceImageUrl);

    const config: GenerateContentConfig = {
      responseModalities: ['IMAGE', 'TEXT'],
      mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
      imageConfig: {
        aspectRatio: '5:4',
        imageSize: '1K',
      },
    };

    const contents = [
      {
        role: 'user',
        parts: [
          { text: this.CHARACTER_DIAGRAM_PROMPT },
          {
            inlineData: {
              mimeType: imageData.mimeType,
              data: imageData.base64,
            },
          },
        ],
      },
    ];

    this.logger.log('Calling Gemini API...');

    const response = await this.ai.models.generateContentStream({
      model: this.model,
      config,
      contents,
    });

    // Collect the streamed response
    let imageBase64: string | null = null;
    let imageMimeType: string | null = null;

    for await (const chunk of response) {
      if (!chunk.candidates || !chunk.candidates[0]?.content?.parts) {
        continue;
      }

      const part = chunk.candidates[0].content.parts[0];
      if (part && 'inlineData' in part && part.inlineData) {
        imageBase64 = part.inlineData.data || null;
        imageMimeType = part.inlineData.mimeType || null;
        this.logger.log('Image received from Gemini');
        break;
      } else if (part && 'text' in part) {
        this.logger.debug(`Gemini text response: ${part.text}`);
      }
    }

    if (!imageBase64 || !imageMimeType) {
      throw new Error('No image generated in Gemini response');
    }

    this.logger.log('Character diagram generated successfully');

    return {
      imageBase64,
      mimeType: imageMimeType,
    };
  }

  /**
   * Download an image and convert to base64
   */
  private async downloadImageAsBase64(
    url: string,
  ): Promise<{ base64: string; mimeType: string }> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    return { base64, mimeType: contentType };
  }
}
