# Production (Railway) checklist

Set these in your Railway service **Variables** (or in a `.env` that is only used in production). Do **not** commit secrets to git.

## Required

| Variable | Description |
|----------|-------------|
| `RAGIE_API_KEY` | Your Ragie API key for video indexing and retrieval. |
| `DATABASE_URL` | PostgreSQL connection string (e.g. from Railway Postgres plugin). |
| `JWT_SECRET` | Long random string (e.g. 32+ chars) for signing tokens. |

## Recommended (for RAG answers)

| Variable | Description |
|----------|-------------|
| `GEMINI_API_KEY` | Primary LLM for answer generation. |
| `GEMINI_MODEL` | Optional; default `gemini-2.0-flash`. |
| `OPENAI_API_KEY` | Fallback when Gemini is rate-limited. |
| `OPENAI_MODEL` | Optional; default `gpt-4o-mini`. |
| `OPENROUTER_API_KEY` | Optional; extra fallback (e.g. Llama). |

## YouTube ingest (production)

| Variable | Description |
|----------|-------------|
| `YT_DLP_COOKIES_CONTENT` | **Paste the full contents** of your `cookies.txt` (export from browser when logged into YouTube). The app writes this to a file at startup so yt-dlp can bypass bot checks. Do **not** set `YT_DLP_COOKIES_FILE` to the content — use this variable for the content. |

- **Do not** set `YT_DLP_COOKIES_FILE` in production unless you have an actual file path (e.g. baked into the image). For “paste cookie content”, use only `YT_DLP_COOKIES_CONTENT`.

## FFmpeg (production)

- **Do not** set `FFMPEG_LOCATION` in production.
- Ensure `backend/nixpacks.toml` contains:
  ```toml
  [phases.setup]
  nixPkgs = ["ffmpeg"]
  ```
- Nixpacks will install ffmpeg and it will be on PATH.

## Optional

| Variable | Description |
|----------|-------------|
| `FRONTEND_URL` | Your frontend origin for CORS (e.g. `https://your-app.vercel.app`). |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary for video storage and segment URLs. |
| `CLOUDINARY_API_KEY` | |
| `CLOUDINARY_API_SECRET` | |

## Summary: what to keep in production

- **Required:** `RAGIE_API_KEY`, `DATABASE_URL`, `JWT_SECRET`
- **For answers:** `GEMINI_API_KEY`, and optionally `OPENAI_API_KEY`, `OPENROUTER_API_KEY`
- **For YouTube ingest:** `YT_DLP_COOKIES_CONTENT` (paste full cookies.txt content)
- **FFmpeg:** nothing to set; use `nixpacks.toml` with `nixPkgs = ["ffmpeg"]`
- **Optional:** `FRONTEND_URL`, Cloudinary vars
