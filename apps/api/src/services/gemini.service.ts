import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Google Gemini API types
export interface GeminiSafetySetting {
  category: string;
  threshold: string;
}

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
  safetySettings?: GeminiSafetySetting[];
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
  private readonly model = 'gemini-3-pro-image-preview'; // Nano Banana Pro - Gemini 3 Pro Image Preview

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('GOOGLE_GEMINI_API_KEY') || '';
    if (!this.apiKey) {
      this.logger.warn('GOOGLE_GEMINI_API_KEY not configured. Gemini operations will fail.');
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
      },
    };

    const response = await this.generateContent(request);

    // Debug logging
    this.logger.debug('Gemini response received', {
      finishReason: response.candidates?.[0]?.finishReason,
      safetyRatings: response.candidates?.[0]?.safetyRatings,
      partsCount: response.candidates?.[0]?.content?.parts?.length,
    });

    // Extract the generated image from the response
    const imagePart = response.candidates[0]?.content?.parts?.find(
      (part): part is { inlineData: { mimeType: string; data: string } } =>
        'inlineData' in part,
    );

    if (!imagePart) {
      // Log more details for debugging
      this.logger.error('No image in Gemini response', {
        candidates: response.candidates?.length,
        finishReason: response.candidates?.[0]?.finishReason,
        parts: response.candidates?.[0]?.content?.parts?.map(p => Object.keys(p)),
      });
      throw new Error(`No image generated in Gemini response. Finish reason: ${response.candidates?.[0]?.finishReason || 'unknown'}`);
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
