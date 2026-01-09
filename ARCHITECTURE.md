# ARCHITECTURE.md

> This document describes how NOVAI works inside and out. Keep it updated as the architecture evolves.

---

## Overview

**What this app does:**
AI Content Creation Platform for generating face-swapped videos using LoRAs, character reference diagrams, and bulk variant generation.

**Who it's for:**
Single user (content creator) who needs to produce face-swapped video content at scale.

---

## System Architecture

### High-Level Diagram
```
┌─────────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Next.js 14)                           │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐           │
│  │LoRA Creator│ │Character   │ │ AI Swapper │ │  Variant   │           │
│  │            │ │ Generator  │ │            │ │  Generator │           │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘           │
│  ┌─────────────────────────────────────────────────────────┐           │
│  │                    Library Section                       │           │
│  │  Videos │ Audios │ Hooks │ Images │ Models              │           │
│  └─────────────────────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          BACKEND (NestJS)                               │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐           │
│  │  Jobs API  │ │ Files API  │ │Collections │ │ Variants   │           │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘           │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐           │
│  │  LoRA API  │ │Character   │ │  Swap API  │ │ Audio/Hook │           │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘           │
│                                    │                                    │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │                    BullMQ Job Processor                       │      │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                 │      │
│  │  │ LoRA Q │ │CharGenQ│ │FaceSwpQ│ │VariantQ│                 │      │
│  │  └────────┘ └────────┘ └────────┘ └────────┘                 │      │
│  └──────────────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────────┘
          │                    │                    │
          ▼                    ▼                    ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│    Redis     │     │   Supabase   │     │ External APIs│
│   (BullMQ)   │     │  (PG + S3)   │     │fal/Gemini/   │
│              │     │              │     │Picsi/FFmpeg  │
└──────────────┘     └──────────────┘     └──────────────┘
```

### Key Components

| Component | Purpose | Location |
|-----------|---------|----------|
| Web App | Next.js 14 frontend with Shadcn/UI | `apps/web/` |
| API Server | NestJS backend with job queues | `apps/api/` |
| Job Processors | BullMQ workers for async tasks | `apps/api/src/modules/jobs/processors/` |
| Shared Types | Common TypeScript types | `packages/shared/` |

---

## Data Flow

### LoRA Training Flow
```
1. User uploads training images
2. Frontend creates ZIP and uploads to Supabase Storage
3. Backend creates job record and enqueues to LoRA queue
4. Worker calls fal.ai wan-22-image-trainer API
5. Worker polls for completion (~1 hour)
6. Worker downloads weights and stores in Supabase
7. Job marked complete, user notified
```

### Character Diagram Flow (Google Gemini)
```
1. User uploads source image
2. Backend downloads image, converts to base64
3. Backend calls Google Gemini API with character diagram prompt
4. Gemini returns generated image
5. Backend uploads result to Supabase Storage
6. Character diagram record created with file_url
```

### Face Swap Flow (Picsi.ai / InsightFace)
```
1. User selects video and character diagram
2. Backend creates job and enqueues to Face Swap queue
3. Worker calls Picsi.ai video-face-swap API with:
   - Source video URL
   - Face image URL (from character diagram)
4. Worker polls for completion (~1-5 min)
5. Worker downloads result and stores in Supabase
6. Job marked complete, user can view/download
```

### Variant Generation Flow (FFmpeg)
```
1. User selects video collections, audio collections, hooks
2. Backend generates round-robin combinations
3. For each variant:
   a. Download source video to temp file
   b. Download audio if provided
   c. Apply FFmpeg operations:
      - Replace audio track
      - Add text overlay (hook) with position/duration
   d. Upload processed video to Supabase
   e. Create variant video record
4. Batch status tracked via job polling
```

---

## Directory Structure

