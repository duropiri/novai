# Tasks: Reference Kit Workflow

**Input**: Design documents from `/specs/001-reference-kit/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md

**Tests**: No automated tests (manual testing per existing codebase patterns)

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Backend**: `apps/api/src/`
- **Frontend**: `apps/web/src/`
- **Database**: `supabase/migrations/`
- **Shared**: `packages/shared/src/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Database migration, queue registration, and module scaffolding

- [ ] T001 Create database migration file at `supabase/migrations/00009_reference_kits.sql` with reference_kits table schema from data-model.md
- [ ] T002 Run migration with `supabase db push` to apply reference_kits table
- [ ] T003 Add REFERENCE_KIT queue constant to `apps/api/src/modules/jobs/jobs.constants.ts`
- [ ] T004 [P] Create storage bucket `reference-images` in Supabase dashboard (or via migration)

**Checkpoint**: Database table exists, queue constant defined

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core backend module structure that all user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T005 Create `apps/api/src/modules/reference-kit/` directory structure
- [ ] T006 Create prompts file at `apps/api/src/modules/reference-kit/reference-kit.prompts.ts` with all reference generation prompts (anchor, profile, half_body, full_body, expressions)
- [ ] T007 Add `DbReferenceKit` interface to `apps/api/src/modules/files/supabase.service.ts`
- [ ] T008 Add reference kit CRUD methods to `apps/api/src/modules/files/supabase.service.ts`:
  - `createReferenceKit(data)`
  - `getReferenceKit(id)`
  - `listReferenceKits(status?)`
  - `updateReferenceKit(id, updates)`
  - `deleteReferenceKit(id)`
- [ ] T009 Add `generateReferenceImage(sourceImageUrl, prompt)` method to `apps/api/src/services/gemini.service.ts`
- [ ] T010 Create service at `apps/api/src/modules/reference-kit/reference-kit.service.ts` with dependency injection (SupabaseService, GeminiService, JobsService, Queue)
- [ ] T011 Create controller at `apps/api/src/modules/reference-kit/reference-kit.controller.ts` with endpoint stubs
- [ ] T012 Create module at `apps/api/src/modules/reference-kit/reference-kit.module.ts` with BullModule queue registration
- [ ] T013 Register ReferenceKitModule in `apps/api/src/app.module.ts`
- [ ] T014 Create job processor at `apps/api/src/modules/jobs/processors/reference-kit.processor.ts` with @Processor decorator

**Checkpoint**: Backend module registered, endpoints return 501 Not Implemented, processor shell exists

---

## Phase 3: User Story 1 - Create Reference Kit (Priority: P1) 🎯 MVP

**Goal**: User can create a Reference Kit from a source image and see generated references

**Independent Test**: Upload source image → Create kit → Wait for generation → See anchor + profile images

### Implementation for User Story 1

- [ ] T015 [US1] Implement `create()` method in `apps/api/src/modules/reference-kit/reference-kit.service.ts`:
  - Accept name, sourceImageUrl, generateExtended, expressions
  - Create reference_kits record with status 'pending'
  - Build generation_progress object based on options
  - Create job record
  - Enqueue to REFERENCE_KIT queue
  - Return created kit

- [ ] T016 [US1] Implement POST `/reference-kits` endpoint in `apps/api/src/modules/reference-kit/reference-kit.controller.ts`:
  - Validate request DTO (name required, sourceImageUrl required)
  - Call service.create()
  - Return 201 with created kit

- [ ] T017 [US1] Implement job processor logic in `apps/api/src/modules/jobs/processors/reference-kit.processor.ts`:
  - Mark job processing
  - Loop through generation_progress keys
  - For each reference type:
    - Update progress to 'generating'
    - Get prompt from REFERENCE_PROMPTS
    - Call geminiService.generateReferenceImage()
    - Upload result to Supabase Storage
    - Update kit with new URL
    - Update progress to 'done'
  - Handle errors per-reference (mark 'failed', continue others)
  - Mark kit status 'ready' when all complete
  - Record cost

- [ ] T018 [US1] Add `ReferenceKit` interface and `referenceKitApi` to `apps/web/src/lib/api.ts`:
  - Interface matching API response
  - `create(data)` method
  - `list()` method
  - `get(id)` method

- [ ] T019 [US1] Create Reference Kits page at `apps/web/src/app/reference-kits/page.tsx`:
  - "use client" directive
  - State: kits list, createDialogOpen, newKitForm
  - Fetch kits on mount with polling (5s interval)
  - Create dialog with:
    - Name input
    - Source image upload (using existing file upload pattern)
    - "Generate extended" checkbox
    - Expression checkboxes (smile, serious, surprised, angry)
    - Submit button
  - Kit grid showing source thumbnail, name, status badge, reference count

