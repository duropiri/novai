/**
 * Identity-preservation prompts for Reference Kit generation
 * These prompts are optimized for Nano Banana Pro (Gemini) to generate
 * consistent reference images while preserving the subject's identity 1:1.
 *
 * Quality settings: 1K resolution, 9:16 portrait aspect ratio, highest quality
 */

const QUALITY_SUFFIX = ' Output in 9:16 portrait aspect ratio, highest quality.';

export const REFERENCE_KIT_PROMPTS = {
  /**
   * Anchor face: Front-facing passport-style portrait
   * This is the primary reference used for face swapping
   */
  anchor: `Recreate this same person in a completely front-facing, straight-on angle — like a passport photo. Do NOT rotate the head. Do NOT tilt the chin. Keep all identity markers identical: freckles, pore texture, skin tone, bone structure, nose shape, lip shape, eye shape, hairline, and proportions. Do NOT change expression, hairstyle, lighting, or style. Only correct the camera angle to a perfect straight-on, symmetrical view while preserving the exact identity 1:1${QUALITY_SUFFIX}`,

  /**
   * Profile: 3/4 angle view for depth and dimension
   */
  profile: `Rebuild this same person from a ¾ profile view. Keep all identity markers identical: freckles, nose structure, lips, skin texture, eye shape, hairline. Do not stylize. Only adjust the angle${QUALITY_SUFFIX}`,

  /**
   * Waist up: Waist-to-head portrait showing upper body proportions
   */
  waist_up: `Create a waist-up portrait of this exact same person. Keep identity 1:1 - preserve all facial features, freckles, skin texture, bone structure, proportions. Show from waist to head: torso, shoulders, collarbones, neck, face. Wearing simple white bralette. Neutral background, neutral lighting, front-facing, arms at sides.${QUALITY_SUFFIX}`,

  /**
   * Full body: Head-to-toe standing portrait
   */
  full_body: `Create a full-length image of this exact same person. Keep identity 1:1. Full-length photo showing head to toe, feet visible. Standing neutral pose, slight 3/4 angle. Wearing simple white bralette and high-waisted white briefs. Neutral background, neutral lighting, bare feet visible.${QUALITY_SUFFIX}`,

  /**
   * Expression variants
   */
  expressions: {
    smile: `Create a natural smiling expression for this same person. Identity must remain 1:1. Genuine warm smile, relaxed face. Keep lighting, proportions, and skin texture identical.${QUALITY_SUFFIX}`,

    angry: `Create a strong angry expression for this same person. Identity must remain 1:1. Mouth open wide in a shout, showing upper and lower teeth. Lips stretched back and down. Eyebrows pulled inward and downward sharply, creating deep vertical tension lines. Eyes wide and intense, upper eyelids raised. Slight forward head thrust, no rotation. Keep lighting, proportions, and skin texture identical.${QUALITY_SUFFIX}`,

    surprised: `Create a surprised expression for this same person. Identity must remain 1:1. Raised eyebrows, wide eyes, slightly open mouth. Keep lighting, proportions, and skin texture identical.${QUALITY_SUFFIX}`,

    serious: `Create a serious, determined expression for this same person. Identity must remain 1:1. Neutral mouth, focused intense eyes, slight tension in jaw. Keep lighting, proportions, and skin texture identical.${QUALITY_SUFFIX}`,
  },
} as const;

/**
 * Get the prompt for a specific reference type
 */
export function getPromptForReferenceType(type: string): string {
  switch (type) {
    case 'anchor':
      return REFERENCE_KIT_PROMPTS.anchor;
    case 'profile':
      return REFERENCE_KIT_PROMPTS.profile;
    case 'waist_up':
    case 'half_body': // backward compatibility
      return REFERENCE_KIT_PROMPTS.waist_up;
    case 'full_body':
      return REFERENCE_KIT_PROMPTS.full_body;
    case 'expression_smile':
      return REFERENCE_KIT_PROMPTS.expressions.smile;
    case 'expression_serious':
      return REFERENCE_KIT_PROMPTS.expressions.serious;
    case 'expression_surprised':
      return REFERENCE_KIT_PROMPTS.expressions.surprised;
    case 'expression_angry':
      return REFERENCE_KIT_PROMPTS.expressions.angry;
    default:
      throw new Error(`Unknown reference type: ${type}`);
  }
}