```
novai/
├── apps/
│   ├── web/                     # Next.js frontend
│   │   ├── src/
│   │   │   ├── app/             # App Router pages
│   │   │   │   ├── library/     # Library pages
│   │   │   │   │   ├── videos/
│   │   │   │   │   ├── audios/
│   │   │   │   │   ├── hooks/
│   │   │   │   │   ├── images/
│   │   │   │   │   └── models/
│   │   │   │   ├── lora/
│   │   │   │   ├── characters/
│   │   │   │   ├── swap/
│   │   │   │   ├── variants/
│   │   │   │   └── credits/     # Credits breakdown page
│   │   │   ├── components/      # React components
│   │   │   │   └── ui/          # Shadcn/UI components
│   │   │   └── lib/             # Utilities + API client
│   │   └── public/              # Static assets
│   └── api/                     # NestJS backend
│       └── src/
│           ├── modules/
│           │   ├── jobs/        # Job management + processors
│           │   │   └── processors/
│           │   │       ├── lora.processor.ts
│           │   │       ├── character.processor.ts
│           │   │       ├── face-swap.processor.ts
│           │   │       └── variant.processor.ts
│           │   ├── files/       # File upload/storage
│           │   ├── lora/        # LoRA management
│           │   ├── character/   # Character diagrams
│           │   ├── collections/ # Collections management
│           │   ├── videos/      # Video management
│           │   ├── audio/       # Audio management
│           │   ├── hooks/       # Hooks management
│           │   ├── swap/        # Face swap
│           │   ├── variants/    # Variant generation
│           │   └── stats/       # Dashboard stats
│           └── services/        # External API integrations
│               ├── fal.service.ts
│               ├── gemini.service.ts
│               └── picsi.service.ts
├── packages/
│   └── shared/                  # Shared types
├── supabase/
│   └── migrations/              # Database migrations
└── turbo.json                   # Turborepo config
```

---

## External Services & APIs

| Service | Purpose | Config Location |
|---------|---------|-----------------|
| fal.ai | LoRA training (Wan 2.2 14B) | `FAL_API_KEY` |
| Google Gemini | Character diagram generation | `GOOGLE_GEMINI_API_KEY` |
| Picsi.ai | Video face swap (InsightFace) | `PICSI_API_KEY` |
| Supabase | Database + file storage | `SUPABASE_*` |
| Redis | Job queue (BullMQ) | `REDIS_*` |
| FFmpeg | Local video processing | System installed |

---

## Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `SUPABASE_URL` | Supabase project URL | Yes |
| `SUPABASE_ANON_KEY` | Supabase anonymous key | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | Yes |
| `REDIS_HOST` | Redis host for BullMQ | Yes |
| `REDIS_PORT` | Redis port | Yes |
| `FAL_API_KEY` | fal.ai API key | Yes |
| `GOOGLE_GEMINI_API_KEY` | Google Gemini API key | Yes |
| `PICSI_API_KEY` | Picsi.ai B2B API key | Yes |
| `DAILY_COST_LIMIT_CENTS` | Max daily API spend | No |

---

## Key Files

| File | Purpose | Notes |
|------|---------|-------|
| `apps/api/src/modules/jobs/jobs.service.ts` | Job orchestration | Core queue management |
| `apps/api/src/modules/files/supabase.service.ts` | File storage + DB | Supabase integration |
| `apps/api/src/modules/lora/lora.service.ts` | LoRA management | Training + manual upload |
| `apps/api/src/modules/character/character.service.ts` | Character diagrams | Gemini generation |
| `apps/api/src/modules/swap/swap.service.ts` | Face swap | Picsi.ai integration |
| `apps/api/src/modules/variants/variants.service.ts` | Variant generation | Round-robin + FFmpeg |
| `apps/api/src/services/fal.service.ts` | fal.ai integration | LoRA training |
| `apps/api/src/services/gemini.service.ts` | Gemini integration | Character diagrams |
| `apps/api/src/services/picsi.service.ts` | Picsi.ai integration | Face swap |
| `apps/api/src/modules/jobs/processors/variant.processor.ts` | FFmpeg processing | Text overlay, audio replace |
| `apps/web/src/components/sidebar.tsx` | Navigation | Collapsible Resources + Credits |
| `apps/web/src/components/error-boundary.tsx` | Error handling | Catches React errors |
| `apps/web/src/lib/api.ts` | API client | All frontend API calls |
| `apps/api/src/modules/stats/stats.service.ts` | Dashboard stats | Storage + cost aggregation |

