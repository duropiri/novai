# PROJECT_PLAN.md — AI Content Creation Platform

> **Purpose:** This document outlines the build phases for Claude Code to follow. Reference this when starting new sessions or deciding what to work on next.

---

## Project Overview

**What we're building:** A single-user AI content creation platform for generating face-swapped videos using LoRAs, character reference diagrams, and bulk variant generation.

**Tech Stack:**
- Frontend: Next.js 14 (App Router), TailwindCSS, Shadcn/UI
- Backend: NestJS
- Database: Supabase (PostgreSQL + Storage)
- Queue: BullMQ with Redis
- Structure: Turborepo monorepo

---

## External APIs — Direct Model Access

We use the **actual source models** directly, not wrapper platforms.

| Feature | Model | API Provider | Cost | Notes |
|---------|-------|--------------|------|-------|
| **LoRA Training** | WAN 2.2 14B | fal.ai | ~$4.50/LoRA | `fal-ai/wan-22-image-trainer` |
| **Character Diagram** | Gemini 3.0 Pro Image | Google Gemini API | ~$0.02/image | Model: `gemini-3-pro-image-preview` |
| **Face Swap / Video** | WAN | fal.ai | Variable | Uses trained LoRA for identity transfer |
| **Video Upscaling** | Real-ESRGAN | Replicate | ~$0.01/image | Alternative to Topaz (no API) |
| **Variant Generation** | FFmpeg | Local | Free | Text overlay, audio replacement |

**Why these choices:**
- **fal.ai WAN** handles both LoRA training AND video generation with identity transfer
- **Google Gemini** is the actual model behind "Nano Banana Pro" (Higgsfield just wraps it)
- **Topaz Video AI** has no public API — use Real-ESRGAN as alternative

---

## Understanding the LoRA → Face Swap Workflow

**Important:** WAN uses the trained LoRA directly for identity-preserving video generation.

```
1. Train LoRA on model photos → captures identity (face, features, style)
2. Generate Character Diagram using source photo → provides pose/outfit reference
3. Face Swap uses ALL THREE inputs:
   └── Source Video: The video to transform
   └── Character Diagram: Pose and appearance reference
   └── LoRA: Identity (face) to apply via WAN model
```

The LoRA is a **required input** that WAN uses to maintain identity consistency in the output video.

---

## Database Schema

```sql
-- LoRAs (trained models)
lora_models: id, name, trigger_word, status, training_images_url, training_steps,
             weights_url, config_url, thumbnail_url, cost_cents, error_message,
             created_at, updated_at, completed_at

-- Character Diagrams (generated reference sheets)
character_diagrams: id, name, source_image_url, file_url, status, cost_cents,
                    error_message, created_at, updated_at

-- Collections (organize videos and audio)
collections: id, name, type ('video' | 'audio'), created_at, updated_at

-- Videos (source and processed)
videos: id, name, type ('source' | 'face_swapped' | 'variant'), collection_id (FK),
        parent_video_id (FK), character_diagram_id (FK), file_url, thumbnail_url,
        duration_seconds, width, height, file_size_bytes, created_at, updated_at

-- Audio (for variants)
audio_files: id, name, collection_id (FK), file_url, duration_seconds,
             file_size_bytes, created_at

-- Hooks (text overlays for variants)
hooks: id, text, category, created_at

-- Jobs (unified job tracking)
jobs: id, type, reference_id, status, progress, external_request_id, external_status,
      input_payload, output_payload, error_message, cost_cents, created_at,
      started_at, completed_at

-- Cost Records (for credits display)
cost_records: id, job_id (FK), job_type, amount_cents, description, created_at
```

---

## App Structure

```
Sidebar Navigation:
├── Dashboard
│   ├── Storage Overview (counts by type, total storage)
│   ├── Recent Activity
│   └── Active Jobs
├── Tools
│   ├── LoRA Creator
│   ├── Character Diagram Generator
│   ├── AI Swapper
│   └── Variant Generator
├── Library
│   ├── Video Collections
│   ├── Audio Collections
│   ├── Character Diagrams
│   ├── LoRAs
│   └── Hooks
└── [Bottom of sidebar]
    └── Credits: $XX.XX spent (from cost_records)
```

**Credits Display:**
- Shows total API spend from cost_records table
- Updates after each job completes
- Visible at bottom-left of sidebar
- Click to see breakdown by type on Dashboard

---

## Build Phases

### ✅ Phase 1: Foundation
> **Goal:** Project setup, database, basic UI shell

