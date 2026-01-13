# Feature Specification: Reference Kit Workflow

**Feature Branch**: `001-reference-kit`
**Created**: 2026-01-12
**Status**: Draft
**Input**: User description: "Reference Kit Workflow - Alternative to LoRA training using Gemini reference images for faster, cheaper identity consistency"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create Reference Kit from Single Image (Priority: P1)

As a user, I want to create a Reference Kit from a single source image so that I can generate consistent images of that identity without waiting for LoRA training (1+ hours) or paying training costs (~$5).

**Why this priority**: This is the core value proposition - enabling instant identity creation. Without this, the feature has no purpose. It unlocks AI-generated character support (which cannot use LoRA) and provides a 10x faster, 25x cheaper alternative.

**Independent Test**: Can be fully tested by uploading a source image, triggering generation, and receiving anchor + profile reference images. Delivers immediate value as the foundation for all other stories.

**Acceptance Scenarios**:

1. **Given** I am on the Reference Kit Creator page, **When** I upload a source image and click "Generate Reference Kit", **Then** the system creates a new Reference Kit and begins generating anchor and profile reference images.

2. **Given** a Reference Kit is being generated, **When** I view the kit details, **Then** I see real-time progress showing which references are complete (anchor: done, profile: generating, etc.).

3. **Given** generation is complete, **When** I view the Reference Kit, **Then** I see the anchor face (front-facing neutral) and profile (3/4 view) images that preserve the identity from my source image.

4. **Given** I want extended references, **When** I enable "Generate extended (half-body, full-body)" before generating, **Then** the system also generates waist-up and full-body portrait images.

5. **Given** I want expression variants, **When** I select expressions (smile, serious, surprised, angry) before generating, **Then** the system generates those expression variants for the identity.

---

### User Story 2 - View and Manage Reference Kits (Priority: P2)

As a user, I want to see all my Reference Kits in a list and view the generated reference images so I can verify the identity is captured correctly and manage my collection.

**Why this priority**: Users need to browse and verify their kits before using them. Essential for usability but depends on User Story 1 to have kits to view.

**Independent Test**: Can be tested by viewing a list of previously created Reference Kits, clicking into one, and seeing all generated reference images displayed in an organized layout.

**Acceptance Scenarios**:

1. **Given** I have created Reference Kits, **When** I navigate to the Reference Kits page, **Then** I see a grid of all my kits showing the source image thumbnail, name, status (Ready/Generating), and reference count.

2. **Given** I click on a Reference Kit, **When** the detail view opens, **Then** I see all generated references organized by type: core (anchor, profile), extended (half-body, full-body), and expressions (smile, serious, etc.).

3. **Given** I want to rename a kit, **When** I edit the name field, **Then** the name updates and persists.

4. **Given** I want to delete a kit, **When** I click delete and confirm, **Then** the kit and all its reference images are removed.

---

### User Story 3 - Regenerate Individual References (Priority: P3)

As a user, I want to regenerate individual reference images if they don't look right so I can improve identity consistency without recreating the entire kit.

**Why this priority**: Quality control is important but not blocking - users can still use kits even with imperfect references. This is a refinement capability.

**Independent Test**: Can be tested by viewing a Reference Kit, clicking the regenerate button on a specific reference image, and seeing a new image generated that replaces the old one.

**Acceptance Scenarios**:

1. **Given** I am viewing a Reference Kit with generated references, **When** I click the regenerate button on the anchor face image, **Then** a new anchor face is generated from the source image and replaces the previous one.

2. **Given** regeneration is in progress, **When** I view the kit, **Then** I see a loading indicator on that specific reference while others remain viewable.

3. **Given** I regenerate multiple references, **When** each completes, **Then** they update independently without affecting other references.

---

### User Story 4 - Use Reference Kit in Image Generator (Priority: P4)

As a user, I want to use my Reference Kit as an identity source in the Image Generator so I can create new images that maintain the same identity across different scenes and poses.

**Why this priority**: This is the primary use case for Reference Kits but requires User Stories 1-3 to be functional first. It integrates with existing Image Generator functionality.

**Independent Test**: Can be tested by selecting a Reference Kit in Image Generator, entering a scene prompt, and generating images that preserve the identity from the kit.

**Acceptance Scenarios**:

1. **Given** I am on the Image Generator page, **When** I select "Reference Kit" as the identity source tab, **Then** I see a list/grid of my available Reference Kits to choose from.

2. **Given** I have selected a Reference Kit, **When** I enter a scene prompt and generate, **Then** the generated images maintain the identity from my Reference Kit's reference images.

3. **Given** no Reference Kits exist, **When** I select the Reference Kit tab, **Then** I see an empty state with a link to create a new Reference Kit.

---

### User Story 5 - Face Swap with Reference Kit (Priority: P5)

As a user, I want to use my Reference Kit for face swapping when I upload a source image in Image Generator so I can replace faces in existing images while maintaining my Reference Kit identity.

**Why this priority**: Face swap is a secondary use case that extends the kit's utility. It depends on all prior stories and integrates with existing face swap functionality.

**Independent Test**: Can be tested by selecting a Reference Kit, uploading a source image, and generating a face-swapped result that applies the Reference Kit's identity to the source image.

**Acceptance Scenarios**:

1. **Given** I have selected a Reference Kit in Image Generator, **When** I upload a source image (enabling face swap mode), **Then** the system uses the Reference Kit's anchor face as the identity source for face swapping.

2. **Given** face swap is in progress, **When** generation completes, **Then** the result shows the source image with the face replaced by the Reference Kit identity.

---

### Edge Cases

- What happens when source image upload fails or is invalid?
  - System displays clear error message and allows retry

- What happens when AI generation fails for a specific reference?
  - That reference is marked "failed" with option to retry; other references continue generating

- What happens when user tries to use an incomplete Reference Kit in Image Generator?
  - Kit shows "Generating..." status; user can wait or select another kit

- What happens when user deletes a Reference Kit that is currently in use?
  - System warns user and cancels any in-progress generations using that kit

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow users to create a Reference Kit by uploading a single source image
- **FR-002**: System MUST generate an anchor face image (front-facing, neutral expression) from the source
- **FR-003**: System MUST generate a profile image (3/4 view) from the source
- **FR-004**: System MUST optionally generate half-body and full-body portrait images when user enables "extended" mode
- **FR-005**: System MUST optionally generate expression variants (smile, serious, surprised, angry) when user selects them
- **FR-006**: System MUST display real-time generation progress showing status of each reference (pending, generating, done, failed)
- **FR-007**: System MUST allow users to view all Reference Kits in a list/grid layout
- **FR-008**: System MUST allow users to view, rename, and delete Reference Kits
- **FR-009**: System MUST allow users to regenerate individual reference images
- **FR-010**: System MUST integrate Reference Kit as an identity source option in Image Generator (alongside LoRA and Character Diagram)
- **FR-011**: System MUST use all available reference images when generating with a Reference Kit to maximize identity consistency
- **FR-012**: System MUST use the anchor face image when performing face swap with a Reference Kit
- **FR-013**: System MUST persist Reference Kits and their generated images for future use

### Key Entities

- **Reference Kit**: A collection of AI-generated reference images derived from a single source image. Contains a name, source image, core references (anchor, profile), optional extended references (half-body, full-body), optional expression variants, status, and generation progress.

- **Reference Image**: An individual generated image within a Reference Kit. Has a type (anchor, profile, half_body, full_body, or expression variant), URL, and generation status.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can create a Reference Kit and have core references (anchor + profile) generated within 3 minutes
- **SC-002**: Users can view and select Reference Kits in Image Generator within the same workflow as existing identity sources (LoRA, Character Diagram)
- **SC-003**: Generated images using Reference Kits maintain recognizable identity consistency (same person recognizable across different scenes)
- **SC-004**: Reference Kit creation costs approximately 90% less than LoRA training (~$0.20 vs ~$5)
- **SC-005**: Reference Kit is ready to use immediately after generation completes (no training wait time)
- **SC-006**: Users can regenerate any individual reference image without recreating the entire kit

## Assumptions

- Google Gemini API supports multi-reference image generation for identity preservation
- Gemini can generate images that preserve identity from a source image using detailed prompts
- The anchor face image is sufficient for face swap operations (clearest frontal reference)
- Users understand that Reference Kits are faster/cheaper but may have lower accuracy than LoRA models
- Cost estimates (~$0.20 per kit) are based on current Gemini API pricing for image generation