---

## API Endpoints

### LoRA Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/lora` | Create LoRA training job |
| `POST` | `/lora/upload` | Upload external .safetensors file |
| `GET` | `/lora` | List all LoRA models |
| `GET` | `/lora/:id` | Get single LoRA model |
| `DELETE` | `/lora/:id` | Delete LoRA model |

### Character Diagram Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/characters` | Create character diagram |
| `GET` | `/characters` | List all character diagrams |
| `GET` | `/characters/:id` | Get single character diagram |
| `DELETE` | `/characters/:id` | Delete character diagram |

### Face Swap Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/swap` | Create face swap job |
| `GET` | `/swap/results/:jobId` | Get swap result |
| `GET` | `/swap/history` | Get swap history |

### Collections Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/collections` | Create collection |
| `GET` | `/collections` | List collections (filter by type) |
| `PATCH` | `/collections/:id` | Update collection |
| `DELETE` | `/collections/:id` | Delete collection |

### Videos Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/videos` | Create video record |
| `GET` | `/videos` | List videos (filter by collection/type) |
| `PATCH` | `/videos/:id` | Update video |
| `DELETE` | `/videos/:id` | Delete video |

### Audio Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/audio` | Create audio record |
| `GET` | `/audio` | List audio files |
| `PATCH` | `/audio/:id` | Update audio |
| `DELETE` | `/audio/:id` | Delete audio |

### Hooks Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/hooks` | Create hook |
| `POST` | `/hooks/bulk` | Bulk create hooks |
| `GET` | `/hooks` | List hooks (filter by category) |
| `GET` | `/hooks/categories` | Get all categories |
| `PATCH` | `/hooks/:id` | Update hook |
| `DELETE` | `/hooks/:id` | Delete hook |

### Variants Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/variants` | Create variant batch |
| `GET` | `/variants/batch/:batchId/status` | Get batch status |
| `GET` | `/variants/batch/:batchId/results` | Get batch results |
| `GET` | `/variants/batch/:batchId/info` | Get batch info (created, expires, zipUrl) |
| `POST` | `/variants/batch/:batchId/zip` | Create ZIP download for batch |
| `POST` | `/variants/cleanup` | Cleanup expired batches (24h expiry) |

### Jobs Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/jobs` | List jobs |
| `GET` | `/jobs/:id` | Get job status |

### Stats Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/stats` | Get dashboard stats (storage, costs, jobs) |
| `GET` | `/stats/jobs/active` | Get active jobs |
| `GET` | `/stats/jobs/recent` | Get recent jobs |

---

## Database Schema (Supabase)

