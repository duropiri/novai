# API Contracts: Reference Kit Workflow

**Feature Branch**: `001-reference-kit`
**Date**: 2026-01-12
**Base Path**: `/reference-kits`

---

## Endpoints Overview

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/reference-kits` | Create new kit and start generation |
| `GET` | `/reference-kits` | List all reference kits |
| `GET` | `/reference-kits/:id` | Get single kit with all references |
| `PATCH` | `/reference-kits/:id` | Update kit name |
| `DELETE` | `/reference-kits/:id` | Delete kit and all images |
| `POST` | `/reference-kits/:id/regenerate/:type` | Regenerate specific reference |

---

## POST /reference-kits

Create a new Reference Kit and start generating reference images.

### Request

```typescript
interface CreateReferenceKitRequest {
  name: string;              // Required: Kit display name
  sourceImageUrl: string;    // Required: URL of source image
  generateExtended?: boolean; // Optional: Include half-body, full-body
  expressions?: string[];    // Optional: ['smile', 'serious', 'surprised', 'angry']
}
```

**Example Request**:
```json
{
  "name": "Amalia",
  "sourceImageUrl": "https://storage.supabase.co/...",
  "generateExtended": true,
  "expressions": ["smile", "serious"]
}
```

### Response

**201 Created**
```typescript
interface ReferenceKit {
  id: string;
  name: string;
  sourceImageUrl: string;
  status: 'pending';
  anchorFaceUrl: null;
  profileUrl: null;
  halfBodyUrl: null;
  fullBodyUrl: null;
  expressions: {};
  generationProgress: {
    anchor: 'pending';
    profile: 'pending';
    half_body?: 'pending';
    full_body?: 'pending';
    expression_smile?: 'pending';
    expression_serious?: 'pending';
  };
  costCents: null;
  errorMessage: null;
  createdAt: string;
  updatedAt: string;
}
```

**400 Bad Request**
```json
{
  "statusCode": 400,
  "message": "name is required",
  "error": "Bad Request"
}
```

---

## GET /reference-kits

List all Reference Kits, ordered by creation date (newest first).

### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Optional: Filter by status ('pending', 'generating', 'ready', 'failed') |

### Response

**200 OK**
```typescript
ReferenceKit[]
```

**Example Response**:
```json
[
  {
    "id": "abc123",
    "name": "Amalia",
    "sourceImageUrl": "https://...",
    "status": "ready",
    "anchorFaceUrl": "https://...",
    "profileUrl": "https://...",
    "halfBodyUrl": "https://...",
    "fullBodyUrl": "https://...",
    "expressions": {
      "smile": "https://...",
      "serious": "https://..."
    },
    "generationProgress": {
      "anchor": "done",
      "profile": "done",
      "half_body": "done",
      "full_body": "done",
      "expression_smile": "done",
      "expression_serious": "done"
    },
    "costCents": 24,
    "errorMessage": null,
    "createdAt": "2026-01-12T10:00:00Z",
    "updatedAt": "2026-01-12T10:03:00Z"
  }
]
```

---

## GET /reference-kits/:id

Get a single Reference Kit by ID.

### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Reference Kit UUID |

### Response

**200 OK**
```typescript
ReferenceKit
```

**404 Not Found**
```json
{
  "statusCode": 404,
  "message": "Reference kit not found",
  "error": "Not Found"
}
```

---

## PATCH /reference-kits/:id

Update a Reference Kit (currently only name).

### Request

```typescript
interface UpdateReferenceKitRequest {
  name?: string;
}
```

**Example Request**:
```json
{
  "name": "Amalia v2"
}
```

### Response

**200 OK**
```typescript
ReferenceKit
```

**404 Not Found**
```json
{
  "statusCode": 404,
  "message": "Reference kit not found",
  "error": "Not Found"
}
```

---

## DELETE /reference-kits/:id

Delete a Reference Kit and all associated images from storage.

### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Reference Kit UUID |

### Response

**200 OK**
```json
{
  "success": true
}
```

**404 Not Found**
```json
{
  "statusCode": 404,
  "message": "Reference kit not found",
  "error": "Not Found"
}
```

---

## POST /reference-kits/:id/regenerate/:type

Regenerate a specific reference image within a kit.

### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Reference Kit UUID |
| `type` | string | Reference type to regenerate |

**Valid Types**:
- `anchor` - Regenerate anchor face
- `profile` - Regenerate profile view
- `half_body` - Regenerate half-body portrait
- `full_body` - Regenerate full-body portrait
- `expression_smile` - Regenerate smile expression
- `expression_serious` - Regenerate serious expression
- `expression_surprised` - Regenerate surprised expression
- `expression_angry` - Regenerate angry expression

### Response

**200 OK**
```typescript
ReferenceKit // With updated generationProgress showing the type as 'generating'
```

**400 Bad Request**
```json
{
  "statusCode": 400,
  "message": "Invalid reference type: expression_unknown",
  "error": "Bad Request"
}
```

**404 Not Found**
```json
{
  "statusCode": 404,
  "message": "Reference kit not found",
  "error": "Not Found"
}
```

---

## Error Responses

All endpoints may return these standard errors:

**500 Internal Server Error**
```json
{
  "statusCode": 500,
  "message": "Internal server error",
  "error": "Internal Server Error"
}
```

---

## Response Field Mapping

Database fields map to API response fields with camelCase transformation:

| Database Field | API Field |
|----------------|-----------|
| `source_image_url` | `sourceImageUrl` |
| `anchor_face_url` | `anchorFaceUrl` |
| `profile_url` | `profileUrl` |
| `half_body_url` | `halfBodyUrl` |
| `full_body_url` | `fullBodyUrl` |
| `generation_progress` | `generationProgress` |
| `cost_cents` | `costCents` |
| `error_message` | `errorMessage` |
| `created_at` | `createdAt` |
| `updated_at` | `updatedAt` |

---

## Integration Notes

### Image Generator Integration

When using a Reference Kit in Image Generator:

1. **Generation Mode** (no source image):
   - Fetch kit's reference URLs: anchor, profile, extended, expressions
   - Pass all available URLs as reference images to Gemini
   - Append identity preservation prompt to user's scene prompt

2. **Face Swap Mode** (with source image):
   - Use `anchorFaceUrl` as the face source
   - Call existing face swap API with anchor as swap image

### Polling Pattern

Frontend should poll `GET /reference-kits/:id` every 5 seconds when `status === 'generating'` to update progress UI.
