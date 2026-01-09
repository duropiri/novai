# NOVAI Setup Guide

Complete setup instructions to get NOVAI running locally.

## Prerequisites

- Node.js 18+
- npm or pnpm
- Docker (optional, for local Redis)

---

## Step 1: Install Dependencies

```bash
npm install
```

---

## Step 2: Set Up Supabase

### 2.1 Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign up/log in
2. Click **New Project**
3. Choose your organization and enter:
   - **Project name**: `novai` (or your preference)
   - **Database password**: Generate a strong password (save this!)
   - **Region**: Choose closest to you
4. Click **Create new project** and wait for provisioning (~2 minutes)

### 2.2 Get Your API Keys

1. In your Supabase dashboard, go to **Settings** → **API**
2. Copy these values to `apps/api/.env`:
   - **Project URL** → `SUPABASE_URL`
   - **anon public** key → `SUPABASE_ANON_KEY`
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY`
3. Also copy to `apps/web/.env.local`:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### 2.3 Run the Database Schema

1. In Supabase dashboard, go to **SQL Editor**
2. Click **New query**
3. Copy the contents of `supabase/migrations/00001_initial_schema.sql`
4. Paste into the editor and click **Run**
5. You should see "Success. No rows returned" - this means tables were created
6. Create another new query and run `supabase/migrations/00002_settings_table.sql`

### 2.4 Create Storage Buckets

1. Go to **Storage** in the Supabase dashboard
2. Create the following buckets (click **New bucket** for each):

| Bucket Name | Public |
|-------------|--------|
| `source-videos` | No |
| `face-swapped-videos` | No |
| `variant-videos` | No |
| `audio-files` | No |
| `lora-training-images` | No |
| `lora-models` | No |
| `character-diagrams` | No |

**Note**: Keep all buckets private. The API uses signed URLs for access.

---

## Step 3: Set Up Redis

Redis is required for the BullMQ job queue. Choose one option:

### Option A: Local Redis with Docker (Recommended for Development)

```bash
docker run -d --name novai-redis -p 6379:6379 redis:alpine
```

Your `.env` values:
```
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
```

### Option B: Upstash (Cloud Redis - Free Tier Available)

1. Go to [console.upstash.com](https://console.upstash.com) and sign up
2. Click **Create Database**
3. Choose:
   - **Name**: `novai`
   - **Type**: Regional
   - **Region**: Closest to you
4. Click **Create**
5. In the database details, find **REST API** section
6. Copy the connection details to `apps/api/.env`:
   ```
   REDIS_HOST=your-upstash-url.upstash.io
   REDIS_PORT=6379
   REDIS_PASSWORD=your-upstash-password
   ```

### Option C: Local Redis (macOS with Homebrew)

```bash
brew install redis
brew services start redis
```

---

## Step 4: Get API Keys

You can configure API keys in two ways:
1. **Settings Page** (recommended): Go to `/settings` in the web app after setup
2. **Environment Variables**: Add to `apps/api/.env` file

### 4.1 Google Gemini API (Character Diagrams)

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Sign in with your Google account
3. Click **Create API Key**
4. Enter via Settings page or add to `apps/api/.env`:
   ```
   GOOGLE_GEMINI_API_KEY=your-key-here
   ```

**Free tier**: 60 requests/minute, 1500 requests/day

### 4.2 fal.ai API (LoRA Training & Face Swap)

1. Go to [fal.ai](https://fal.ai) and sign up
2. Go to [fal.ai/dashboard/keys](https://fal.ai/dashboard/keys)
3. Click **Create Key**
4. Enter via Settings page or add to `apps/api/.env`:
   ```
   FAL_API_KEY=your-key-here
   ```

**Pricing**: Pay as you go
- ~$2 per LoRA training job (WAN 2.2)
- Variable cost for face swap video generation (WAN)

---

## Step 5: Run the Application

### Development Mode

Open two terminal windows:

**Terminal 1 - API Server:**
```bash
cd apps/api
npm run start:dev
```
API runs at `http://localhost:3001`

**Terminal 2 - Web App:**
```bash
cd apps/web
npm run dev
```
Web app runs at `http://localhost:3000`

### Or use Turborepo (both at once):

```bash
npm run dev
```

---

## Step 6: Verify Setup

### Check API Health
```bash
curl http://localhost:3001/health
```
Should return: `{"status":"ok"}`

### Check Web App
Open `http://localhost:3000` in your browser. You should see the NOVAI dashboard.

### Test Database Connection
1. Go to the LoRA page (`/lora`)
2. Check browser console for any errors
3. If connected, you should see an empty LoRA list (no errors)

---

## Troubleshooting

### "Cannot connect to Redis"
- Ensure Redis is running: `docker ps` or `redis-cli ping`
- Check REDIS_HOST and REDIS_PORT in `.env`

### "Supabase authentication error"
- Verify SUPABASE_SERVICE_ROLE_KEY is correct (not the anon key)
- Check that the URL doesn't have a trailing slash

### "CORS errors in browser"
- Ensure NEXT_PUBLIC_API_URL matches your API server URL
- API should be running on port 3001

### "Storage bucket not found"
- Create all 7 buckets listed in Step 2.4
- Bucket names are case-sensitive

### "Gemini API quota exceeded"
- Free tier: 60 requests/minute
- Wait a minute or upgrade your quota

---

## Environment Files Summary

### apps/api/.env
```env
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
GOOGLE_GEMINI_API_KEY=AI...
FAL_API_KEY=...
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
PORT=3001
NODE_ENV=development
```

### apps/web/.env.local
```env
NEXT_PUBLIC_API_URL=http://localhost:3001/api
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

---

## Next Steps

Once everything is running:

1. **Upload some source videos** in Library → Videos
2. **Upload audio files** in Library → Audios
3. **Add hooks** (text overlays) in Library → Hooks
4. **Train a LoRA model** on the LoRA page
5. **Generate character diagrams** on the Characters page
6. **Run face swaps** on the AI Swapper page
7. **Create variants** on the Variants page

Check the **Dashboard** for job status and credits usage.