- [x] Initialize Turborepo monorepo with Next.js 14 + NestJS
- [x] Configure TailwindCSS + Shadcn/UI
- [x] Configure Supabase (database schema + storage buckets)
- [x] Set up Redis + BullMQ job queue infrastructure
- [x] Build file upload system with Supabase Storage
- [x] Create job management API and database operations
- [x] Build dashboard shell with sidebar navigation

**Deliverable:** Navigable app shell with database ready

---

### ✅ Phase 2: LoRA Training Pipeline
> **Goal:** Train custom LoRAs from uploaded images using fal.ai Wan 2.2

**UI Components:**
- Multi-image upload zone (drag & drop)
- Guidelines panel (always visible):
  - ✅ High quality JPEG images
  - ✅ Full body and close-up faces
  - ✅ Even lighting
  - ❌ No glasses, hats, masks
  - ❌ No phones in hand
  - ❌ No other people
  - ❌ No blurry photos
- Image grid with thumbnails + remove buttons
- Model name input (becomes trigger phrase)
- Thumbnail selector
- Cost display (~$4.50)
- Training status card with progress

**API Flow:**
```
1. User uploads images → Supabase Storage /temp
2. User enters name, selects thumbnail
3. User clicks "Start Training"
4. Backend creates ZIP from images
5. Backend calls fal.ai wan-22-image-trainer
6. Backend creates lora record (status='training')
7. Backend polls fal.ai for completion (~1 hour)
8. On completion: download .safetensors weights
9. Store in Supabase /lora-weights, update record (status='ready')
```

**Tasks:**
- [x] Create LoRA Creator page UI
- [x] Implement multi-image upload with preview
- [x] Add guideline validation (visual warnings)
- [x] Create ZIP generation endpoint (client-side with JSZip)
- [x] Integrate fal.ai LoRA training API
- [x] Build training status polling/webhook handler
- [x] Handle .safetensors download and storage
- [x] Create LoRA library view

---

### ✅ Phase 3: Character Diagram Generator
> **Goal:** Generate reference sheets using Google Gemini 3.0 Pro Image

**Purpose:** Creates full-body + face close-up reference showing outfit, proportions, and appearance. The face closeup is used as the face source for swapping.

**Output Format:** Single image with two views side-by-side:
- Left: Full-body standing shot (head to toe, neutral background)
- Right: High-resolution face close-up

**UI Components:**
- Single image upload zone
- Optional name input (auto-generates if blank)
- Preview of uploaded image
- Generate button
- Result preview with download
- Auto-saves to library on completion

**API: Google Gemini**
```
Endpoint: https://generativelanguage.googleapis.com/v1alpha/models/gemini-3-pro-image-preview:generateContent
Input: Source image + character diagram prompt
Output: Combined reference sheet image
```

**The Prompt:**
```
Using the attached image as the sole visual reference, create a character reference sheet rendered entirely in a realistic photographic style.
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
- No exaggerated proportions or AI-invented designs
```

**Tasks:**
- [x] Create Character Diagram page UI
- [x] Implement single image upload
- [x] Integrate fal.ai Flux Kontext (to be migrated to Gemini API)
- [x] Store prompt in backend config
- [x] Handle async generation
- [x] Save results to character_diagrams table
- [x] Migrate from fal.ai to Google Gemini API

---

### ✅ Phase 4: AI Swapper (Face Swap)
> **Goal:** Face-swap videos using fal.ai WAN API with trained LoRA

**How It Works:**
- Source Video: The viral/template video to transform
- Character Diagram: Provides pose and appearance reference
- LoRA: Provides identity (face) to apply — **REQUIRED**
- Output: Video with identity-transferred face

**UI Layout:** Two-column layout
- Left column: Stacked selection boxes + Generate button
- Right column: Results panel (recent jobs + preview)

**Left Column - Stacked Selectors:**
```
┌─────────────────────────────┐
│ 1. Select Source Video      │  ← Video to transform
│    [Dropdown/grid picker]   │
│    [Video preview]          │
├─────────────────────────────┤
│ 2. Select Character Diagram │  ← Pose/appearance reference
│    [Grid of diagrams]       │
│    [Selected preview]       │
├─────────────────────────────┤
│ 3. Select LoRA (REQUIRED)   │  ← Identity to apply
│    [Grid of trained LoRAs]  │
│    [Selected preview]       │
├─────────────────────────────┤
│ Cost: ~$X.XX (variable)     │
├─────────────────────────────┤
│ [    Generate Face Swap   ] │
└─────────────────────────────┘
```

**API: fal.ai WAN**
```
- WAN model via fal.ai API
- Uses trained LoRA for identity preservation
- Input: Source video + Character diagram + LoRA weights
- Output: Identity-transferred video
```

