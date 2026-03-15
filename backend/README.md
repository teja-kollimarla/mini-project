# MCP-powered video-RAG using Ragie

This project demonstrates how to build a video-based Retrieval Augmented Generation (RAG) system powered by the Model Context Protocol (MCP). It uses [Ragie's](https://www.ragie.ai/) video ingestion and retrieval capabilities to enable semantic search and Q&A over video content and integrate them as MCP tools via Cursor IDE.

**Tech stack:** Ragie (video-RAG), YouTube/yt-dlp (single video or full playlist), optional Backblaze B2 (storage), optional OpenRouter/Llama agent, Cursor (MCP host).

### Quick commands (from project root)

| What | Command |
|------|---------|
| Install deps | `uv sync` |
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

