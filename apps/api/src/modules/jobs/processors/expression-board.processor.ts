import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUES } from '../queues.constants';
import { GeminiService } from '../../../services/gemini.service';
import { FFmpegService } from '../../../services/ffmpeg.service';
import { SupabaseService } from '../../files/supabase.service';
import {
  ExpressionBoardService,
  SubjectProfile,
  BoardType,
  BOARD_EXPRESSIONS,
} from '../../expression-board/expression-board.service';

interface ExpressionBoardJobData {
  expressionBoardId: string;
}

/**
 * Expression prompt templates based on expression_board_templates.md
 * Each template uses placeholder variables that get replaced with subject profile data
 */
const EXPRESSION_PROMPTS: Record<string, string> = {
  // Emotion Board
  'Happy': 'HAPPY expression with bright genuine smile, eyes crinkled with joy, teeth showing, radiating warmth and happiness.',
  'Sad': 'SAD expression with downturned mouth, slightly furrowed brow, melancholy eyes, subtle pout, conveying sorrow and dejection.',
  'Angry': 'ANGRY expression with furrowed brows, intense glare, tightened jaw, lips pressed together firmly, showing frustration and rage.',
  'Surprised': 'SURPRISED expression with raised eyebrows, wide open eyes, slightly open mouth showing shock and amazement, caught off guard.',
  'Fearful': 'FEARFUL expression with wide eyes showing whites, raised inner eyebrows, tense face, slightly parted lips showing anxiety and fear, vulnerable and alarmed.',
  'Disgusted': 'DISGUSTED expression with wrinkled nose, raised upper lip, squinted eyes, showing revulsion and distaste, recoiling from something unpleasant.',
  'Neutral': 'NEUTRAL expression with relaxed face, calm demeanor, no particular emotion, resting face, composed and balanced.',
  'Contempt': 'CONTEMPT expression with one-sided smirk, raised corner of mouth, slightly narrowed eyes, showing disdain and superiority, dismissive attitude.',

  // Playful Board
  'Winking': 'WINKING expression with one eye closed in a playful wink, slight smile, flirty and fun demeanor, charming and lighthearted.',
  'Smirking': 'SMIRKING expression with asymmetrical smile, one corner of mouth raised, knowing look, mischievous vibe, self-assured attitude.',
  'Tongue Out': 'TONGUE OUT expression with tongue sticking out playfully, silly and fun mood, eyes bright with amusement, carefree and goofy.',
  'Blowing Kiss': 'BLOWING KISS expression with lips puckered, hand near face blowing a kiss, sweet and affectionate mood, romantic gesture.',
  'Giggling': 'GIGGLING expression with mouth open in laughter, eyes squinted with joy, hand possibly covering mouth, infectious happiness, bubbly energy.',
  'Teasing': 'TEASING expression with playful raised eyebrow, slight smirk, eyes sparkling with mischief, flirty and fun demeanor, provocative charm.',
  'Cheeky': 'CHEEKY expression with impish grin, slightly tilted head, eyes full of playful intent, cute and sassy vibe, endearing mischief.',
  'Mischievous': 'MISCHIEVOUS expression with sly smile, narrowed eyes plotting something fun, devious yet charming look, up to no good.',

  // Glamour Board
  'Sultry Gaze': 'SULTRY GAZE expression with half-lidded eyes, intense smoldering look, slightly parted lips, confident and alluring demeanor, magnetic presence.',
  'Raised Eyebrow': 'RAISED EYEBROW expression with one eyebrow arched questioningly, slight smirk, skeptical yet intrigued look, sophisticated demeanor, cool confidence.',
  'Mysterious Smile': 'MYSTERIOUS SMILE expression with enigmatic Mona Lisa-like smile, knowing eyes, subtle and intriguing expression, elegant demeanor, secrets behind the eyes.',
  'Side Glance': 'SIDE GLANCE expression with eyes looking to the side while face forward, coy and flirty look, subtle smile, captivating demeanor, intriguing sideways gaze.',
  'Pouting': 'POUTING expression with lips pushed forward in a pout, slightly furrowed brow, cute and attention-seeking look, playfully demanding.',
  'Alluring': 'ALLURING expression with captivating gaze, slightly tilted head, inviting smile, magnetic and attractive demeanor, drawing you in.',
  'Intense': 'INTENSE expression with piercing focused gaze, serious demeanor, strong eye contact, powerful and commanding presence, unwavering attention.',
  'Dreamy': 'DREAMY expression with soft unfocused gaze, gentle smile, lost in thought, ethereal and romantic mood, wistful and faraway look.',

  // Casual Board
  'Laughing': 'LAUGHING expression with head thrown back slightly, mouth wide open in genuine laughter, eyes crinkled shut with joy, infectious happiness, pure delight.',
  'Thinking': 'THINKING expression with eyes looking up or to the side, slight furrow of concentration, finger possibly touching chin, contemplative mood, deep in thought.',
  'Curious': 'CURIOUS expression with slightly tilted head, raised eyebrows, wide interested eyes, inquisitive and engaged look, wanting to know more.',
  'Excited': 'EXCITED expression with bright wide eyes, big enthusiastic smile, animated and energetic demeanor, pure joy and anticipation, barely containing enthusiasm.',
  'Bored': 'BORED expression with half-lidded eyes, slight frown, disinterested look, possibly resting chin on hand, unenthusiastic demeanor, waiting for something interesting.',
  'Sleepy': 'SLEEPY expression with heavy drooping eyelids, yawning or about to yawn, tired and drowsy look, relaxed facial muscles, ready for bed.',
  'Confused': 'CONFUSED expression with furrowed brow, squinted eyes, tilted head, puzzled and bewildered look, trying to understand, perplexed.',
  'Hopeful': 'HOPEFUL expression with bright eyes looking upward, gentle optimistic smile, expectant and positive demeanor, dreaming of good things, anticipating the best.',

  // 3D Angles Board
  'Front Neutral': 'FRONT VIEW facing camera directly, NEUTRAL expression with relaxed face, lips gently closed, symmetrical pose.',
  'Front Smile': 'FRONT VIEW facing camera directly, SMILING expression with genuine bright smile showing teeth, eyes crinkled with joy.',
  '3/4 Left': 'THREE-QUARTER LEFT VIEW with head turned 45 degrees to the left, neutral expression, showing left side of face more prominently, revealing cheekbone and jaw structure.',
  '3/4 Right': 'THREE-QUARTER RIGHT VIEW with head turned 45 degrees to the right, neutral expression, showing right side of face more prominently, revealing cheekbone and jaw structure.',
  'Profile Left': 'FULL LEFT PROFILE VIEW with head turned 90 degrees to the left, showing complete side profile of face, nose bridge, jawline visible, ear partially visible.',
  'Profile Right': 'FULL RIGHT PROFILE VIEW with head turned 90 degrees to the right, showing complete side profile of face, nose bridge, jawline visible, ear partially visible.',
  'Looking Up': 'LOOKING UP pose with face tilted upward, chin raised, eyes looking up toward the sky, showing underside of chin and jaw, neck visible.',
  'Looking Down': 'LOOKING DOWN pose with face tilted downward, chin lowered, eyes looking down, showing top of head and forehead more prominently, contemplative angle.',
};

