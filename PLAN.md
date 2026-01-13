# Reference Kit Implementation Plan

## Overview

Add a new identity creation method called "Reference Kit" that generates multiple reference images from a single source photo using Gemini's native image generation. These references are then used with each generation request to maintain identity consistency.

**Key Benefits:**
- Zero training time (vs ~1 hour for LoRA)
- ~$0.20 cost (vs ~$5 for LoRA)
- Works with AI-generated characters
- Faster iteration for prototyping

---

## Phase 1: Database & Backend Foundation

### 1.1 Database Migration
**File:** `supabase/migrations/00010_reference_kits.sql`

```sql
-- Reference Kits table
CREATE TABLE IF NOT EXISTS reference_kits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,

  -- Source
  source_image_url TEXT NOT NULL,

  -- Core references (required)
  anchor_face_url TEXT,           -- Clean, neutral, front-facing
  profile_url TEXT,               -- 3/4 profile view

  -- Extended references (optional)
  half_body_url TEXT,             -- Waist up
  full_body_url TEXT,             -- Head to toe

  -- Expression variants (JSONB for flexibility)
  expressions JSONB DEFAULT '{}', -- {smile: url, serious: url, etc}

  -- Metadata
  status VARCHAR(50) DEFAULT 'pending',
  generation_progress JSONB DEFAULT '{}',
  error_message TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reference_kits_created_at ON reference_kits(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reference_kits_status ON reference_kits(status);
```

### 1.2 Supabase Service Methods
**File:** `apps/api/src/modules/files/supabase.service.ts`

Add interface and CRUD methods:
- `DbReferenceKit` interface
- `createReferenceKit()`
- `getReferenceKit()`
- `updateReferenceKit()`
- `listReferenceKits()`
- `deleteReferenceKit()`

### 1.3 Queue Registration
**File:** `apps/api/src/modules/jobs/queues.constants.ts`

Add: `REFERENCE_KIT: 'reference-kit'`

---

## Phase 2: Backend Module

### 2.1 Module Structure
Create `apps/api/src/modules/reference-kit/`:

```
reference-kit/
├── reference-kit.module.ts
├── reference-kit.controller.ts
├── reference-kit.service.ts
├── reference-kit.prompts.ts      # Generation prompts
└── dto/
    ├── create-reference-kit.dto.ts
    └── regenerate-reference.dto.ts
```

### 2.2 Controller Endpoints
**File:** `apps/api/src/modules/reference-kit/reference-kit.controller.ts`

```typescript
// CRUD
POST   /api/reference-kits              - Create new kit (starts generation)
GET    /api/reference-kits              - List all kits
GET    /api/reference-kits/:id          - Get single kit
DELETE /api/reference-kits/:id          - Delete kit
PATCH  /api/reference-kits/:id          - Update name

// Generation
POST   /api/reference-kits/:id/regenerate/:type - Regenerate specific reference
// type: anchor | profile | half_body | full_body | expression_smile | etc
```

### 2.3 Service Logic
**File:** `apps/api/src/modules/reference-kit/reference-kit.service.ts`

Key methods:
- `create(dto)` - Create record + queue generation job
- `regenerate(kitId, type)` - Queue regeneration for specific image
- `getReferenceUrls(kitId)` - Get all reference URLs for generation
- `delete(kitId)` - Delete kit + storage files

### 2.4 Generation Prompts
**File:** `apps/api/src/modules/reference-kit/reference-kit.prompts.ts`

Store identity-preservation prompts:
- `ANCHOR_PROMPT` - Front-facing, passport-style
- `PROFILE_PROMPT` - 3/4 angle view
- `HALF_BODY_PROMPT` - Waist up with body proportions
- `FULL_BODY_PROMPT` - Head to toe
- `EXPRESSION_PROMPTS` - Smile, serious, surprised, etc.

---

## Phase 3: Job Processor

### 3.1 Processor Implementation
**File:** `apps/api/src/modules/jobs/processors/reference-kit.processor.ts`

```typescript
@Processor(QUEUES.REFERENCE_KIT)
export class ReferenceKitProcessor extends WorkerHost {
  async process(job: Job<ReferenceKitJobData>) {
    switch (job.name) {
      case 'generate-kit':
        return this.generateFullKit(job);
      case 'regenerate-reference':
        return this.regenerateSingle(job);
    }
  }

  private async generateFullKit(job) {
    // 1. Generate anchor face (required)
    // 2. Generate profile (required)
    // 3. Generate half-body (if requested)
    // 4. Generate full-body (if requested)
    // 5. Generate expressions (if requested)
    // Update progress after each step
  }

  private async regenerateSingle(job) {
    // Regenerate just one reference type
  }
}
```

### 3.2 Gemini Service Extension
**File:** `apps/api/src/services/gemini.service.ts`

Add method for reference generation:
```typescript
async generateReferenceImage(
  sourceImageUrl: string,
  prompt: string
): Promise<{ imageBase64: string; mimeType: string }>
```

