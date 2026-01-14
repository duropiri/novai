import { Injectable, Logger } from '@nestjs/common';
import { AggregatedProfile } from './identity-analysis.service';

// ============================================
// INTERFACES
// ============================================

export type GenerationType =
  | 'character_diagram'
  | 'reference_kit_anchor'
  | 'reference_kit_profile'
  | 'reference_kit_waist_up'
  | 'reference_kit_full_body'
  | 'reference_kit_expression'
  | 'image_generation'
  | 'face_swap'
  | 'video_frame';

export interface PromptContext {
  generationType: GenerationType;
  profile: AggregatedProfile | null;
  targetPose?: string;
  targetExpression?: string;
  targetClothing?: 'original' | 'minimal' | string;
  targetBackground?: string;
  customInstructions?: string;
  referenceImageCount?: number;
}

export interface BuiltPrompt {
  mainPrompt: string;
  identityConstraints: string;
  lightingConstraints: string;
  bodyConstraints: string;
  styleConstraints: string;
  fullPrompt: string;
}

// ============================================
// SERVICE
// ============================================

@Injectable()
export class PromptBuilderService {
  private readonly logger = new Logger(PromptBuilderService.name);

  /**
   * Build a complete identity-constrained prompt from profile metadata
   * This is the core function that translates mathematical profile data into text constraints
   */
  buildIdentityPrompt(context: PromptContext): BuiltPrompt {
    const sections: string[] = [];

    // Build identity constraints from face geometry
    const identityConstraints = this.buildFaceConstraints(context.profile);
    if (identityConstraints) {
      sections.push(identityConstraints);
    }

    // Build lighting constraints
    const lightingConstraints = this.buildLightingConstraints(context.profile);
    if (lightingConstraints) {
      sections.push(lightingConstraints);
    }

    // Build body proportion constraints
    const bodyConstraints = this.buildBodyConstraints(context.profile);
    if (bodyConstraints) {
      sections.push(bodyConstraints);
    }

    // Build style constraints
    const styleConstraints = this.buildStyleConstraints(context.profile);
    if (styleConstraints) {
      sections.push(styleConstraints);
    }

    // Get the base prompt for the generation type
    const mainPrompt = this.getBasePrompt(context);

    // Assemble full prompt
    const fullPrompt = this.assemblePrompt(mainPrompt, sections, context);

    return {
      mainPrompt,
      identityConstraints,
      lightingConstraints,
      bodyConstraints,
      styleConstraints,
      fullPrompt,
    };
  }

  /**
   * Build face geometry constraints from profile
   * Translates mathematical face metrics into text instructions
   */
  private buildFaceConstraints(profile: AggregatedProfile | null): string {
    if (!profile?.face_geometry_profile || Object.keys(profile.face_geometry_profile).length === 0) {
      return '';
    }

    const fg = profile.face_geometry_profile;
    const constraints: string[] = ['FACIAL STRUCTURE (must match exactly):'];

    // Face shape
    if (fg.face_shape) {
      constraints.push(`- Face shape: ${fg.face_shape.value} (confidence: ${(fg.face_shape.confidence * 100).toFixed(0)}%)`);
    }

    // Eye spacing
    if (fg.eye_distance_ratio) {
      const spacing = fg.eye_distance_ratio.value as number;
      const spacingDesc = spacing < 0.29 ? 'close-set' : spacing > 0.33 ? 'wide-set' : 'average-spaced';
      constraints.push(`- Eyes: ${spacingDesc} (ratio: ${spacing.toFixed(2)})`);
    }

    // Nose
    if (fg.nose_shape) {
      constraints.push(`- Nose: ${fg.nose_shape.value}`);
    }

    // Lips
    if (fg.lip_shape) {
      constraints.push(`- Lips: ${fg.lip_shape.value}`);
    }

    // Chin
    if (fg.chin_shape) {
      constraints.push(`- Chin: ${fg.chin_shape.value}`);
    }

    // Jawline
    if (fg.jawline) {
      constraints.push(`- Jawline: ${fg.jawline.value}`);
    }

    // Forehead
    if (fg.forehead_height) {
      constraints.push(`- Forehead: ${fg.forehead_height.value}`);
    }

    // Symmetry
    if (fg.face_symmetry) {
      const symmetry = fg.face_symmetry.value as number;
      if (symmetry > 0.9) {
        constraints.push('- Face is highly symmetrical - maintain this balance');
      } else if (symmetry < 0.8) {
        constraints.push('- Face has natural asymmetry - preserve unique characteristics');
      }
    }

    constraints.push('');
    constraints.push('Do NOT alter these facial proportions. The identity must remain 1:1 identical.');

    return constraints.join('\n');
  }

