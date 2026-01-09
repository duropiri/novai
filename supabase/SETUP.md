# Supabase Setup Guide

## 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign in
2. Click "New Project"
3. Choose your organization
4. Enter project details:
   - **Name:** NOVAI (or your preferred name)
   - **Database Password:** Generate a strong password (save it!)
   - **Region:** Choose closest to your users
5. Click "Create new project" and wait for setup (~2 minutes)

## 2. Get Your API Keys

1. Go to **Settings** → **API**
2. Copy these values to your `.env.local`:

```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

⚠️ **Never expose `SUPABASE_SERVICE_ROLE_KEY` to the frontend!**

## 3. Link Project with Supabase CLI (Recommended)

The project includes Supabase CLI for easier database management.

### First-time setup:

```bash
# Login to Supabase (opens browser)
npm run db:login

# Link your project (you'll need your project ref from Settings > General)
npm run db:link
```

### Push migrations to your database:

```bash
# Push all pending migrations
npm run db:push
```

### Other useful commands:

```bash
npm run db:migrate:list   # See migration status
npm run db:pull           # Pull remote schema changes
npm run db:diff           # Show diff between local and remote
npm run db:migrate:new    # Create a new migration file
```

## 4. Alternative: Manual Migration via SQL Editor

If you prefer not to use the CLI:

1. Go to **SQL Editor** in your Supabase dashboard
2. Click "New query"
3. Copy the contents of `supabase/migrations/00001_initial_schema.sql`
4. Paste and click "Run"
5. You should see "Success. No rows returned"
6. Repeat for each migration file in order (00002, 00003, etc.)

## 5. Create Storage Buckets

Go to **Storage** in your Supabase dashboard and create these buckets:

| Bucket Name | Public | Description |
|-------------|--------|-------------|
| `training-images` | No | ZIP files for LoRA training |
| `lora-weights` | No | Trained LoRA .safetensors files |
| `character-images` | Yes | Generated character diagrams |
| `source-videos` | No | User uploaded videos |
| `processed-videos` | Yes | Face-swapped results |
| `variant-videos` | Yes | FFmpeg processed variants |
| `audio` | No | Audio files for variants |

### Creating a Bucket:
1. Click "New bucket"
2. Enter the bucket name exactly as shown above
3. Toggle "Public bucket" as indicated
4. Click "Create bucket"

## 6. Apply Storage Policies (Optional)

If you need fine-grained access control:

1. Go to **SQL Editor**
2. Copy contents of `supabase/migrations/00002_storage_buckets.sql`
3. Run the query

## 7. Verify Setup

Run this query in SQL Editor to verify tables exist:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public';
```

Expected tables:
- `lora_models`
- `character_diagrams`
- `videos`
- `audio_files`
- `hooks`
- `jobs`
- `cost_records`

## 8. Test Connection

Start your API server and check the health endpoint:

```bash
cd apps/api
npm run dev

# In another terminal:
curl http://localhost:3001/api/health
```

## Environment Variables Summary

Your `.env.local` should have:

```env
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Redis (for local development)
REDIS_HOST=localhost
REDIS_PORT=6379

# External APIs (add when ready)
FAL_API_KEY=
WAVESPEED_API_KEY=

# App Config
NEXT_PUBLIC_API_URL=http://localhost:3001
FRONTEND_URL=http://localhost:3000

# Cost Tracking
DAILY_COST_LIMIT_CENTS=5000
```

## Troubleshooting

### "relation does not exist" error
- Make sure you ran the migration SQL in step 3
- Check you're connected to the correct project

### Storage upload fails
- Verify bucket names match exactly (case-sensitive)
- Check your service role key is correct
- Ensure bucket exists before uploading

### Connection refused
- Verify your `SUPABASE_URL` doesn't have a trailing slash
- Check your API keys are correct (no extra whitespace)
