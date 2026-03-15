# MCP-powered video-RAG using Ragie

This project demonstrates how to build a video-based Retrieval Augmented Generation (RAG) system powered by the Model Context Protocol (MCP). It uses [Ragie's](https://www.ragie.ai/) video ingestion and retrieval capabilities to enable semantic search and Q&A over video content and integrate them as MCP tools via Cursor IDE.

**Tech stack:** Ragie (video-RAG), YouTube/yt-dlp (single video or full playlist), optional Backblaze B2 (storage), optional OpenRouter/Llama agent, Cursor (MCP host).

### Quick commands (from `backend/` directory)

| What | Command |
|------|---------|
| Install deps | `uv sync` |
| **Run FastAPI backend (for frontend)** | `uv run uvicorn app:app --reload --host 0.0.0.0` |
| Run MCP server (for Cursor) | `uv run server.py` |
| Run Llama agent (chat + tools) | `uv run agent.py` |
| Ingest `videos/` + one query | `uv run main.py` |

---
## Setup and Installation

Ensure you have Python 3.12 or later installed on your system.

### Install uv
First, let’s install uv and set up our Python project and environment:
```bash
# MacOS/Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# Windows
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

### Install dependencies
```bash
# Create a new directory for our project
uv init project-name
cd project-name

# Create virtual environment and activate it
uv venv
source .venv/bin/activate  # MacOS/Linux

.venv\Scripts\activate     # Windows

# Install dependencies
uv sync
```

### Configure environment variables

Copy `.env.example` to `.env` and set: `RAGIE_API_KEY` (required), `OPENROUTER_API_KEY` (for agent), and optionally `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET_NAME` for Backblaze B2.

## Running the application

Run all commands from the project root.

**MCP server (for Cursor):**
```bash
uv run server.py
```

**Standalone Llama agent (OpenRouter + MCP tools):**
```bash
uv run agent.py
```

**Ingest local `videos/` folder and run one retrieval:**
```bash
uv run main.py
```

## Run the project (Cursor MCP setup)

First, set up your MCP server as follows:
- Go to Cursor settings
- Select MCP Tools
- Add new global MCP server.

In the JSON file, add this:
```json
{
    "mcpServers": {
        "ragie": {
            "command": "uv",
            "args": [
                "--directory",
                "/absolute/path/to/project_root",
                "run",
                "server.py"
            ],
            "env": {
                "RAGIE_API_KEY": "YOUR_RAGIE_API_KEY",
                "OPENROUTER_API_KEY": "YOUR_OPENROUTER_API_KEY"
            }
        }
    }
}
```

You should now be able to see the MCP server listed in the MCP settings. In Cursor MCP settings make sure to toggle the button to connect the server to the host.

Done! Your server is now up and running. 

The MCP server exposes 4 tools:
- `ingest_youtube_tool`: Download a YouTube video or full playlist and index it for chat
- `ingest_data_tool`: Ingest videos from a local directory
- `retrieve_data_tool`: Retrieve relevant chunks for a query
- `show_video_tool`: Create a video chunk from a segment (saved to `video_chunks/`, optional B2 upload)

Use Cursor with the MCP server, or run `uv run agent.py` for the standalone Llama agent.

---

## FastAPI backend (for your frontend)

Run the REST API so your frontend can connect:

```bash
cd backend
uv run uvicorn app:app --reload --host 0.0.0.0
```

By default the API is at **http://localhost:8000**. CORS allows all origins.

### User isolation

**All data endpoints require the `X-User-Id` header.** Each user’s videos, index, and clips are isolated:

- Ragie documents are stored in a **partition** per user.
- Videos are under `videos/{user_id}/`, clips under `video_chunks/{user_id}/`.
- B2 keys (if used) are scoped as `users/{user_id}/videos/` and `users/{user_id}/chunks/`.

Send the same `X-User-Id` (e.g. your auth user id) on every request. Use only alphanumeric characters, `_`, and `-`.

### API ↔ MCP mapping

| MCP tool | API endpoint |
|----------|--------------|
| `ingest_youtube_tool` | `POST /api/ingest/youtube` |
| `ingest_data_tool` | `POST /api/ingest/directory` |
| `retrieve_data_tool` | `POST /api/retrieve` |
| `show_video_tool` | `POST /api/chunk` |

Request/response semantics match the MCP tools. **Auth:** protected routes accept `Authorization: Bearer <access_token>` (JWT) or `X-User-Id` header.

### API endpoints

| Method | Path | Auth | Body | Description |
|--------|------|------|------|-------------|
| GET | `/api/health` | — | — | Health check. Returns `{"status": "ok"}`. |
| POST | `/api/ingest/youtube` | JWT or X-User-Id | `{"url": "...", "clear_existing": true}` | Download YouTube video/playlist and index for this user. |
| POST | `/api/ingest/directory` | JWT or X-User-Id | `{"directory": "videos"}` | Ingest from this user’s directory. |
| POST | `/api/retrieve` | JWT or X-User-Id | `{"query": "..."}` | RAG search over this user’s index. Returns `{ "chunks": [...] }`. |
| POST | `/api/chunk` | JWT or X-User-Id | `{"document_name", "start_time", "end_time", "directory"}` | Create a clip for this user. Returns `url` to play the clip. |
| GET | `/api/chunks` | JWT or X-User-Id | — | List this user’s chunks (from DB: id, filename, document_name, start_time, end_time, video_id). |
| GET | `/api/chunks/files/{filename}` | X-User-Id or `?user_id=` | — | Stream this user’s chunk for playback. |

### Database (users, videos, chats)

A database stores **user details**, **videos** (with Backblaze B2 keys when used), and **chats/messages**. The schema is equivalent to what you’d model in Prisma; this project uses **SQLAlchemy** (Python) with SQLite by default or PostgreSQL via `DATABASE_URL`.

**Tables:**

| Table | Purpose |
|-------|--------|
| **users** | `id`, `external_id`, `email`, `name`, `password_hash`, `created_at`, `updated_at` |
| **sessions** | `id`, `user_id`, `jti`, `expires_at`, `created_at` (refresh token sessions) |
| **videos** | `id`, `user_id`, `filename`, `b2_key`, `source` (youtube \| upload), `source_url`, `created_at` |
| **chunks** | `id`, `user_id`, `video_id` (nullable), `document_name`, `start_time`, `end_time`, `filename`, `created_at` |
| **chats** | `id`, `user_id`, `title`, `created_at`, `updated_at` |
| **messages** | `id`, `chat_id`, `role` (user \| assistant), `content`, `created_at` |

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users/me` | Get current user (JWT or X-User-Id). Returns user id, external_id, email, name. |
| GET | `/api/videos` | List this user’s videos (filename, b2_key, source, source_url). |
| POST | `/api/chats` | Create a chat (optional `title`). Returns `id`, `title`, `created_at`. |
| GET | `/api/chats` | List this user’s chats. |
| GET | `/api/chats/{chat_id}` | Get chat with all messages. |
| POST | `/api/chats/{chat_id}/messages` | Add a message: `{"role": "user" \| "assistant", "content": "..."}`. |

On **ingest (YouTube or directory)**, videos are written to the DB with `filename`, `b2_key` (if B2 is configured), and `source`/`source_url`. Your frontend can list them via `GET /api/videos` and use `b2_key` to build B2 URLs if needed.

Interactive docs: **http://localhost:8000/docs** (Swagger UI).