  /**
   * Build lighting constraints from profile
   * Translates lighting metrics into text instructions
   */
  private buildLightingConstraints(profile: AggregatedProfile | null): string {
    if (!profile?.lighting_profile || Object.keys(profile.lighting_profile).length === 0) {
      return '';
    }

    const lp = profile.lighting_profile;
    const constraints: string[] = ['LIGHTING REQUIREMENTS (match reference images):'];

    // Lighting type
    if (lp.lighting_type) {
      const lightingDescriptions: Record<string, string> = {
        front: 'Front lighting - even illumination from camera position',
        rembrandt: 'Rembrandt lighting - triangular highlight on shadow-side cheek',
        loop: 'Loop lighting - small shadow from nose toward corner of mouth',
        split: 'Split lighting - half face illuminated, half in shadow',
        butterfly: 'Butterfly lighting - shadow under nose creating butterfly shape',
        natural: 'Natural/available lighting - soft, ambient quality',
        rim: 'Rim lighting - backlit edge highlighting',
      };
      const desc = lightingDescriptions[lp.lighting_type.value as string] || lp.lighting_type.value;
      constraints.push(`- Pattern: ${desc}`);
    }

    // Intensity
    if (lp.intensity) {
      const intensityDescriptions: Record<string, string> = {
        soft: 'Soft, diffused lighting with minimal shadows',
        medium: 'Medium contrast with defined but soft shadows',
        dramatic: 'High contrast dramatic lighting with deep shadows',
      };
      constraints.push(`- Intensity: ${intensityDescriptions[lp.intensity.value as string] || lp.intensity.value}`);
    }

    // Color temperature
    if (lp.color_temperature) {
      const temp = lp.color_temperature.value as number;
      let tempDesc = 'neutral';
      if (temp < 4000) tempDesc = 'warm (tungsten/golden)';
      else if (temp > 5500) tempDesc = 'cool (daylight/blue)';
      constraints.push(`- Color temperature: ${tempDesc} (~${temp}K)`);
    }

    // Key-to-fill ratio
    if (lp.key_fill_ratio) {
      const ratio = lp.key_fill_ratio.value as number;
      let ratioDesc = 'balanced';
      if (ratio > 4) ratioDesc = 'high contrast (strong key, minimal fill)';
      else if (ratio < 2) ratioDesc = 'low contrast (even fill)';
      constraints.push(`- Key-to-fill: ${ratioDesc} (${ratio.toFixed(1)}:1)`);
    }

    constraints.push('');
    constraints.push('Match the lighting style from reference images for consistency.');

    return constraints.join('\n');
  }

  /**
   * Build body proportion constraints from profile
   */
  private buildBodyConstraints(profile: AggregatedProfile | null): string {
    if (!profile?.body_proportions_profile || Object.keys(profile.body_proportions_profile).length === 0) {
      return '';
    }

    const bp = profile.body_proportions_profile;
    const constraints: string[] = ['BODY PROPORTIONS (maintain exactly):'];

    // Body type
    if (bp.body_type) {
      const bodyDescriptions: Record<string, string> = {
        slim: 'Slim/slender build with lean proportions',
        athletic: 'Athletic build with toned, defined muscles',
        average: 'Average build with balanced proportions',
        curvy: 'Curvy build with fuller proportions',
        plus: 'Plus-size build with generous proportions',
      };
      constraints.push(`- Build: ${bodyDescriptions[bp.body_type.value as string] || bp.body_type.value}`);
    }

    // Limb ratios (provide as reference)
    if (bp.arm_to_torso?.mean) {
      constraints.push(`- Arm-to-torso ratio: ${(bp.arm_to_torso.mean as number).toFixed(2)}`);
    }
    if (bp.leg_to_torso?.mean) {
      constraints.push(`- Leg-to-torso ratio: ${(bp.leg_to_torso.mean as number).toFixed(2)}`);
    }
    if (bp.shoulder_to_hip?.mean) {
      const ratio = bp.shoulder_to_hip.mean as number;
      const desc = ratio > 1.3 ? 'wider shoulders' : ratio < 1.0 ? 'wider hips' : 'balanced';
      constraints.push(`- Shoulder-to-hip: ${desc} (${ratio.toFixed(2)})`);
    }
    if (bp.head_to_body?.mean) {
      const ratio = bp.head_to_body.mean as number;
      const heads = 1 / ratio;
      constraints.push(`- Head-to-body: approximately ${heads.toFixed(1)} heads tall`);
    }

    constraints.push('');
    constraints.push('Do NOT alter body proportions. Maintain the exact ratios from references.');

    return constraints.join('\n');
  }