Uses Gemini's image-to-image capability with identity-preservation prompts.

---

## Phase 4: Frontend API Client

### 4.1 API Types & Methods
**File:** `apps/web/src/lib/api.ts`

```typescript
export interface ReferenceKit {
  id: string;
  name: string;
  sourceImageUrl: string;
  anchorFaceUrl: string | null;
  profileUrl: string | null;
  halfBodyUrl: string | null;
  fullBodyUrl: string | null;
  expressions: Record<string, string>;
  status: 'pending' | 'generating' | 'ready' | 'failed';
  generationProgress: Record<string, string>;
  errorMessage: string | null;
  createdAt: string;
}

export const referenceKitApi = {
  list: () => fetchApiSilent<ReferenceKit[]>('/reference-kits', []),
  get: (id: string) => fetchApi<ReferenceKit>(`/reference-kits/${id}`),
  create: (data: CreateReferenceKitRequest) =>
    fetchApi<ReferenceKit>('/reference-kits', { method: 'POST', body: JSON.stringify(data) }),
  delete: (id: string) =>
    fetchApi<{ success: boolean }>(`/reference-kits/${id}`, { method: 'DELETE' }),
  update: (id: string, data: { name: string }) =>
    fetchApi<ReferenceKit>(`/reference-kits/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  regenerate: (id: string, type: string) =>
    fetchApi<{ success: boolean }>(`/reference-kits/${id}/regenerate/${type}`, { method: 'POST' }),
};
```

---

## Phase 5: Frontend Pages

### 5.1 Reference Kit List Page
**File:** `apps/web/src/app/reference-kits/page.tsx`

Features:
- Grid of reference kits with source image thumbnails
- Status badges (Pending, Generating, Ready, Failed)
- Reference count display
- Create new button
- Delete action

### 5.2 Reference Kit Creator/Editor Page
**File:** `apps/web/src/app/reference-kits/[id]/page.tsx` (or modal)

Features:
- Name input
- Source image upload or selection from generated images
- Options checkboxes:
  - Generate extended (half-body, full-body)
  - Expression selection (smile, serious, surprised, angry)
- Generated references grid with:
  - Thumbnail preview
  - Status indicator
  - Regenerate button per reference
- Progress polling during generation

### 5.3 Navigation Update
**File:** `apps/web/src/components/sidebar.tsx`

Add to `toolsNavigation`:
```typescript
{ name: 'Reference Kits', href: '/reference-kits', icon: Users },
```

---

## Phase 6: Image Generator Integration

### 6.1 Identity Source Update
**File:** `apps/web/src/app/image-generator/page.tsx`

Update `IdentitySource` type:
```typescript
type IdentitySource = 'lora' | 'character-diagram' | 'reference-kit';
```

Add Reference Kit tab/selector alongside LoRA and Character Diagram.

### 6.2 Backend Processing
**File:** `apps/api/src/modules/jobs/processors/image-generation.processor.ts`

Add new mode: `'reference-kit-generation'`

For text-to-image with Reference Kit:
- Get all reference URLs from kit
- Pass to Gemini with identity-preservation prompt wrapper
- Generate images maintaining identity

For face swap with Reference Kit:
- Use anchor_face_url as the face source
- Call fal-ai/face-swap same as Character Diagram

### 6.3 Service Updates
**File:** `apps/api/src/modules/image-generation/image-generation.service.ts`

Handle `referenceKitId` in request:
- Validate kit exists and is ready
- Determine mode (text-to-image vs face-swap)
- Queue appropriate job

---

## Implementation Order

1. **Database** - Migration for reference_kits table
2. **Supabase Service** - CRUD methods
3. **Queue Constant** - Add REFERENCE_KIT
4. **Backend Module** - Controller, Service, DTOs
5. **Prompts** - Identity-preservation prompt constants
6. **Processor** - Job processing with Gemini
7. **API Client** - Frontend types and methods
8. **List Page** - View all reference kits
9. **Creator Page** - Create and manage kits
10. **Navigation** - Add sidebar link
11. **Image Generator** - Add Reference Kit as identity source
12. **Testing** - End-to-end flow verification

---

## Cost Breakdown

| Reference Type | Gemini Cost | Count |
|---------------|-------------|-------|
| Anchor Face | ~$0.02 | 1 |
| Profile | ~$0.02 | 1 |
| Half Body | ~$0.02 | 0-1 |
| Full Body | ~$0.02 | 0-1 |
| Expression | ~$0.02 | 0-4 |

**Minimum kit (2 refs):** ~$0.04
**Full kit (6 refs):** ~$0.12
**Extended kit (10 refs):** ~$0.20

---

## Out of Scope (Future)

- Using Reference Kit for video face swap
- Automatic quality validation
- Reference Kit sharing
- Import from external tools
- Batch Reference Kit creation