```sql
lora_models
├── id (uuid, primary key)
├── name (varchar)
├── trigger_word (varchar)
├── status (enum: pending, training, ready, failed)
├── training_images_url (text)
├── training_steps (integer)
├── weights_url (text)
├── config_url (text)
├── thumbnail_url (text)
├── cost_cents (integer)
├── error_message (text)
├── created_at (timestamp)
├── updated_at (timestamp)
└── completed_at (timestamp)

character_diagrams
├── id (uuid, primary key)
├── name (varchar)
├── source_image_url (text)
├── file_url (text)
├── status (enum: pending, processing, ready, failed)
├── cost_cents (integer)
├── error_message (text)
├── created_at (timestamp)
└── updated_at (timestamp)

collections
├── id (uuid, primary key)
├── name (varchar)
├── type (enum: video, audio)
├── created_at (timestamp)
└── updated_at (timestamp)

videos
├── id (uuid, primary key)
├── name (varchar)
├── type (enum: source, face_swapped, variant)
├── collection_id (uuid, FK to collections)
├── parent_video_id (uuid, FK to videos)
├── character_diagram_id (uuid, FK to character_diagrams)
├── file_url (text)
├── thumbnail_url (text)
├── duration_seconds (decimal)
├── width (integer)
├── height (integer)
├── file_size_bytes (bigint)
├── created_at (timestamp)
└── updated_at (timestamp)

audio_files
├── id (uuid, primary key)
├── name (varchar)
├── collection_id (uuid, FK to collections)
├── file_url (text)
├── duration_seconds (decimal)
├── file_size_bytes (bigint)
└── created_at (timestamp)

hooks
├── id (uuid, primary key)
├── text (text)
├── category (varchar)
└── created_at (timestamp)

jobs
├── id (uuid, primary key)
├── type (varchar)
├── reference_id (uuid)
├── status (enum: pending, queued, processing, completed, failed)
├── progress (integer)
├── external_request_id (varchar)
├── external_status (varchar)
├── input_payload (jsonb)
├── output_payload (jsonb)
├── error_message (text)
├── cost_cents (integer)
├── created_at (timestamp)
├── started_at (timestamp)
└── completed_at (timestamp)

cost_records
├── id (uuid, primary key)
├── job_id (uuid, FK to jobs)
├── job_type (varchar)
├── amount_cents (integer)
├── description (text)
└── created_at (timestamp)
```

---

## Sidebar Navigation Structure

```
NOVAI
├── Tools
│   ├── Dashboard (/)
│   ├── LoRA Creator (/lora)
│   ├── Character Diagrams (/characters)
│   ├── AI Swapper (/swap)
│   └── Variant Generator (/variants)
├── Library
│   ├── My Projects (/projects)
│   └── Resources (collapsible)
│       ├── Videos (/library/videos)
│       ├── Audios (/library/audios)
│       ├── Hooks (/library/hooks)
│       ├── Images (/library/images)
│       └── Models (/library/models)
├── [Credits Display] (sidebar widget, links to /credits)
└── Settings (/settings)
```

---

## Decision Log

### Decision: Use Google Gemini for Character Diagrams
- **Date:** 2026-01-08
- **Context:** Needed image generation for character reference sheets
- **Decision:** Google Gemini API (gemini-2.0-flash-exp with image output)
- **Alternatives:** fal.ai Flux Kontext (was initial implementation)
- **Consequences:** Better prompt adherence, lower cost (~$0.02/image)

### Decision: Use Picsi.ai for Face Swap
- **Date:** 2026-01-08
- **Context:** Need cloud-based video face swap API
- **Decision:** Picsi.ai B2B API (official InsightFace team)
- **Alternatives:** Replicate (image-only), WaveSpeedAI
- **Consequences:** 2 credits/sec pricing, high quality INSwapper model

### Decision: FFmpeg for Variant Generation
- **Date:** 2026-01-08
- **Context:** Need to combine videos with audio and text overlays
- **Decision:** fluent-ffmpeg in Node.js
- **Alternatives:** Cloud APIs
- **Consequences:** No API costs, local processing, requires FFmpeg installed

### Decision: Round-Robin Variant Assignment
- **Date:** 2026-01-08
- **Context:** How to combine videos, audio, and hooks
- **Decision:** Each video cycles through audio and hooks in order
- **Alternatives:** Random combinations, full cartesian product
- **Consequences:** Predictable output, simpler than full combinations

---

*Last updated: 2026-01-08 — All phases complete. Added ZIP packaging (archiver), 24-hour batch expiry cleanup, variant batch info endpoints. Character diagrams using Google Gemini (gemini-2.0-flash-exp).*