  /**
   * Build style constraints from profile
   */
  private buildStyleConstraints(profile: AggregatedProfile | null): string {
    if (!profile?.style_fingerprint || Object.keys(profile.style_fingerprint).length === 0) {
      return '';
    }

    const sf = profile.style_fingerprint;
    const constraints: string[] = ['APPEARANCE & STYLE (preserve exactly):'];

    // Skin tone
    const skinTone = sf.skin_tone as { value: string; confidence: number } | undefined;
    if (skinTone) {
      constraints.push(`- Skin tone: ${skinTone.value} (exact hex color, do not alter)`);
    }

    // Hair
    const hairColor = sf.hair_color as { value: string } | undefined;
    const hairLength = sf.hair_length as { value: string } | undefined;
    const hairTexture = sf.hair_texture as { value: string } | undefined;
    if (hairColor || hairLength || hairTexture) {
      const hairParts: string[] = [];
      if (hairLength) hairParts.push(hairLength.value);
      if (hairTexture) hairParts.push(hairTexture.value);
      if (hairColor) hairParts.push(`(${hairColor.value})`);
      constraints.push(`- Hair: ${hairParts.join(', ')}`);
    }

    // Eyes
    const eyeColor = sf.eye_color as { value: string } | undefined;
    if (eyeColor) {
      constraints.push(`- Eye color: ${eyeColor.value}`);
    }

    // Skin texture
    const skinTexture = sf.skin_texture as { value: string } | undefined;
    if (skinTexture) {
      constraints.push(`- Skin texture: ${skinTexture.value}`);
    }

    // Makeup
    const makeupLevel = sf.makeup_level as { value: string } | undefined;
    if (makeupLevel) {
      constraints.push(`- Makeup: ${makeupLevel.value}`);
    }

    // Style keywords
    const styleKeywords = sf.style_keywords as string[] | undefined;
    if (styleKeywords && styleKeywords.length > 0) {
      constraints.push(`- Aesthetic: ${styleKeywords.join(', ')}`);
    }

    constraints.push('');
    constraints.push('Preserve all appearance details exactly. Identity must remain 1:1.');

    return constraints.join('\n');
  }

  /**
   * Get the base prompt for a specific generation type
   */
  private getBasePrompt(context: PromptContext): string {
    switch (context.generationType) {
      case 'character_diagram':
        return this.getCharacterDiagramPrompt(context);
      case 'reference_kit_anchor':
        return this.getReferenceKitAnchorPrompt(context);
      case 'reference_kit_profile':
        return this.getReferenceKitProfilePrompt(context);
      case 'reference_kit_waist_up':
        return this.getReferenceKitWaistUpPrompt(context);
      case 'reference_kit_full_body':
        return this.getReferenceKitFullBodyPrompt(context);
      case 'reference_kit_expression':
        return this.getReferenceKitExpressionPrompt(context);
      case 'image_generation':
        return this.getImageGenerationPrompt(context);
      case 'face_swap':
        return this.getFaceSwapPrompt(context);
      case 'video_frame':
        return this.getVideoFramePrompt(context);
      default:
        return 'Generate an image that matches the identity from reference images.';
    }
  }

  private getCharacterDiagramPrompt(context: PromptContext): string {
    const clothingInstruction = context.targetClothing === 'minimal'
      ? 'Minimal athletic wear (sports bra/bikini top, fitted shorts) for body proportion reference.'
      : 'PRESERVE THE EXACT OUTFIT from the reference image.';

    return `Create a professional character reference sheet with TWO VIEWS side-by-side:

1. FULL-BODY VIEW (left side):
   - Complete head-to-toe standing pose
   - ${clothingInstruction}
   - Bare feet or minimal sandals
   - Neutral background
   - Clear padding around figure
   - NO cropping at edges

2. FACIAL CLOSE-UP (right side):
   - High-resolution face detail
   - Same lighting as full-body
   - Exact facial features preserved
   - Natural skin texture visible

OUTPUT: Single image, 5:4 aspect ratio, photorealistic quality.`;
  }