- [ ] T020 [US1] Add Reference Kits link to sidebar in `apps/web/src/components/sidebar.tsx` under Tools section

- [ ] T021 [US1] Implement camelCase transformation helper in service for DB → API response mapping

**Checkpoint**: Can create a Reference Kit, see it in list, watch progress, view completed references

---

## Phase 4: User Story 2 - View and Manage Reference Kits (Priority: P2)

**Goal**: User can view kit details, rename, and delete kits

**Independent Test**: Click kit → See all references organized → Rename → Delete → Confirm removal

### Implementation for User Story 2

- [ ] T022 [US2] Implement GET `/reference-kits` endpoint in controller:
  - Optional status query param filter
  - Call service.list()
  - Return kit array

- [ ] T023 [US2] Implement GET `/reference-kits/:id` endpoint in controller:
  - Call service.get(id)
  - Return kit or 404

- [ ] T024 [US2] Implement PATCH `/reference-kits/:id` endpoint in controller:
  - Validate update DTO (name optional)
  - Call service.update(id, updates)
  - Return updated kit or 404

- [ ] T025 [US2] Implement DELETE `/reference-kits/:id` endpoint in controller:
  - Call service.delete(id)
  - Delete all images from storage
  - Return { success: true } or 404

- [ ] T026 [US2] Implement service methods for US2:
  - `list(status?)` - list kits with optional filter
  - `get(id)` - get single kit
  - `update(id, updates)` - update name
  - `delete(id)` - delete kit and images

- [ ] T027 [US2] Add `update(id, data)` and `delete(id)` methods to `referenceKitApi` in `apps/web/src/lib/api.ts`

- [ ] T028 [US2] Add detail view to `apps/web/src/app/reference-kits/page.tsx`:
  - Selected kit state
  - Detail panel/dialog showing:
    - Source image (large)
    - Core references section (anchor, profile)
    - Extended references section (half-body, full-body) if present
    - Expressions section if present
    - Each image with label and status indicator
  - Edit name inline
  - Delete button with confirmation dialog

- [ ] T029 [US2] Implement delete functionality with storage cleanup:
  - Delete images from reference-images bucket
  - Delete kit record

**Checkpoint**: Can view kit details, see all references organized, rename kit, delete kit

---

## Phase 5: User Story 3 - Regenerate Individual References (Priority: P3)

**Goal**: User can regenerate specific references without recreating entire kit

**Independent Test**: Click regenerate on anchor → See loading → New image appears

### Implementation for User Story 3

- [ ] T030 [US3] Implement POST `/reference-kits/:id/regenerate/:type` endpoint in controller:
  - Validate type is valid reference type
  - Call service.regenerate(id, type)
  - Return updated kit or 400/404

- [ ] T031 [US3] Implement `regenerate(id, type)` method in service:
  - Get kit
  - Validate type exists in generation_progress
  - Update progress for type to 'generating'
  - Update kit status to 'generating'
  - Create regenerate job
  - Enqueue to REFERENCE_KIT queue with regenerate flag

- [ ] T032 [US3] Update processor to handle regenerate jobs:
  - Check if job is regenerate (single type)
  - Generate only the specified reference
  - Update only that URL and progress
  - Reset kit status to 'ready' when done

- [ ] T033 [US3] Add `regenerate(id, type)` method to `referenceKitApi` in `apps/web/src/lib/api.ts`

- [ ] T034 [US3] Add regenerate button to each reference in detail view:
  - Regenerate icon button (↻) on each image
  - Loading spinner when that reference is 'generating'
  - Call api.regenerate(id, type) on click
  - Refresh kit data

**Checkpoint**: Can regenerate individual references, see per-reference loading state

---

## Phase 6: User Story 4 - Image Generator Integration (Priority: P4)

**Goal**: User can select Reference Kit as identity source in Image Generator

**Independent Test**: Go to Image Generator → Select Reference Kit tab → Choose kit → Generate → Identity preserved

### Implementation for User Story 4

- [ ] T035 [US4] Read existing Image Generator page at `apps/web/src/app/image-generator/page.tsx` to understand current identity source pattern

- [ ] T036 [US4] Add "Reference Kit" tab to identity source tabs in `apps/web/src/app/image-generator/page.tsx`:
  - New tab alongside LoRA and Character Diagram
  - State for selected reference kit
  - Grid of available kits (status='ready' only)
  - Empty state with link to create kit