**API Flow:**
```
1. User selects video from collection
2. User selects character diagram
3. User selects trained LoRA (required)
4. User clicks Generate
5. Backend calls fal.ai WAN API with:
   - Source video URL
   - Character diagram URL (pose reference)
   - LoRA weights URL (identity)
6. Create job record, poll for completion
7. Download result → Supabase /processed-videos
8. Show in results panel
```

**Tasks:**
- [x] Set up fal.ai WAN API integration for face swap
- [x] Create AI Swapper page UI (two-column layout)
- [x] Build video selector component
- [x] Build character diagram selector component
- [x] Build LoRA selector component (required)
- [x] Create fal.ai service for face swap
- [x] Build job queue for swap processing
- [x] Create results panel with job history
- [x] Handle result download and storage
- [x] Connect frontend to swap API

---

### ✅ Phase 5: Variant Generator
> **Goal:** Create video variants with different audio/hooks using collections

**Purpose:** Generate multiple versions of videos with different audio tracks and text hooks for multi-account posting. Bypasses duplicate content detection.

**Key Concept: Collections**
- Videos and audio are organized into named collections
- Users select entire collections, not individual files
- This simplifies the UI and matches the original workflow

**UI Components:**
- Video Collection selector (dropdown of collections)
  - Shows: collection name, video count, total duration
- Audio Collection selector (dropdown of collections)
  - Shows: collection name, audio count
- Hooks multi-select (from library)
- Combination calculator display:
  - "X videos × Y audio × Z hooks = N possible combinations"
- Settings:
  - Quantity (how many to generate, max = total combinations)
  - Text position: Top / Center / Bottom
  - Text style: Outline / Solid / Shadow
- Batch name input
- Start button
- Active batches with progress bars
- Completed batches with download + expiry countdown

**Generation Logic (Round-Robin):**
```
1. Load all videos from selected video collection
2. Load all audio from selected audio collection
3. Load selected hooks
4. Shuffle each list
5. For each variant (up to quantity):
   - Pick next video (cycling)
   - Pick next audio (cycling)
   - Pick next hook (cycling)
6. FFmpeg operations:
   - Overlay hook text at position/style
   - Replace audio track
   - Apply slight crop (1-3%) for uniqueness
7. Package into ZIP organized by source video
8. Set 24-hour expiry
```

**FFmpeg Commands:**
```bash
# Text overlay
ffmpeg -i input.mp4 -vf "drawtext=text='Hook':fontsize=48:fontcolor=white:borderw=2:bordercolor=black:x=(w-text_w)/2:y=50" output.mp4

# Audio replacement
ffmpeg -i video.mp4 -i audio.mp3 -c:v copy -map 0:v:0 -map 1:a:0 output.mp4

# Slight crop for uniqueness
ffmpeg -i input.mp4 -vf "crop=iw*0.98:ih*0.98:iw*0.01:ih*0.01" output.mp4
```

**Tasks:**
- [x] Create collections table and API
- [x] Create Video Collections page (CRUD + upload into collection)
- [x] Create Audio Collections page (CRUD + upload into collection)
- [x] Create Variant Generator page UI
- [x] Build collection selector components
- [x] Build hooks multi-select component
- [x] Implement combination calculator
- [x] Create round-robin assignment logic
- [x] Set up FFmpeg in NestJS (fluent-ffmpeg)
- [x] Build batch processing queue
- [x] Implement progress tracking
- [x] Create ZIP packaging (archiver npm package)
- [x] Handle 24-hour expiry cleanup

---

### ✅ Phase 6: Library & Resource Management
> **Goal:** Full CRUD for all resources, organized with collections

**Video Collections Page:** `/library/videos`
- [x] Collection selector dropdown with item counts
- [x] Create new collection button
- [x] Video grid with thumbnails, duration, file size
- [x] Video playback preview dialog
- [x] Delete videos
- [x] Rename/delete collection

**Audio Collections Page:** `/library/audios`
- [x] Collection selector dropdown with item counts
- [x] Create new collection button
- [x] Audio list with play/pause, duration, file size
- [x] In-browser audio playback
- [x] Delete audio files
- [x] Rename/delete collection

**Character Diagrams Page:** `/library/images`
- [x] Grid view of all diagrams with status badges
- [x] Processing status indicators
- [x] Image preview dialog
- [x] Delete actions
- [x] Link to Character Diagrams tool

**LoRA Library Page:** `/library/models`
- [x] Grid of cards: thumbnail, name, trigger phrase, status badge
- [x] Training progress for in-progress items
- [x] Click for details modal (weights URL, cost, dates)
- [x] Copy trigger word to clipboard
- [x] Delete models
- [x] Upload LoRA button (for external .safetensors files)