  private getReferenceKitAnchorPrompt(context: PromptContext): string {
    const expression = context.targetExpression || 'neutral';
    return `Recreate this EXACT person in a passport-style front-facing pose.

REQUIREMENTS:
- Completely straight-on angle (0 degrees)
- Face centered in frame
- ${expression} expression
- Head and shoulders visible
- Clean, neutral background
- Studio-quality lighting
- Photorealistic rendering

CRITICAL: Preserve ALL identity markers exactly:
- Face shape, bone structure
- Skin tone, texture, pores
- Eye shape, color, spacing
- Nose shape and proportions
- Lip shape and fullness
- Hairline and hair characteristics

Identity must be 1:1 identical to reference.`;
  }

  private getReferenceKitProfilePrompt(context: PromptContext): string {
    return `Recreate this EXACT person from a 3/4 profile angle.

REQUIREMENTS:
- 30-45 degree angle from front
- Face clearly visible, slight turn
- Neutral expression
- Head and shoulders visible
- Clean, neutral background
- Match lighting from reference

CRITICAL: Preserve ALL identity markers exactly:
- Nose profile and bridge
- Jawline from angle
- Cheekbone definition
- Eye shape visible
- Skin tone and texture

Identity must be 1:1 identical to reference.`;
  }

  private getReferenceKitWaistUpPrompt(context: PromptContext): string {
    const clothing = context.targetClothing || 'Simple white athletic top';
    return `Recreate this EXACT person in a waist-up portrait.

REQUIREMENTS:
- View from head to waist
- Slight 3/4 angle (15-20 degrees)
- ${clothing}
- Arms relaxed at sides
- Clean, neutral background
- Consistent lighting

PRESERVE EXACTLY:
- Face and all features
- Upper body proportions
- Shoulder width
- Skin tone throughout

Identity must be 1:1 identical to reference.`;
  }

  private getReferenceKitFullBodyPrompt(context: PromptContext): string {
    const clothing = context.targetClothing || 'Simple athletic wear (sports bra and fitted shorts)';
    return `Recreate this EXACT person in a full-length standing pose.

REQUIREMENTS:
- Complete head-to-toe view
- Feet visible and grounded
- Standing neutral pose
- ${clothing}
- Bare feet preferred
- Clean, neutral background
- Consistent lighting

PRESERVE EXACTLY:
- Face and all features
- Full body proportions
- Limb lengths and ratios
- Body type and build
- Skin tone throughout

Identity must be 1:1 identical. NO cropping.`;
  }

  private getReferenceKitExpressionPrompt(context: PromptContext): string {
    const expression = context.targetExpression || 'smiling';
    const expressionGuides: Record<string, string> = {
      smile: 'Natural warm smile, eyes slightly crinkled, relaxed face',
      smiling: 'Natural warm smile, eyes slightly crinkled, relaxed face',
      angry: 'Strong angry expression, eyebrows pulled inward and down, mouth open or tense',
      surprised: 'Wide eyes, raised eyebrows, slightly open mouth',
      serious: 'Neutral mouth, focused intense eyes, slight jaw tension',
      sad: 'Downturned mouth, soft eyes, subtle frown',
      laughing: 'Open mouth laugh, genuine joy, eyes crinkled',
    };

    const guide = expressionGuides[expression.toLowerCase()] || expression;

    return `Recreate this EXACT person with a specific expression.

EXPRESSION: ${guide}

REQUIREMENTS:
- Front-facing or slight angle
- Face and upper body visible
- Clean, neutral background
- Same lighting as references

CRITICAL: The expression changes, but IDENTITY stays 1:1:
- Same face shape and structure
- Same skin tone and texture
- Same eye shape and color
- Same nose and lip shape
- Only the expression differs

The person must be unmistakably identical to the reference.`;
  }

