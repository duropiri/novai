import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI, GenerateContentConfig } from '@google/genai';

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

  // Base prompt shared between both clothing options
  private readonly CHARACTER_DIAGRAM_BASE = `Using the attached image as the sole visual reference, create a character reference sheet rendered entirely in a realistic photographic style.
The final output must be one single image containing two photographic views side-by-side on a clean, neutral background.

1. Full-Body Photograph (CRITICAL)

Generate a true full-length, standing photograph of the person that is fully visible from the top of the head to the bottom of the feet.

NO cropping is allowed.

The entire body must be visible including feet and the ground contact point.

Leave clear padding above the head and below the feet so nothing is cut off.

Camera framing must resemble a fashion catalog / modeling reference shot, not a portrait crop.

If the reference image is cropped:

Reconstruct missing body parts conservatively and realistically using the same proportions.

If the person is holding a phone or any object:

Remove it completely so the hands appear empty and natural.

2. Facial Close-Up

Next to the full-body view, generate a high-resolution, photorealistic facial close-up.

Match facial features, expression, skin texture, and lighting exactly.

Maintain natural pores, realistic skin detail, and accurate proportions.

Lighting and realism must match the full-body image.

`;

  // Original clothing - preserves exact outfit from reference
  private readonly CHARACTER_DIAGRAM_ORIGINAL = `Clothing Requirements (ABSOLUTE RULE)

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

  // Minimal clothing - for body proportion accuracy
  private readonly CHARACTER_DIAGRAM_MINIMAL = `Clothing Requirements (BODY PROPORTION REFERENCE)

Generate the subject wearing MINIMAL athletic/fitness wear to accurately show body proportions:

- TOP: Plain sports bra or bikini top (solid neutral color - black, nude, or white)
- BOTTOM: Plain fitted shorts or bikini bottom (matching the top)
- FOOTWEAR: Bare feet preferred, or minimal neutral sandals if needed

This is for professional body proportion reference - accurate body shape documentation is the purpose.

Do NOT:
- Add extra clothing, layers, or accessories
- Cover or obscure body proportions
- Add jewelry, watches, or props
- Alter body proportions or shape from the reference

The minimal clothing must be plain, neutral, and non-distracting.

Footwear & Lower Body Rules

Feet must always be visible in the full-body image.

Bare feet preferred for proportion accuracy.

No exaggerated proportions, floating feet, or AI-invented designs.

Strict Rules

Never crop or cut off the body at any point.

Never add accessories, props, or extra clothing beyond the minimal athletic wear.

Keep hair, face, and skin tone exactly matching the reference.

