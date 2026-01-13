# Data Model: Reference Kit Workflow

**Feature Branch**: `001-reference-kit`
**Date**: 2026-01-12

## Entity: reference_kits

A Reference Kit is a collection of AI-generated reference images derived from a single source image. Used to maintain identity consistency across image generations.

### Fields

| Field | Type | Nullable | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | UUID | No | `gen_random_uuid()` | Primary key |
| `name` | VARCHAR(255) | No | - | User-provided name for the kit |
| `source_image_url` | TEXT | No | - | URL of the original source image |
| `status` | VARCHAR(50) | No | `'pending'` | Overall kit status |
| `anchor_face_url` | TEXT | Yes | NULL | Front-facing, neutral anchor face |
| `profile_url` | TEXT | Yes | NULL | 3/4 profile view |
| `half_body_url` | TEXT | Yes | NULL | Waist-up portrait |
| `full_body_url` | TEXT | Yes | NULL | Full standing portrait |
| `expressions` | JSONB | No | `'{}'` | Map of expression name → URL |
| `generation_progress` | JSONB | No | `'{}'` | Map of reference type → status |
| `cost_cents` | INTEGER | Yes | NULL | Total generation cost |
| `error_message` | TEXT | Yes | NULL | Error details if failed |
| `created_at` | TIMESTAMPTZ | No | `NOW()` | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | No | `NOW()` | Last update timestamp |

### Status Values

```
'pending'     - Kit created, generation not started
'generating'  - Generation in progress (at least one reference generating)
'ready'       - All requested references generated successfully
'failed'      - Generation failed (see error_message)
```

### Generation Progress Schema

```json
{
  "anchor": "done",           // 'pending' | 'generating' | 'done' | 'failed'
  "profile": "generating",
  "half_body": "pending",
  "full_body": "pending",
  "expression_smile": "pending",
  "expression_serious": "pending"
}
```

### Expressions Schema

```json
{
  "smile": "https://...",
  "serious": "https://...",
  "surprised": "https://...",
  "angry": "https://..."
}
```

### Constraints

- `status` CHECK: `('pending', 'generating', 'ready', 'failed')`
- `source_image_url` must be a valid URL (validated in application layer)

### Indexes

| Index | Columns | Type | Purpose |
|-------|---------|------|---------|
| `idx_reference_kits_created_at` | `created_at` | DESC | List sorting |
| `idx_reference_kits_status` | `status` | - | Status filtering |

---

## Migration SQL

```sql
-- Migration: 00009_reference_kits.sql

-- Create reference_kits table
CREATE TABLE IF NOT EXISTS reference_kits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  source_image_url TEXT NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending'
    CONSTRAINT reference_kits_status_check
    CHECK (status IN ('pending', 'generating', 'ready', 'failed')),

  -- Core references (always generated)
  anchor_face_url TEXT,
  profile_url TEXT,

  -- Extended references (optional)
  half_body_url TEXT,
  full_body_url TEXT,

  -- Expression variants (flexible JSONB)
  expressions JSONB NOT NULL DEFAULT '{}',

  -- Progress tracking
  generation_progress JSONB NOT NULL DEFAULT '{}',

  -- Cost and error tracking
  cost_cents INTEGER,
  error_message TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_reference_kits_created_at ON reference_kits(created_at DESC);
CREATE INDEX idx_reference_kits_status ON reference_kits(status);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_reference_kits_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_reference_kits_updated_at
  BEFORE UPDATE ON reference_kits
  FOR EACH ROW
  EXECUTE FUNCTION update_reference_kits_updated_at();
```

---

## TypeScript Interfaces

### Database Interface (supabase.service.ts)

```typescript
export interface DbReferenceKit {
  id: string;
  name: string;
  source_image_url: string;
  status: 'pending' | 'generating' | 'ready' | 'failed';
  anchor_face_url: string | null;
  profile_url: string | null;
  half_body_url: string | null;
  full_body_url: string | null;
  expressions: Record<string, string>;
  generation_progress: Record<string, 'pending' | 'generating' | 'done' | 'failed'>;
  cost_cents: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}
```

### API Response Interface (api.ts)

```typescript
export interface ReferenceKit {
  id: string;
  name: string;
  sourceImageUrl: string;
  status: 'pending' | 'generating' | 'ready' | 'failed';
  anchorFaceUrl: string | null;
  profileUrl: string | null;
  halfBodyUrl: string | null;
  fullBodyUrl: string | null;
  expressions: Record<string, string>;
  generationProgress: Record<string, 'pending' | 'generating' | 'done' | 'failed'>;
  costCents: number | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### Request DTOs

```typescript
export interface CreateReferenceKitRequest {
  name: string;
  sourceImageUrl: string;
  generateExtended?: boolean;  // half-body, full-body
  expressions?: string[];      // ['smile', 'serious', 'surprised', 'angry']
}

export interface UpdateReferenceKitRequest {
  name?: string;
}

export interface RegenerateReferenceRequest {
  type: 'anchor' | 'profile' | 'half_body' | 'full_body' | string; // string for expression_*
}
```

---

## Relationships

- **No foreign keys** to other tables (standalone entity)
- **Jobs table**: Reference Kit generation creates a job record for tracking
- **Storage**: Images stored in Supabase Storage bucket `reference-images`

---

## State Transitions

```
[Create] → pending
pending → generating (job processor starts)
generating → generating (reference completes, next starts)
generating → ready (all references complete)
generating → failed (unrecoverable error)
failed → generating (manual retry)
ready → generating (regenerate individual reference)
```

---

## Storage Bucket

**Bucket Name**: `reference-images`

**Path Pattern**: `reference-kits/{kit_id}/{type}.{ext}`

Examples:
- `reference-kits/abc123/anchor.png`
- `reference-kits/abc123/profile.png`
- `reference-kits/abc123/expression_smile.png`