  private getImageGenerationPrompt(context: PromptContext): string {
    return `Generate a photorealistic image of this specific person.

${context.customInstructions || 'A professional portrait photo.'}

CRITICAL IDENTITY REQUIREMENTS:
- Must be the EXACT same person as references
- Preserve all facial features precisely
- Match body proportions exactly
- Maintain consistent skin tone
- Keep lighting style consistent

The generated image must be unmistakably the same person.`;
  }

  private getFaceSwapPrompt(context: PromptContext): string {
    return `Replace the face in the target image with the identity from references.

REQUIREMENTS:
- Maintain exact pose and body from target
- Replace face with reference identity
- Blend seamlessly with target lighting
- Preserve target background and scene
- Match skin tone to reference identity

The result should look natural and consistent.`;
  }

  private getVideoFramePrompt(context: PromptContext): string {
    const expression = context.targetExpression
      ? `\nEXPRESSION: ${context.targetExpression}`
      : '';

    return `Recreate this exact scene with the identity from reference images.

PRESERVE FROM SCENE:
- Exact pose and body position
- Background and environment
- Lighting and shadows
- Any furniture or props

REPLACE WITH REFERENCE IDENTITY:
- Face and facial features
- Skin tone (if body visible)
${expression}

The scene must look identical except for the person's identity.`;
  }

  /**
   * Assemble the complete prompt with all constraints
   */
  private assemblePrompt(
    mainPrompt: string,
    constraintSections: string[],
    context: PromptContext,
  ): string {
    const parts: string[] = [];

    // Add main prompt
    parts.push(mainPrompt);
    parts.push('');

    // Add reference image instructions if multiple images
    if (context.referenceImageCount && context.referenceImageCount > 1) {
      parts.push(`REFERENCE IMAGES: You are provided ${context.referenceImageCount} reference images of this person.`);
      parts.push('Study ALL references to understand the identity from multiple angles and conditions.');
      parts.push('');
    }

    // Add constraint sections
    for (const section of constraintSections) {
      if (section) {
        parts.push('---');
        parts.push(section);
      }
    }

    // Add final emphasis
    parts.push('');
    parts.push('---');
    parts.push('FINAL INSTRUCTION: Identity preservation is the #1 priority.');
    parts.push('The output must be unmistakably the same person as the references.');

    return parts.join('\n');
  }

  /**
   * Build a compact prompt for validation checks
   */
  buildValidationPrompt(profile: AggregatedProfile): string {
    const parts: string[] = ['Verify this image matches the expected identity:'];

    // Face geometry checks
    const fg = profile.face_geometry_profile;
    if (fg.face_shape) parts.push(`- Face shape should be: ${fg.face_shape.value}`);
    if (fg.nose_shape) parts.push(`- Nose should be: ${fg.nose_shape.value}`);
    if (fg.lip_shape) parts.push(`- Lips should be: ${fg.lip_shape.value}`);

    // Style checks
    const sf = profile.style_fingerprint;
    const skinTone = sf.skin_tone as { value: string } | undefined;
    if (skinTone) parts.push(`- Skin tone should be: ${skinTone.value}`);
    const hairColor = sf.hair_color as { value: string } | undefined;
    if (hairColor) parts.push(`- Hair color should be: ${hairColor.value}`);

    parts.push('');
    parts.push('Return JSON with match scores (0-1) for each feature.');

    return parts.join('\n');
  }

  /**
   * Build hints for regeneration based on validation failures
   */
  buildRegenerationHints(
    deviations: Array<{ aspect: string; expected: string; detected: string; severity: string }>,
  ): string[] {
    const hints: string[] = [];

    for (const deviation of deviations) {
      if (deviation.severity === 'low') continue;

      const hintMap: Record<string, string> = {
        face_shape: `CRITICAL: Face shape must be ${deviation.expected}, not ${deviation.detected}`,
        nose_shape: `Nose shape must be ${deviation.expected}`,
        lip_shape: `Lips must be ${deviation.expected}`,
        skin_tone: `CRITICAL: Skin tone must match exactly: ${deviation.expected}`,
        hair_color: `Hair color must be ${deviation.expected}`,
        lighting: `Lighting should be ${deviation.expected} style`,
        expression: `Expression should be ${deviation.expected}`,
      };

      const hint = hintMap[deviation.aspect] || `Correct ${deviation.aspect}: ${deviation.expected}`;
      hints.push(hint);
    }

    return hints;
  }
}