- [ ] T037 [US4] Update image generation logic in Image Generator:
  - When Reference Kit selected and no source image:
    - Collect all reference URLs from kit
    - Pass to generation API
  - Modify prompt to include identity preservation instruction

- [ ] T038 [US4] Create endpoint or modify existing generation endpoint to accept reference kit:
  - Accept referenceKitId parameter
  - Load kit's reference URLs
  - Pass to Gemini with identity-preserving prompt wrapper

**Checkpoint**: Can select Reference Kit in Image Generator, generate images with identity preservation

---

## Phase 7: User Story 5 - Face Swap with Reference Kit (Priority: P5)

**Goal**: User can use Reference Kit's anchor face for face swapping

**Independent Test**: Select Reference Kit → Upload source image → Generate → Face replaced with kit identity

### Implementation for User Story 5

- [ ] T039 [US5] Update Image Generator face swap logic:
  - When Reference Kit selected AND source image provided:
    - Use kit's anchorFaceUrl as face source
    - Call existing face swap API
  - Show indicator that face swap mode is active

- [ ] T040 [US5] Ensure face swap API can accept anchor face URL from Reference Kit:
  - May already work if it accepts any image URL
  - Test and verify

**Checkpoint**: Can face swap using Reference Kit's anchor face

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, cleanup, edge cases

- [ ] T041 [P] Update `ARCHITECTURE.md` with Reference Kit section:
  - Add to system architecture diagram
  - Document data flow
  - Add API endpoints table
  - Add to decision log

- [ ] T042 [P] Add error handling for edge cases:
  - Source image download failure
  - Gemini API rate limits
  - Storage upload failure
  - Kit deletion during generation

- [ ] T043 Run through quickstart.md validation checklist manually

- [ ] T044 [P] Add cost tracking display in Reference Kit detail view (show costCents)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies - can start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 - BLOCKS all user stories
- **Phase 3 (US1)**: Depends on Phase 2
- **Phase 4 (US2)**: Depends on Phase 3 (needs kits to view)
- **Phase 5 (US3)**: Depends on Phase 3 (needs kits to regenerate)
- **Phase 6 (US4)**: Depends on Phase 3 (needs kits to select)
- **Phase 7 (US5)**: Depends on Phase 6 (needs Image Generator integration)
- **Phase 8 (Polish)**: Depends on all user stories

### User Story Dependencies

```
US1 (Create) ─────────────┬─────────────────────────────┐
                          │                             │
                          ▼                             ▼
              US2 (View/Manage)              US4 (Image Generator)
                          │                             │
                          ▼                             ▼
              US3 (Regenerate)               US5 (Face Swap)
```

### Within Each User Story

1. Backend service methods first
2. Backend controller endpoints second
3. Frontend API client third
4. Frontend UI last

### Parallel Opportunities

**Phase 1**:
- T001, T003, T004 can run in parallel

**Phase 2**:
- T006, T007, T008, T009 can run in parallel (different files)
- T010, T011, T012 must be sequential (module imports)

**Phase 3+ (within each story)**:
- Backend tasks before frontend tasks
- Frontend API before frontend UI

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T004)
2. Complete Phase 2: Foundational (T005-T014)
3. Complete Phase 3: User Story 1 (T015-T021)
4. **STOP and VALIDATE**: Create a Reference Kit, watch it generate, verify images
5. Deploy/demo MVP

### Incremental Delivery

1. **MVP**: Setup + Foundational + US1 → Can create and view Reference Kits
2. **+Management**: US2 → Can rename and delete kits
3. **+Quality**: US3 → Can regenerate individual references
4. **+Integration**: US4 → Can use kits in Image Generator
5. **+Face Swap**: US5 → Can use kits for face swapping
6. **+Polish**: Documentation and edge cases

---

## Task Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| 1. Setup | T001-T004 (4) | Database, queue, storage |
| 2. Foundational | T005-T014 (10) | Module structure, service shell |
| 3. US1 Create | T015-T021 (7) | Core creation flow |
| 4. US2 View/Manage | T022-T029 (8) | List, detail, rename, delete |
| 5. US3 Regenerate | T030-T034 (5) | Individual reference regeneration |
| 6. US4 Image Gen | T035-T038 (4) | Image Generator integration |
| 7. US5 Face Swap | T039-T040 (2) | Face swap with Reference Kit |
| 8. Polish | T041-T044 (4) | Documentation, edge cases |

**Total**: 44 tasks

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story
- Each user story should be independently testable after completion
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Follow existing codebase patterns (character module as template)
