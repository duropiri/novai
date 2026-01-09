import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Google Gemini API types
export interface GeminiGenerateContentRequest {
  contents: Array<{
    role?: 'user' | 'model';
    parts: Array<
      | { text: string }
      | { inline_data: { mime_type: string; data: string } }
      | { file_data: { mime_type: string; file_uri: string } }
    >;
  }>;
  generationConfig?: {
    responseModalities?: string[];
    temperature?: number;
    topK?: number;
    topP?: number;
    maxOutputTokens?: number;
  };
}

export interface GeminiGenerateContentResponse {
  candidates: Array<{
    content: {
      parts: Array<
        | { text: string }
        | { inlineData: { mimeType: string; data: string } }
      >;
      role: string;
    };
    finishReason: string;
    safetyRatings?: Array<{
      category: string;
      probability: string;
    }>;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

export interface CharacterDiagramResult {
  imageBase64: string;
  mimeType: string;
}

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  private readonly model = 'gemini-2.0-flash-exp'; // Image generation model (requires paid tier for reliable access)

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('GOOGLE_GEMINI_API_KEY') || '';
    if (!this.apiKey) {
      this.logger.warn('GOOGLE_GEMINI_API_KEY not configured. Gemini operations will fail.');
    }
  }

  // The character diagram prompt from PROJECT_PLAN.md
  private readonly CHARACTER_DIAGRAM_PROMPT = `Using the attached image as the sole visual reference, create a character reference sheet rendered entirely in a realistic photographic style.
The final output must be one single image containing two photographic views side-by-side on a clean, neutral background.

1. Full-Body Photograph (CRITICAL)
- Generate true full-length standing photograph, fully visible head to toe
- NO cropping allowed
- Leave clear padding above head and below feet
- If reference is cropped, reconstruct conservatively
- If holding phone/object, remove it completely

2. Facial Close-Up
- High-resolution photorealistic facial close-up
- Match features, expression, skin texture, lighting exactly

Clothing Requirements (ABSOLUTE):
- Use EXACT outfit from reference image
- Never change, rotate, enhance, or stylize clothing
- Preserve garment type, fit, fabric, colors, patterns, layering

Footwear Rules:
- Feet and shoes must be visible
- If unclear, use plain neutral shoes matching outfit
- No exaggerated proportions or AI-invented designs`;

  /**
   * Generate a character diagram from a source image
   * Uses Gemini's image generation capabilities
   */
  async generateCharacterDiagram(sourceImageUrl: string): Promise<CharacterDiagramResult> {
    this.logger.log('Generating character diagram with Gemini');

    // Download the source image and convert to base64
    const imageData = await this.downloadImageAsBase64(sourceImageUrl);

    const request: GeminiGenerateContentRequest = {
      contents: [
        {
          parts: [
            { text: this.CHARACTER_DIAGRAM_PROMPT },
            {
              inline_data: {
                mime_type: imageData.mimeType,
                data: imageData.base64,
              },
            },
          ],
        },
      ],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        temperature: 0.7,
      },
    };

    const response = await this.generateContent(request);

    // Extract the generated image from the response
    const imagePart = response.candidates[0]?.content?.parts?.find(
      (part): part is { inlineData: { mimeType: string; data: string } } =>
        'inlineData' in part,
    );

    if (!imagePart) {
      throw new Error('No image generated in Gemini response');
    }

    this.logger.log('Character diagram generated successfully');

    return {
      imageBase64: imagePart.inlineData.data,
      mimeType: imagePart.inlineData.mimeType,
    };
  }

  /**
   * Call the Gemini generateContent API
   */
  private async generateContent(
    request: GeminiGenerateContentRequest,
  ): Promise<GeminiGenerateContentResponse> {
    const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${error}`);
    }

    return response.json();
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
