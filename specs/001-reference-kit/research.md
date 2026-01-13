# Research: Reference Kit Workflow

**Feature Branch**: `001-reference-kit`
**Date**: 2026-01-12

## Research Questions

### 1. Gemini Image Generation API

**Question**: How to pass source image as reference for generation?

**Finding**: The existing `GeminiService` already implements this pattern in `generateCharacterDiagram()`:

```typescript
const contents = [
  {
    role: 'user',
    parts: [
      { text: PROMPT },
      {
        inlineData: {
          mimeType: imageData.mimeType,
          data: imageData.base64,
        },
      },
    ],
  },
];
```

**Decision**: Create a new method `generateReferenceImage(sourceImageUrl: string, prompt: string)` that:
1. Downloads source image as base64 (existing helper)
2. Sends prompt + image to Gemini
3. Returns generated image base64

**Rationale**: Reuses proven pattern; only difference is the prompt text.

---

### 2. Multi-image Generation

**Question**: Can Gemini generate multiple variants in sequence efficiently?

**Finding**:
- Gemini API is stateless; each call is independent
- No batch generation endpoint available
- Current model: `gemini-3-pro-image-preview` (Nano Banana Pro)
- Rate limits: ~10 requests/minute for image generation (based on standard Gemini limits)

**Decision**: Generate references sequentially with progress tracking:
1. Anchor face first (most critical)
2. Profile second
3. Extended (half-body, full-body) if enabled
4. Expressions last (optional)

**Rationale**:
- Sequential generation is simpler to track and debug
- Allows real-time progress updates per reference
- Handles partial failures gracefully (some refs succeed, others retry)
- Rate limiting naturally handled by queue processing

**Alternative Rejected**: Parallel generation was considered but rejected because:
- Would need complex error handling
- Rate limits could cause cascading failures
- Progress tracking becomes complicated
- No significant time savings (total ~2-3 minutes vs ~3-4 parallel)

---

### 3. Identity Preservation

**Question**: What prompt patterns work best for maintaining identity?

**Finding**: The user-provided prompts in the spec follow best practices:
- Explicit instruction to preserve specific features (freckles, pore texture, bone structure)
- Direct negations ("Do NOT rotate", "Do NOT stylize")
- Reference to "same person" language
- Request for neutral conditions (lighting, background)

**Decision**: Use prompts exactly as provided in spec. Store in `reference-kit.prompts.ts`:

```typescript
export const REFERENCE_PROMPTS = {
  anchor: `Recreate this same person in a completely front-facing...`,
  profile: `Rebuild this same person from a ¾ profile view...`,
  half_body: `Create a half-body portrait of this same person...`,
  full_body: `Create a full-body standing portrait...`,
  expressions: {
    smile: `Create a natural, warm smiling expression...`,
    serious: `Create a serious, confident expression...`,
    surprised: `Create a surprised expression...`,
    angry: `Create a strong angry expression...`,
  }
};
```

**Rationale**: User has already tested these prompts; no need to reinvent.

---

### 4. Cost Estimation

**Question**: Confirm ~$0.02-0.04 per image generation

**Finding**: Based on Google Gemini pricing (as of 2025):
- Gemini 3 Pro Image: ~$0.02-0.04 per image generation
- Input tokens (prompt + image): minimal cost
- Output: image generation is the primary cost

**Estimated Cost per Reference Kit**:
| References | Count | Est. Cost |
|------------|-------|-----------|
| Core (anchor + profile) | 2 | ~$0.04-0.08 |
| Extended (+half, +full) | 4 | ~$0.08-0.16 |
| Full (+ 4 expressions) | 8 | ~$0.16-0.32 |

**Decision**: Estimate ~$0.20 per full kit (8 images) as stated in spec.

**Rationale**: Conservative estimate accounts for retries and potential rate adjustments.

---

### 5. Existing Codebase Patterns

**Question**: How do similar features structure their code?

**Finding**: Character Diagram module is the closest parallel:

| Aspect | Character Diagram | Reference Kit (Proposed) |
|--------|-------------------|-------------------------|
| Database | Single table with URLs | Single table with URL columns + JSONB |
| Job Queue | `QUEUES.CHARACTER_DIAGRAM` | `QUEUES.REFERENCE_KIT` |
| Processor | Generates 1 image | Generates 2-8 images sequentially |
| Progress | Binary (pending/done) | Granular per-reference |
| Service | Direct Gemini call | Multiple Gemini calls in loop |

**Decision**: Follow Character Diagram pattern with these enhancements:
1. Add `generation_progress` JSONB for per-reference status
2. Processor loops through required references
3. Update progress after each successful generation

**Rationale**: Maintains consistency; enhancements are additive, not restructuring.

---

## Summary of Decisions

| Decision | Choice | Key Reason |
|----------|--------|------------|
| API Pattern | Extend GeminiService | Reuse existing infrastructure |
| Generation Order | Sequential | Simpler progress tracking |
| Prompts | Use spec-provided prompts | Already tested |
| Progress Tracking | JSONB column | Granular per-reference updates |
| Cost Model | ~$0.20 per full kit | Conservative estimate |
| Module Pattern | Follow Character Diagram | Proven architecture |

---

## Implementation Notes

1. **GeminiService Extension**: Add `generateReferenceImage(sourceUrl, prompt)` method
2. **Progress JSONB Schema**: `{ anchor: 'done', profile: 'generating', half_body: 'pending', ... }`
3. **Error Handling**: Mark individual reference as 'failed', allow retry without full regeneration
4. **Cost Tracking**: Record cost per job (entire kit), not per individual image