**Hooks Page:** `/library/hooks`
- [x] Add form (text + optional category)
- [x] List: text preview, category tag, edit/delete
- [x] Bulk add (paste multiple, one per line)
- [x] Category filter dropdown

**Tasks:**
- [x] Create Video Collections page
- [x] Create Audio Collections page
- [x] Create collection detail views
- [x] Implement upload into collection
- [x] LoRA upload flow complete (backend + frontend)
- [x] Create Hooks page
- [x] Add bulk operations where needed
- [x] Create Images (character diagrams) library page
- [x] Create Models (LoRA) library page

---

### ✅ Phase 7: Dashboard & Polish
> **Goal:** Production-ready application with useful dashboard

**Dashboard Components:**
- Storage Overview card:
  - LoRAs: X models (Y ready, Z training)
  - Character Diagrams: X total
  - Video Collections: X collections, Y videos
  - Audio Collections: X collections, Y files
  - Hooks: X total
  - Total Storage: XX MB used
- Credits Summary card:
  - Total spent: $XX.XX
  - Breakdown by type (pie chart or list)
  - Link to detailed cost history
- Active Jobs card:
  - List of in-progress jobs with progress bars
  - Click to navigate to relevant page
- Recent Activity:
  - Last 5-10 completed jobs
  - Quick actions (view result, re-run, etc.)

**Tasks:**
- [x] Build Dashboard with Storage Overview
- [x] Add Credits display to sidebar
- [x] Create Credits breakdown view (`/credits` page)
- [x] Active jobs widget (on Dashboard, auto-refreshes)
- [x] Error handling improvements (ApiError class, user-friendly messages)
- [x] Loading states and skeleton loaders
- [x] Migrate Character Diagram to Google Gemini API (already using gemini-2.0-flash-exp)
- [x] Test all workflows end-to-end (TypeScript verification, build passes)

---

## Session Guidelines

### Starting a Session
1. Check current phase status above
2. Identify next uncompleted task
3. Enter Plan Mode (Shift+Tab twice) for major features
4. Get approval before implementing

### During Development
- Keep changes simple and minimal
- One logical change at a time
- Explain what you changed after each step
- If hitting complexity, stop and discuss

### Ending a Session
Run this verification:
```
Review all work from this session:
1. Does everything follow CLAUDE.md rules?
2. Any security vulnerabilities?
3. Is code as simple as possible?
4. Any bugs or edge cases missed?
5. Does ARCHITECTURE.md need updating?
6. Update the phase checklist in PROJECT_PLAN.md

Fix issues and summarize what was accomplished.
```

### Updating This Document
After completing tasks, mark them with [x] and update phase status:
- ⏳ = In Progress
- ✅ = Complete
- ❌ = Blocked

---

## Key Decisions Log

| Date | Decision | Reasoning |
|------|----------|-----------|
| 2026-01-08 | Use direct source models, not wrappers | Higgsfield/fal.ai wrap underlying models — go direct |
| 2026-01-08 | Google Gemini for character diagrams | "Nano Banana Pro" is Gemini 3.0 Pro Image |
| 2026-01-08 | fal.ai WAN for both LoRA training AND face swap | WAN handles identity via LoRA directly |
| 2026-01-08 | LoRA is REQUIRED input for face swap | WAN uses trained LoRA for identity preservation |
| - | Cloud-only (no GPU) | Simpler, matches original workflow, pay-per-use |
| - | Monorepo with Turborepo | Shared types, simpler development |
| - | Collections for videos/audio | Simplifies variant generator workflow |
| - | Credits as display-only | Single user doesn't need prepaid system |
| - | FFmpeg for variants | Local processing, no API costs |
| - | Support LoRA upload + training | Users may have external .safetensors files |

---

## Environment Variables Needed

```env
# Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Google Gemini API (for character diagrams)
GOOGLE_GEMINI_API_KEY=

# fal.ai (for LoRA training AND face swap)
FAL_API_KEY=

# Replicate (for upscaling - optional)
REPLICATE_API_TOKEN=

# Redis (for BullMQ)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# App
NEXT_PUBLIC_API_URL=http://localhost:3001
```

---

## API Reference Quick Links

- **fal.ai WAN 2.2 Trainer:** https://fal.ai/models/fal-ai/wan-22-image-trainer
- **fal.ai WAN (Video):** https://fal.ai/models/fal-ai/wan
- **Google Gemini API:** https://ai.google.dev/gemini-api/docs/gemini-3

---

*Last updated: 2026-01-08 — ALL PHASES COMPLETE. Corrected API architecture: fal.ai WAN handles both LoRA training and face swap (not Picsi.ai).*