@Processor(QUEUES.EXPRESSION_BOARD)
export class ExpressionBoardProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(ExpressionBoardProcessor.name);

  constructor(
    private readonly geminiService: GeminiService,
    private readonly ffmpegService: FFmpegService,
    private readonly supabase: SupabaseService,
    private readonly expressionBoardService: ExpressionBoardService,
  ) {
    super();
  }

  onModuleInit() {
    this.logger.log('=== ExpressionBoardProcessor initialized ===');
    this.logger.log(`Queue name: ${QUEUES.EXPRESSION_BOARD}`);
  }

  @OnWorkerEvent('active')
  onActive(job: Job) {
    this.logger.log(`Job ${job.id} is now active`);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job ${job.id} failed: ${error.message}`);
  }

  async process(job: Job<ExpressionBoardJobData>): Promise<void> {
    const { expressionBoardId } = job.data;

    this.logger.log(`=== EXPRESSION BOARD JOB STARTED ===`);
    this.logger.log(`Expression Board ID: ${expressionBoardId}`);

    try {
      // Get the expression board record
      const board = await this.expressionBoardService.findOne(expressionBoardId);

      this.logger.log(`Processing expression board: ${board.name || expressionBoardId}`);
      this.logger.log(`Source type: ${board.source_type}`);
      this.logger.log(`Board types: ${board.board_types.join(', ')}`);
      this.logger.log(`Total expressions: ${board.expressions.length}`);

      // Get the face reference URL based on source type
      const faceReferenceUrl = await this.resolveFaceReference(board);
      this.logger.log(`Face reference URL: ${faceReferenceUrl}`);

      // Update status to generating
      await this.expressionBoardService.updateProgress(expressionBoardId, 2);

      // Analyze the reference face to extract subject profile
      this.logger.log('Analyzing reference face for subject profile...');
      const subjectProfile = await this.analyzeSubjectProfile(faceReferenceUrl);
      this.logger.log(`Subject profile: ${subjectProfile.ageDesc} ${subjectProfile.gender}, ${subjectProfile.hairColor} ${subjectProfile.hairStyle}`);

      // Save subject profile to database
      await this.expressionBoardService.updateSubjectProfile(expressionBoardId, subjectProfile);
      await this.expressionBoardService.updateProgress(expressionBoardId, 5);

      // Check if we need to generate a Front Neutral for angles board
      let frontNeutralUrl = faceReferenceUrl;
      const hasAnglesBoard = board.board_types.includes('angles');

      // If angles board is included and the reference isn't a front-facing neutral shot,
      // we might want to generate one first. For now, we'll use the reference as-is
      // and generate Front Neutral as the first angle if needed.

      const expressions = board.expressions;
      const cellUrls: Record<string, string> = {};
      const cellData: Array<{ url: string; label: string }> = [];
      let totalCost = 0;

      // Generate each expression using image-to-image with Nano Banana Pro
      for (let i = 0; i < expressions.length; i++) {
        const expression = expressions[i];
        const progress = Math.round(5 + (i / expressions.length) * 90);
        await this.expressionBoardService.updateProgress(expressionBoardId, progress);

        this.logger.log(`Generating expression ${i + 1}/${expressions.length}: ${expression}`);

        try {
          // Build prompt from template
          const prompt = this.buildExpressionPrompt(subjectProfile, expression);

          // For angle shots after Front Neutral, use the Front Neutral as reference if available
          let referenceUrl = faceReferenceUrl;
          if (hasAnglesBoard && expression !== 'Front Neutral' && cellUrls['Front Neutral']) {
            referenceUrl = cellUrls['Front Neutral'];
          }

          // Generate using image-to-image with reference face
          const result = await this.geminiService.generateReferenceImage(
            referenceUrl,
            prompt,
          );

          if (!result.imageBase64) {
            throw new Error(`Failed to generate image for ${expression}`);
          }

          totalCost += 2; // ~$0.02 per generation

          // Upload to permanent storage
          const cellBuffer = Buffer.from(result.imageBase64, 'base64');
          const extension = result.mimeType.includes('png') ? 'png' : 'jpg';
          const safeExpression = expression.toLowerCase().replace(/[^a-z0-9]/g, '_');
          const cellPath = `${expressionBoardId}/cell_${safeExpression}_${Date.now()}.${extension}`;
          const { url: uploadedCellUrl } = await this.supabase.uploadFile(
            'expression-boards',
            cellPath,
            cellBuffer,
            result.mimeType,
          );

          cellUrls[expression] = uploadedCellUrl;
          cellData.push({ url: uploadedCellUrl, label: expression });

          this.logger.log(`Expression ${expression} generated: ${uploadedCellUrl}`);
        } catch (cellError) {
          this.logger.error(`Failed to generate expression for ${expression}: ${cellError}`);
          // Continue with other expressions
        }
      }

      // Check if we have enough cells
      if (cellData.length === 0) {
        throw new Error('No expressions were generated successfully');
      }

      // Assemble the grid
      await this.expressionBoardService.updateProgress(expressionBoardId, 97);
      this.logger.log('Assembling expression grid...');

      // Determine grid columns based on board types
      const columns = board.board_types.length >= 3 ? 4 : 2;

      const gridUrl = await this.ffmpegService.assembleEmotionGrid(
        cellData,
        columns,
        expressionBoardId,
      );

      // Mark as completed
      await this.expressionBoardService.markCompleted(
        expressionBoardId,
        gridUrl,
        cellUrls,
        totalCost,
      );

      this.logger.log(`=== EXPRESSION BOARD COMPLETED ===`);
      this.logger.log(`Board URL: ${gridUrl}`);
      this.logger.log(`Expressions generated: ${cellData.length}/${expressions.length}`);
      this.logger.log(`Total cost: $${(totalCost / 100).toFixed(2)}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Expression board generation failed: ${errorMessage}`);
      await this.expressionBoardService.markFailed(expressionBoardId, errorMessage);
      throw error;
    }
  }

  /**
   * Analyze the reference face image to extract subject profile details
   * Returns all the template variables needed for prompt generation
   */
  private async analyzeSubjectProfile(imageUrl: string): Promise<SubjectProfile> {
    const analysisPrompt = `Analyze this face photo and provide a detailed subject profile for image generation prompts.

Return ONLY valid JSON with these exact fields (be specific and descriptive):
{
  "hairColor": "specific hair color like 'light brown dirty blonde', 'jet black', 'fiery red', 'platinum blonde'",
  "hairStyle": "specific style like 'medium-long straight hair past shoulders', 'short textured fade on sides', 'wavy shoulder-length'",
  "eyeColor": "specific eye color like 'green-hazel', 'deep brown', 'bright blue', 'amber'",
  "skinTone": "detailed skin description like 'fair skin with light tan and some freckles', 'warm olive complexion', 'deep brown skin with smooth texture'",
  "faceShape": "face shape with features like 'oval face with defined cheekbones', 'round face with soft features', 'angular face with strong jawline'",
  "distinguishing": "notable features like 'natural eyebrows, small straight nose, full natural pink lips', 'thick brows, aquiline nose, thin lips', 'beauty mark on left cheek'",
  "gender": "woman, man, or person",
  "ageDesc": "age descriptor like 'young', 'middle-aged', 'elderly', or specific like 'early 20s', 'mid 30s'"
}

Be observational and specific. These details will be used to maintain identity consistency across generated images.`;

    try {
      const response = await this.geminiService.analyzeImageStructured(imageUrl, analysisPrompt);

      // Parse the JSON response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const profile = JSON.parse(jsonMatch[0]) as SubjectProfile;
      return profile;
    } catch (error) {
      this.logger.warn(`Failed to analyze subject profile, using defaults: ${error}`);
      // Return sensible defaults
      return {
        hairColor: 'natural hair color',
        hairStyle: 'natural hairstyle',
        eyeColor: 'natural eye color',
        skinTone: 'natural skin tone with realistic texture',
        faceShape: 'natural face shape',
        distinguishing: 'natural features',
        gender: 'person',
        ageDesc: 'adult',
      };
    }
  }

  /**
   * Build the full prompt for a specific expression using the template format
   */
  private buildExpressionPrompt(profile: SubjectProfile, expression: string): string {
    const expressionDesc = EXPRESSION_PROMPTS[expression] || `${expression} expression`;

    // Base template from expression_board_templates.md
    return `Portrait photograph of a ${profile.ageDesc} ${profile.gender} with ${profile.hairColor} ${profile.hairStyle}, ${profile.eyeColor} eyes, ${profile.distinguishing}, ${profile.skinTone}, ${profile.faceShape}. ${expressionDesc} Natural iPhone photo aesthetic, indoor background, natural lighting, casual unposed look, high quality authentic feel.

CRITICAL IDENTITY PRESERVATION:
- Maintain EXACT facial features from reference image
- Same bone structure, proportions, and distinctive features
- Same skin texture and imperfections
- Same hair color and style

The image should feel like a genuine smartphone photo - real, imperfect, human, and unretouched.`;
  }

  /**
   * Resolve the face reference URL based on source type
   */
  private async resolveFaceReference(board: {
    source_type: string;
    source_image_url: string | null;
    lora_id: string | null;
    character_diagram_id: string | null;
    reference_kit_id: string | null;
  }): Promise<string> {
    switch (board.source_type) {
      case 'image':
      case 'video':
      case 'zip':
        if (!board.source_image_url) {
          throw new Error('Source image URL is required for this source type');
        }
        return board.source_image_url;

      case 'lora':
        if (!board.lora_id) {
          throw new Error('LoRA ID is required for lora source type');
        }
        // Get LoRA's training image or generate a reference face
        const { data: lora } = await this.supabase.getClient()
          .from('lora_models')
          .select('training_images_url, trigger_word')
          .eq('id', board.lora_id)
          .single();

        if (!lora) {
          throw new Error('LoRA model not found');
        }

        // Generate a reference face from the LoRA
        const facePrompt = `${lora.trigger_word || 'person'} portrait photo, face closeup, looking at camera, neutral expression, plain background, high quality, natural iPhone photo aesthetic`;
        const faceResult = await this.geminiService.generateImages({
          prompt: facePrompt,
          num_images: 1,
          aspect_ratio: '1:1',
        });

        if (!faceResult?.[0]?.base64) {
          throw new Error('Failed to generate reference face from LoRA');
        }

        // Upload the generated face and return URL
        const buffer = Buffer.from(faceResult[0].base64, 'base64');
        const { url } = await this.supabase.uploadFile(
          'expression-boards',
          `lora-refs/${board.lora_id}_${Date.now()}.jpg`,
          buffer,
          faceResult[0].mimeType,
        );
        return url;

      case 'character':
        if (!board.character_diagram_id) {
          throw new Error('Character diagram ID is required for character source type');
        }
        const { data: diagram } = await this.supabase.getClient()
          .from('character_diagrams')
          .select('source_image_url')
          .eq('id', board.character_diagram_id)
          .single();

        if (!diagram?.source_image_url) {
          throw new Error('Character diagram source image not found');
        }
        return diagram.source_image_url;

      case 'reference_kit':
        if (!board.reference_kit_id) {
          throw new Error('Reference kit ID is required for reference_kit source type');
        }
        const kit = await this.supabase.getReferenceKit(board.reference_kit_id);
        if (!kit?.anchor_face_url) {
          throw new Error('Reference kit anchor face not found');
        }
        return kit.anchor_face_url;

      default:
        throw new Error(`Unknown source type: ${board.source_type}`);
    }
  }
}