Maintain a neutral, accurate, reference-grade presentation suitable for face-swap and identity consistency pipelines.`;

  /**
   * Get the full character diagram prompt based on clothing option
   */
  private getCharacterDiagramPrompt(clothingOption: 'original' | 'minimal' = 'original'): string {
    const clothingSection = clothingOption === 'minimal'
      ? this.CHARACTER_DIAGRAM_MINIMAL
      : this.CHARACTER_DIAGRAM_ORIGINAL;
    return this.CHARACTER_DIAGRAM_BASE + clothingSection;
  }

  /**
   * Generate a character diagram from a source image
   * Uses Gemini's image generation capabilities (Nano Banana Pro)
   * @param sourceImageUrl - URL of the source image
   * @param clothingOption - 'original' keeps outfit from reference, 'minimal' for body proportions
   */
  async generateCharacterDiagram(
    sourceImageUrl: string,
    clothingOption: 'original' | 'minimal' = 'original',
  ): Promise<CharacterDiagramResult> {
    if (!this.ai) {
      throw new Error('Gemini API not configured');
    }

    this.logger.log(`Generating character diagram with Gemini (Nano Banana Pro) - clothing: ${clothingOption}`);

    // Download the source image and convert to base64
    const imageData = await this.downloadImageAsBase64(sourceImageUrl);

    const config: GenerateContentConfig = {
      responseModalities: ['IMAGE', 'TEXT'],
      imageConfig: {
        aspectRatio: '5:4',
        imageSize: '1K',
      },
    };

    const prompt = this.getCharacterDiagramPrompt(clothingOption);

    const contents = [
      {
        role: 'user',
        parts: [
          { text: prompt },
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
   * Generate a reference image for a Reference Kit
   * Uses the same image-to-image approach as character diagrams
   */
  async generateReferenceImage(
    sourceImageUrl: string,
    prompt: string,
  ): Promise<CharacterDiagramResult> {
    if (!this.ai) {
      throw new Error('Gemini API not configured');
    }

    this.logger.log('Generating reference image with Gemini');

    // Download the source image and convert to base64
    const imageData = await this.downloadImageAsBase64(sourceImageUrl);

    const config: GenerateContentConfig = {
      responseModalities: ['IMAGE', 'TEXT'],
      imageConfig: {
        aspectRatio: '9:16', // Portrait orientation for reference kit
        imageSize: '1K',     // 1K resolution (keeps file size under Supabase limits)
      },
    };

    const contents = [
      {
        role: 'user',
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: imageData.mimeType,
              data: imageData.base64,
            },
          },
        ],
      },
    ];

    this.logger.log('Calling Gemini API for reference image...');

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
        this.logger.log('Reference image received from Gemini');
        break;
      } else if (part && 'text' in part) {
        this.logger.debug(`Gemini text response: ${part.text}`);
      }
    }

    if (!imageBase64 || !imageMimeType) {
      throw new Error('No image generated in Gemini response');
    }

    this.logger.log('Reference image generated successfully');

    return {
      imageBase64,
      mimeType: imageMimeType,
    };
  }

  /**
   * Regenerate a video frame with a new identity from reference images.
   * Used for AI video swapping - recreates the scene with the identity from references.
   *
   * @param firstFrameUrl - The scene/frame to recreate
   * @param referenceImageUrls - Identity reference images
   * @param keepOriginalOutfit - Whether to keep the scene's outfit or use identity's
   * @param expressionHint - Optional facial expression guidance (e.g., "mouth slightly open, eyes wide")
   */
  async regenerateFrameWithIdentity(
    firstFrameUrl: string,
    referenceImageUrls: string[],
    keepOriginalOutfit: boolean = true,
    expressionHint?: string,
  ): Promise<CharacterDiagramResult> {
    if (!this.ai) {
      throw new Error('Gemini API not configured');
    }

    this.logger.log(`Regenerating frame with identity (${referenceImageUrls.length} references, keepOutfit: ${keepOriginalOutfit}, expression: ${expressionHint || 'none'})`);

    // Build expression instruction if provided
    const expressionInstruction = expressionHint
      ? `- FACIAL EXPRESSION: The person should have the following expression: ${expressionHint}. Match this expression exactly.
`
      : '';

    // Scene preservation instructions - critical for maintaining furniture/props
    const scenePreservation = `
SCENE PRESERVATION - CRITICAL:
- Keep ALL furniture (chairs, stools, tables, beds, couches, etc.)
- Keep ALL props and objects in the scene
- Keep the floor/ground surface exactly as shown
- Keep all wall/background elements
- If the person is sitting on something, that object MUST remain
- If the person is holding something, that object MUST remain
- Do NOT remove, add, or modify any objects in the scene`;

    // Build the prompt based on outfit preference
    const prompt = keepOriginalOutfit
      ? `Recreate this EXACT scene with the person from the reference images.

ONLY CHANGE: Replace the person's face and body with the identity from the reference images.

PRESERVE EVERYTHING ELSE:
- Keep the EXACT same pose, camera angle, and framing
- Keep the EXACT same clothing/outfit on the person
- Keep the EXACT same background and environment
- Keep the EXACT same lighting and shadows
${expressionInstruction}${scenePreservation}

The first image is the SCENE to recreate. The remaining images show the TARGET IDENTITY.

Output: 2K resolution, photorealistic, highest quality.`
      : `Recreate this EXACT scene with the person from the reference images.

CHANGE: Replace the entire person (face, body, outfit) with the identity from the references.

PRESERVE EVERYTHING ELSE:
- Keep the EXACT same pose, camera angle, and framing
- Keep the EXACT same background and environment
- Keep the EXACT same lighting and shadows
${expressionInstruction}${scenePreservation}

