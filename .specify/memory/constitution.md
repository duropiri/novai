# NOVAI Constitution

<!--
## Sync Impact Report

- **Version Change**: 0.0.0 → 1.0.0
- **Modified Principles**: N/A (initial constitution)
- **Added Sections**:
  - Core Principles (5 principles)
  - Technical Standards
  - Development Workflow
  - Governance
- **Removed Sections**: All placeholder content
- **Templates Updated**:
  - `.specify/templates/plan-template.md` ✅ (no updates required - compatible)
  - `.specify/templates/spec-template.md` ✅ (no updates required - compatible)
  - `.specify/templates/tasks-template.md` ✅ (no updates required - compatible)
- **Follow-up TODOs**: None
-->

## Core Principles

### I. Read Before You Act

All code-related work MUST begin with reading the relevant files. Never speculate about code that has not been opened. If a file is referenced, it MUST be read first. All answers and changes MUST be grounded in actual codebase content, not assumptions.

**Rationale**: Prevents hallucinations, ensures accuracy, and maintains trust in all code modifications.

### II. Think, Then Plan, Then Verify

Every significant change MUST follow this sequence:
1. Think through the problem thoroughly
2. Read relevant codebase files to understand current state
3. Propose a simple approach for approval before executing
4. Execute only after explicit approval for major changes

No surprises. No assumptions. Major changes require check-in before implementation.

**Rationale**: Prevents wasted effort, ensures alignment, and catches issues before they become costly.

### III. Simplicity Above All

All changes MUST be as simple as possible. Every change SHOULD impact minimal code. Avoid massive or complex changes. When uncertain, do less—iteration is always possible.

**Red Flags** (Stop and discuss alternatives):
- Change touches more than 3 files
- Requires restructuring existing code
- Introduces new dependencies
- Feels more complex than necessary

**Rationale**: Simplicity is the ultimate sophistication. Complex solutions create technical debt and maintenance burden.

### IV. Communicate Clearly

Every step MUST include a high-level explanation of changes made. Explanations MUST convey the "why" not just the "what". Complex topics MUST be broken down into understandable parts. No jargon dumps.

**Rationale**: Clear communication ensures understanding and enables informed decision-making.

### V. Maintain Living Documentation

The `ARCHITECTURE.md` file MUST be kept current with how the system works. Major decisions and their reasoning MUST be documented. Documentation MUST be updated when architecture changes.

**Rationale**: Documentation is the source of truth for how the system operates and why decisions were made.

## Technical Standards

**Tech Stack** (non-negotiable):
- Frontend: Next.js (App Router), TailwindCSS, Shadcn/UI
- Backend: NestJS, BullMQ (Redis)
- Database: Supabase (PostgreSQL + Storage)
- External APIs: fal.ai, Google Gemini, WaveSpeedAI/Picsi.ai
- Package Management: Turborepo monorepo

**Project Structure**:
- `apps/web/` - Next.js frontend (port 3000)
- `apps/api/` - NestJS backend (port 3001)
- `packages/shared/` - Shared TypeScript types
- `supabase/migrations/` - Database migrations

**Coding Standards**:
- Prefer readability over cleverness
- Keep functions small and focused
- Use descriptive names
- Handle errors appropriately
- Read files before discussing them
- Explain changes in plain language

## Development Workflow

### Before Starting Any Task

1. Read relevant files in the codebase
2. Understand the current state
3. Propose a simple approach
4. Wait for approval on major changes
5. Then execute

### During Implementation

- Make the smallest possible change that works
- One logical change at a time
- Explain what changed and why after each step
- If complexity increases, stop and discuss alternatives

### After Completing Work

- Summarize changes at a high level
- Note any follow-up items
- Update `ARCHITECTURE.md` if structure changed
- Flag any concerns or technical debt introduced

### When Uncertain

Ask. Do not guess.

## Governance

This Constitution supersedes all other development practices. All code reviews and changes MUST verify compliance with these principles.

**Amendments**:
- Amendments require documentation of the change and rationale
- Changes to Core Principles require explicit approval
- Version increments follow semantic versioning:
  - MAJOR: Backward incompatible governance changes
  - MINOR: New principle/section additions
  - PATCH: Clarifications and refinements

**Compliance Review**:
- Red Flags (more than 3 files, restructuring, new dependencies, unnecessary complexity) require discussion before proceeding
- Changes SHOULD be minimal and focused
- Simple approaches MUST be preferred

**Guidance**: Use `CLAUDE.md` for development guidance and `ARCHITECTURE.md` for system documentation.

**Version**: 1.0.0 | **Ratified**: 2026-01-12 | **Last Amended**: 2026-01-12
