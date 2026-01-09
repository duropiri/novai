# CLAUDE.md

## Core Principles (Non-Negotiable)

### 1. Read Before You Act
- **Always** read relevant files before answering questions about the codebase
- Never speculate about code you haven't opened
- If the user references a specific file, you **MUST** read it first
- Give grounded, hallucination-free answers only

### 2. Think, Then Plan, Then Verify
- First think through the problem thoroughly
- Read the codebase for all relevant files
- Before making any major changes, **check in with me** — I will verify the plan
- No surprises. No assumptions.

### 3. Simplicity Above All
- Make every task and code change as simple as possible
- Avoid massive or complex changes
- Every change should impact as little code as possible
- When in doubt, do less — we can always iterate

### 4. Communicate Clearly
- Every step of the way, give a high-level explanation of what changes you made
- No jargon dumps — explain like I need to understand the "why"
- If something is complex, break it down

### 5. Maintain Living Documentation
- Keep `ARCHITECTURE.md` updated with how the app works inside and out
- Document major decisions and their reasoning
- Update docs when architecture changes

---

## Workflow Rules

### Before Starting Any Task
```
1. Read relevant files in the codebase
2. Understand the current state
3. Propose a simple approach
4. Wait for my approval on major changes
5. Then execute
```

### During Implementation
- Make the smallest possible change that works
- One logical change at a time
- Explain what you changed and why after each step
- If you hit complexity, stop and discuss alternatives

### After Completing Work
- Summarize changes at a high level
- Note any follow-up items
- Update ARCHITECTURE.md if structure changed
- Flag any concerns or tech debt introduced

---

## Project Information

### Tech Stack
- Frontend: Next.js 14 (App Router), TailwindCSS, Shadcn/UI
- Backend: NestJS, BullMQ (Redis)
- Database: Supabase (PostgreSQL + Storage)
- External APIs: fal.ai (LoRA, image gen), WaveSpeedAI (face swap)
- Deployment: TBD

### Project Structure
```
novai/
├── apps/
│   ├── web/           # Next.js frontend (port 3000)
│   └── api/           # NestJS backend (port 3001)
├── packages/
│   └── shared/        # Shared TypeScript types
├── turbo.json         # Turborepo config
└── package.json       # Root workspaces
```

### Key Files to Know
- `ARCHITECTURE.md` — Full system architecture
- `apps/api/src/modules/jobs/` — Job queue processors
- `apps/api/src/modules/files/` — File upload/storage
- `apps/web/src/components/sidebar.tsx` — Navigation
- `packages/shared/src/index.ts` — Shared types

---

## Coding Standards

### General
- Prefer readability over cleverness
- Keep functions small and focused
- Use descriptive names
- Handle errors appropriately

### What to Avoid
- Large refactors without approval
- Speculating about code without reading it
- Complex solutions when simple ones exist
- Making assumptions about user intent

### What to Always Do
- Read files before discussing them
- Propose before implementing major changes
- Keep changes minimal and focused
- Explain changes in plain language
- Update documentation when architecture changes

---

## Communication Preferences

### When Uncertain
Ask me. Don't guess.

### When Explaining
- High-level first, details only if I ask
- Use plain language
- Show me the "before and after" conceptually

### When Proposing Changes
```
Here's what I'm thinking:
- Problem: [what we're solving]
- Approach: [simplest solution]
- Files affected: [list]
- Risk level: [low/medium/high]

Does this look right before I proceed?
```

---

## Quick Reference

### The Golden Rules
1. **Read first** — Never speculate about unread code
2. **Plan second** — Check in before major changes  
3. **Simplify always** — Minimal changes, minimal impact
4. **Explain everything** — High-level summaries at each step
5. **Document continuously** — Keep ARCHITECTURE.md current

### Red Flags (Stop and Ask)
- Change touches more than 3 files
- Requires restructuring existing code
- Introduces new dependencies
- Feels more complex than it should
- You're unsure about the right approach

---

*Remember: Simplicity is the ultimate sophistication. When in doubt, do less.*
