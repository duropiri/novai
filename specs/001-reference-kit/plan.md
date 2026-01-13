# Implementation Plan: Reference Kit Workflow

**Branch**: `001-reference-kit` | **Date**: 2026-01-12 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-reference-kit/spec.md`

## Summary

Create a Reference Kit feature that generates multiple reference images (anchor face, profile, half-body, full-body, expressions) from a single source image using Google Gemini. This provides a faster (~3 min), cheaper (~$0.20) alternative to LoRA training (~1 hour, ~$5) for identity consistency in image generation.

**Technical Approach**: Follow existing module patterns (character, lora) with NestJS backend, BullMQ job queue, Supabase storage, and Next.js frontend. Integrate as third identity source option in Image Generator.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 20.x
**Primary Dependencies**: NestJS, Next.js 14 (App Router), BullMQ, Supabase Client, Shadcn/UI
**Storage**: Supabase (PostgreSQL + Storage bucket)
**Testing**: Manual testing (no automated tests in current codebase)
**Target Platform**: Web application (macOS/Linux server, modern browsers)
**Project Type**: Web (monorepo with apps/web, apps/api, packages/shared)
**Performance Goals**: Reference generation completes within 3 minutes
**Constraints**: Single user, no authentication, ~$0.20 cost per kit
**Scale/Scope**: Single user, ~50-100 reference kits expected

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Justification |
|-----------|--------|---------------|
| I. Read Before You Act | ✅ PASS | Researched existing patterns in character, lora, jobs modules |
| II. Think, Then Plan, Then Verify | ✅ PASS | Following speckit workflow; plan before implementation |
| III. Simplicity Above All | ✅ PASS | Following existing patterns exactly; ~6-8 files total |
| IV. Communicate Clearly | ✅ PASS | Clear plan with phase breakdown |
| V. Maintain Living Documentation | ✅ PASS | Will update ARCHITECTURE.md after implementation |

**Red Flag Check**:
- Change touches ~8-10 files → Acceptable (new feature requires module + page + migration)
- No restructuring of existing code
- No new dependencies (using existing Gemini service)
- Follows existing patterns exactly

## Project Structure

### Documentation (this feature)

```text
specs/001-reference-kit/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── api.md           # REST endpoint specifications
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
# Backend (NestJS)
apps/api/src/
├── modules/
│   └── reference-kit/                    # NEW MODULE
│       ├── reference-kit.module.ts       # Module definition
│       ├── reference-kit.controller.ts   # REST endpoints
│       ├── reference-kit.service.ts      # Business logic
│       └── reference-kit.prompts.ts      # Gemini prompts
├── modules/jobs/
│   ├── processors/
│   │   └── reference-kit.processor.ts    # NEW PROCESSOR
│   └── jobs.constants.ts                 # Add new queue constant
└── app.module.ts                         # Register new module

# Frontend (Next.js)
apps/web/src/
├── app/
│   └── reference-kits/                   # NEW PAGE
│       └── page.tsx                      # List + Create + Detail view
├── app/image-generator/
│   └── page.tsx                          # MODIFY: Add Reference Kit tab
└── lib/
    └── api.ts                            # Add referenceKitApi

# Database
supabase/migrations/
└── 00009_reference_kits.sql              # NEW MIGRATION

# Shared Types
packages/shared/src/
└── index.ts                              # Add ReferenceKit types
```

**Structure Decision**: Web application pattern (apps/api + apps/web) following existing module architecture. No new directories outside standard pattern.

## Complexity Tracking

No constitution violations. Feature follows existing patterns exactly with minimal file count.

---

## Phase 0: Research

### Research Questions

1. **Gemini Image Generation API**: How to pass source image as reference for generation?
2. **Multi-image Generation**: Can Gemini generate multiple variants in sequence efficiently?
3. **Identity Preservation**: What prompt patterns work best for maintaining identity?
4. **Cost Estimation**: Confirm ~$0.02-0.04 per image generation

### Research Findings

See [research.md](./research.md) for detailed findings.

**Key Decisions**:
- Use existing `GeminiService.generateImageFromReference()` method
- Generate references sequentially (not parallel) to avoid rate limits
- Store progress in JSONB column for granular tracking
- Identity preservation via detailed prompts (already provided in spec)

---

## Phase 1: Design

### Data Model

See [data-model.md](./data-model.md) for complete entity design.

**Key Entity: reference_kits**
- Core fields: id, name, source_image_url, status
- Reference URLs: anchor_face_url, profile_url, half_body_url, full_body_url
- Expressions: JSONB for flexible expression variants
- Progress: JSONB for granular generation tracking

### API Contracts

See [contracts/api.md](./contracts/api.md) for complete endpoint specifications.

**Endpoints**:
- `POST /reference-kits` - Create kit and start generation
- `GET /reference-kits` - List all kits
- `GET /reference-kits/:id` - Get single kit with all references
- `PATCH /reference-kits/:id` - Update name
- `DELETE /reference-kits/:id` - Delete kit and images
- `POST /reference-kits/:id/regenerate/:type` - Regenerate specific reference

### Integration Points

1. **Image Generator**: Add "Reference Kit" as third tab in identity source selector
2. **Face Swap**: Use anchor_face_url when Reference Kit selected with source image
3. **Gemini Service**: Use existing generateImageFromReference() method

---

## Implementation Phases

### Phase 1: Database & Backend Foundation
- Create migration for reference_kits table
- Create ReferenceKit module (controller, service, module)
- Create job processor for reference generation
- Register module and queue in app.module.ts

### Phase 2: Frontend Reference Kit Management
- Create Reference Kits page with list/create/detail views
- Add referenceKitApi to api.ts
- Implement polling for generation progress

### Phase 3: Image Generator Integration
- Add Reference Kit tab to identity source selector
- Pass reference URLs to Gemini for generation
- Use anchor face for face swap mode

### Phase 4: Polish & Documentation
- Update ARCHITECTURE.md
- Test all user stories
- Clean up any edge cases