The first image is the SCENE to recreate (use for pose/background). The remaining images show the TARGET IDENTITY.

Output: 2K resolution, photorealistic, highest quality.`;

    // Download all images
    const firstFrameData = await this.downloadImageAsBase64(firstFrameUrl);
    const referenceImagesData = await Promise.all(
      referenceImageUrls.map((url) => this.downloadImageAsBase64(url)),
    );

    // Build content parts: prompt + scene image + all reference images
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      { text: prompt },
      {
        inlineData: {
          mimeType: firstFrameData.mimeType,
          data: firstFrameData.base64,
        },
      },
    ];

    // Add all reference images
    for (const refData of referenceImagesData) {
      parts.push({
        inlineData: {
          mimeType: refData.mimeType,
          data: refData.base64,
        },
      });
    }

    const config: GenerateContentConfig = {
      responseModalities: ['IMAGE', 'TEXT'],
      imageConfig: {
        aspectRatio: '9:16', // Portrait for video
        imageSize: '2K',
      },
    };

    const contents = [
      {
        role: 'user',
        parts,
      },
    ];

    this.logger.log('Calling Nano Banana Pro (Gemini) for frame regeneration - NO FALLBACKS...');

    const response = await this.ai.models.generateContentStream({
      model: this.model,
      config,
      contents,
    });

    // Collect the streamed response
    let imageBase64: string | null = null;
    let imageMimeType: string | null = null;
    const textResponses: string[] = [];
    let blockedBySafety = false;
    let finishReason: string | null = null;

    for await (const chunk of response) {
      // Check for safety blocking
      const candidate = chunk.candidates?.[0];
      if (candidate?.finishReason) {
        finishReason = candidate.finishReason;
        if (finishReason === 'SAFETY' || finishReason === 'IMAGE_SAFETY') {
          blockedBySafety = true;
          this.logger.warn(`Nano Banana Pro: Content blocked by safety filter (${finishReason})`);
        }
      }

      if (!candidate?.content?.parts) {
        this.logger.debug(`Gemini chunk without parts: ${JSON.stringify(chunk)}`);
        continue;
      }

      // Check all parts, not just the first one
      for (const part of candidate.content.parts) {
        if (part && 'inlineData' in part && part.inlineData) {
          imageBase64 = part.inlineData.data || null;
          imageMimeType = part.inlineData.mimeType || null;
          this.logger.log('Regenerated frame received from Gemini');
        } else if (part && 'text' in part && part.text) {
          textResponses.push(part.text);
          this.logger.log(`Gemini text response: ${part.text}`);
        }
      }
    }

    // Check for safety block - DO NOT FALLBACK, throw error
    if (blockedBySafety) {
      throw new Error(`Nano Banana Pro: Image blocked by safety filter (${finishReason})`);
    }

    if (!imageBase64 || !imageMimeType) {
      const textSummary = textResponses.join(' ').slice(0, 500);
      this.logger.error(`Nano Banana Pro did not return an image. Text response: ${textSummary}`);
      throw new Error(`Nano Banana Pro: No image generated. Response: ${textSummary || 'No response'}`);
    }

    this.logger.log('Frame regeneration completed successfully');

    return {
      imageBase64,
      mimeType: imageMimeType,
    };
  }

  /**
   * Generate a character diagram using multiple reference images
   * This is the enhanced version that uses all available references for better identity preservation
   *
   * @param sourceImages - Array of reference images with quality scores and weights
   * @param constrainedPrompt - Full prompt with identity constraints from PromptBuilderService
   * @param aspectRatio - Output aspect ratio (default: 5:4 for character diagrams)
   * @param imageSize - Output image size (default: 1K)
   */
  async generateWithMultipleReferences(
    sourceImages: Array<{
      url: string;
      type: string;
      qualityScore: number;
      weight: number;
    }>,
    constrainedPrompt: string,
    aspectRatio: '5:4' | '9:16' | '1:1' | '16:9' = '5:4',
    imageSize: '1K' | '2K' = '1K',
  ): Promise<CharacterDiagramResult> {
    if (!this.ai) {
      throw new Error('Gemini API not configured');
    }

    // Sort images by quality * weight, take top 5 (Gemini works best with 3-5 references)
    const sortedImages = [...sourceImages]
      .sort((a, b) => b.qualityScore * b.weight - a.qualityScore * a.weight)
      .slice(0, 5);

    this.logger.log(
      `Generating with ${sortedImages.length} reference images (from ${sourceImages.length} provided)`,
    );

    // Download all images in parallel
    const imageDataPromises = sortedImages.map((img) => this.downloadImageAsBase64(img.url));
    const imageData = await Promise.all(imageDataPromises);

    // Build image role descriptions for the prompt
    const imageDescriptions = sortedImages
      .map((img, i) => `Image ${i + 1}: ${img.type} (quality: ${(img.qualityScore * 100).toFixed(0)}%)`)
      .join('\n');

    // Build content parts: enhanced prompt + all reference images
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      {
        text: `REFERENCE IMAGES PROVIDED:\n${imageDescriptions}\n\n${constrainedPrompt}`,
      },
    ];

    // Add all reference images
    for (const data of imageData) {
      parts.push({
        inlineData: {
          mimeType: data.mimeType,
          data: data.base64,
        },
      });
    }

    const config: GenerateContentConfig = {
      responseModalities: ['IMAGE', 'TEXT'],
      imageConfig: {
        aspectRatio,
        imageSize,
      },
    };

    const contents = [
      {
        role: 'user',
        parts,
      },
    ];

    this.logger.log(`Calling Gemini with ${sortedImages.length} references...`);

    const response = await this.ai.models.generateContentStream({
      model: this.model,
      config,
      contents,
    });

    // Collect the streamed response
    let imageBase64: string | null = null;
    let imageMimeType: string | null = null;
    const textResponses: string[] = [];
    let blockedBySafety = false;
    let finishReason: string | null = null;

    for await (const chunk of response) {
      const candidate = chunk.candidates?.[0];
      if (candidate?.finishReason) {
        finishReason = candidate.finishReason;
        if (finishReason === 'SAFETY' || finishReason === 'IMAGE_SAFETY') {
          blockedBySafety = true;
          this.logger.warn(`Multi-reference generation blocked by safety: ${finishReason}`);
        }
      }

      if (!candidate?.content?.parts) {
        continue;
      }

      for (const part of candidate.content.parts) {
        if (part && 'inlineData' in part && part.inlineData) {
          imageBase64 = part.inlineData.data || null;
          imageMimeType = part.inlineData.mimeType || null;
          this.logger.log('Multi-reference image received from Gemini');
        } else if (part && 'text' in part && part.text) {
          textResponses.push(part.text);
        }
      }
    }

    if (blockedBySafety) {
      throw new Error(`Generation blocked by safety filter (${finishReason})`);
    }

    if (!imageBase64 || !imageMimeType) {
      const textSummary = textResponses.join(' ').slice(0, 500);
      throw new Error(`No image generated. Response: ${textSummary || 'No response'}`);
    }

    this.logger.log('Multi-reference generation completed successfully');

    return {
      imageBase64,
      mimeType: imageMimeType,
    };
  }

  /**
   * Analyze an image and return structured metadata
   * Used by IdentityAnalysisService for profile extraction
   *
   * @param imageUrl - URL of the image to analyze
   * @param analysisPrompt - Prompt requesting structured analysis
   */
  async analyzeImageStructured(
    imageUrl: string,
    analysisPrompt: string,
  ): Promise<string> {
    if (!this.ai) {
      throw new Error('Gemini API not configured');
    }

    const imageData = await this.downloadImageAsBase64(imageUrl);

    const response = await this.ai.models.generateContent({
      model: 'gemini-2.0-flash', // Use flash for analysis (faster, cheaper)
      contents: [
        {
          role: 'user',
          parts: [
            { text: analysisPrompt },
            {
              inlineData: {
                mimeType: imageData.mimeType,
                data: imageData.base64,
              },
            },
          ],
        },
      ],
    });

    return response.text || '';
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
