# Quickstart: Reference Kit Workflow

**Feature Branch**: `001-reference-kit`
**Date**: 2026-01-12

This guide walks through setting up and using the Reference Kit feature.

---

## Prerequisites

1. **Running Services**:
   - API server on port 3001 (`npm run dev` from root)
   - Web frontend on port 3000
   - Redis for BullMQ job queue
   - Supabase database with migrations applied

2. **Environment Variables**:
   - `GOOGLE_GEMINI_API_KEY` - Required for image generation

---

## Setup

### 1. Apply Database Migration

```bash
cd /Users/duro/Documents/Confidential/OFM/NOVAI
supabase db push
```

This creates the `reference_kits` table and `reference-images` storage bucket.

### 2. Verify Module Registration

Ensure `ReferenceKitModule` is imported in `apps/api/src/app.module.ts`.

### 3. Verify Queue Registration

Ensure `QUEUES.REFERENCE_KIT` is registered in `apps/api/src/modules/jobs/jobs.constants.ts`.

---

## Usage Flow

### Create a Reference Kit

1. Navigate to **Tools → Reference Kits** in the sidebar
2. Click **+ Create New**
3. Upload a source image (clear face photo recommended)
4. Enter a name for the kit
5. Optionally enable:
   - **Generate extended** (half-body, full-body)
   - **Expressions** (smile, serious, surprised, angry)
6. Click **Generate Reference Kit**

### Monitor Progress

- The kit card shows generation status
- Individual references update as they complete
- Progress indicators: pending → generating → done/failed
- Total time: ~2-3 minutes for core, ~5-6 minutes for full kit

### View Generated References

1. Click on a Reference Kit card
2. View all generated reference images organized by type:
   - **Core**: Anchor face, Profile
   - **Extended**: Half-body, Full-body (if enabled)
   - **Expressions**: Smile, Serious, etc. (if enabled)

### Regenerate Individual References

1. Open a Reference Kit detail view
2. Click the **Regenerate (↻)** button on any reference image
3. Wait for the new image to generate
4. Previous image is replaced

### Use in Image Generator

1. Navigate to **Image Generator**
2. Select **Reference Kit** tab in identity source
3. Choose your Reference Kit from the grid
4. Enter your scene prompt
5. Click **Generate**

The system uses all available reference images to maintain identity consistency.

### Face Swap with Reference Kit

1. Navigate to **Image Generator**
2. Select **Reference Kit** tab
3. Choose your Reference Kit
4. Upload a **source image** (enables face swap mode)
5. Click **Generate**

The anchor face from your Reference Kit replaces the face in the source image.

---

## API Quick Reference

### Create Kit
```bash
curl -X POST http://localhost:3001/reference-kits \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Kit",
    "sourceImageUrl": "https://...",
    "generateExtended": true,
    "expressions": ["smile", "serious"]
  }'
```

### List Kits
```bash
curl http://localhost:3001/reference-kits
```

### Get Kit Details
```bash
curl http://localhost:3001/reference-kits/{id}
```

### Regenerate Reference
```bash
curl -X POST http://localhost:3001/reference-kits/{id}/regenerate/anchor
```

### Delete Kit
```bash
curl -X DELETE http://localhost:3001/reference-kits/{id}
```

---

## Troubleshooting

### "Gemini API not configured"
- Ensure `GOOGLE_GEMINI_API_KEY` is set in `.env`
- Restart the API server after adding the key

### Generation stuck at "pending"
- Check Redis is running: `redis-cli ping`
- Check API logs for queue errors
- Verify job processor is registered

### Poor identity preservation
- Use a clear, well-lit source photo
- Front-facing photos work best
- Try regenerating individual references
- Consider using LoRA for higher accuracy needs

### Cost concerns
- Core kit (2 images): ~$0.04-0.08
- Full kit (8 images): ~$0.16-0.32
- Regenerations add to total cost

---

## Validation Checklist

After implementation, verify these scenarios:

- [ ] Can create Reference Kit from uploaded image
- [ ] Can create Reference Kit from existing Generated Image URL
- [ ] Progress updates in real-time during generation
- [ ] Can view all generated references in detail view
- [ ] Can regenerate individual references
- [ ] Can rename a Reference Kit
- [ ] Can delete a Reference Kit (images also deleted)
- [ ] Reference Kit appears in Image Generator identity source
- [ ] Generation with Reference Kit maintains identity
- [ ] Face swap with Reference Kit uses anchor face
- [ ] Empty state shown when no kits exist
- [ ] Error handling for failed generations
