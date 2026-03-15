"""
FastAPI backend for video RAG: ingest (YouTube/directory), retrieve, and create clips.
Videos and index are isolated per user via the X-User-Id header (required on all data endpoints).
User details, uploaded videos (with B2 keys), and chats are stored in the database.
API mirrors MCP tools: ingest_youtube_tool, ingest_data_tool, retrieve_data_tool, show_video_tool.
Run with: uv run uvicorn app:app --reload --host 0.0.0.0
"""
import os
import re
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db, init_db
from db_service import (
    add_message,
    create_chat,
    get_chat_with_messages,
    get_or_create_user,
    get_user_chats,
    get_user_videos,
    record_videos,
)
from main import (
    VIDEO_EXTENSIONS,
    _get_b2_bucket,
    clear_index,
    ingest_data,
    retrieve_data,
    chunk_video,
    download_youtube,
)


def _safe_user_id(user_id: str | None) -> str:
    """Sanitize user_id for use in paths (alphanumeric, _, - only)."""
    if not user_id or not user_id.strip():
        raise HTTPException(status_code=400, detail="X-User-Id header is required")
    s = re.sub(r"[^a-zA-Z0-9_-]", "", user_id.strip())
    if not s:
        raise HTTPException(status_code=400, detail="X-User-Id must contain at least one alphanumeric character")
    return s

app = FastAPI(
    title="Video RAG API",
    description="Ingest YouTube or local videos, query with RAG, create video clips. All data is isolated per user (X-User-Id). Endpoints align with MCP tools.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request/response models
class IngestYouTubeRequest(BaseModel):
    url: str = Field(..., description="YouTube video or playlist URL")
    clear_existing: bool = Field(True, description="Clear index before ingesting")

class IngestYouTubeResponse(BaseModel):
    success: bool
    message: str
    count: int = 0
    documents: list[str] = []

class IngestDirectoryRequest(BaseModel):
    directory: str = Field("videos", description="Directory path relative to backend")

class IngestDirectoryResponse(BaseModel):
    success: bool
    message: str

class RetrieveRequest(BaseModel):
    query: str = Field(..., description="Search query")

class RetrieveResponse(BaseModel):
    success: bool
    chunks: list[dict]
    message: str | None = None

class ChunkRequest(BaseModel):
    document_name: str = Field(..., description="Video file name (e.g. from retrieve)")
    start_time: float = Field(..., ge=0, description="Start time in seconds")
    end_time: float = Field(..., ge=0, description="End time in seconds")
    directory: str = Field("videos", description="Directory containing the video")

class ChunkResponse(BaseModel):
    success: bool
    message: str
    path: str | None = None
    filename: str | None = None
    b2_key: str | None = None
    url: str | None = None


# --- Database-backed: users, videos, chats ---
class UserResponse(BaseModel):
    id: str
    external_id: str
    email: str | None
    name: str | None
    created_at: str


class VideoResponse(BaseModel):
    id: str
    filename: str
    b2_key: str | None
    source: str
    source_url: str | None
    created_at: str


class ChatCreate(BaseModel):
    title: str | None = None


class MessageCreate(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str = Field(..., min_length=1)


@app.on_event("startup")
def startup():
    init_db()


@app.get("/api/health")
def health():
    """Health check for load balancers and frontend."""
    return {"status": "ok"}


@app.post("/api/ingest/youtube", response_model=IngestYouTubeResponse)
def ingest_youtube(
    body: IngestYouTubeRequest,
    x_user_id: str | None = Header(None, alias="X-User-Id", description="User ID (required for isolation)"),
    db: Session = Depends(get_db),
):
    """MCP: ingest_youtube_tool. Download a YouTube video or playlist and index it in Ragie for this user. Records videos in DB (with B2 keys if configured)."""
    user_id = _safe_user_id(x_user_id)
    try:
        if body.clear_existing:
            clear_index(user_id=user_id)
        output_dir = f"videos/{user_id}"
        files = download_youtube(body.url, output_dir=output_dir, user_id=user_id)
        if not files:
            return IngestYouTubeResponse(
                success=False,
                message="No video files downloaded.",
                count=0,
                documents=[],
            )
        ingest_data(output_dir, extensions=VIDEO_EXTENSIONS, user_id=user_id)
        user = get_or_create_user(db, user_id)
        b2_keys = [f"users/{user_id}/videos/{f}" for f in files] if _get_b2_bucket() else None
        record_videos(db, user.id, files, source="youtube", source_url=body.url, b2_keys=b2_keys)
        return IngestYouTubeResponse(
            success=True,
            message=f"Downloaded and indexed {len(files)} video(s).",
            count=len(files),
            documents=files,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/ingest/directory", response_model=IngestDirectoryResponse)
def ingest_directory(
    body: IngestDirectoryRequest,
    x_user_id: str | None = Header(None, alias="X-User-Id"),
    db: Session = Depends(get_db),
):
    """MCP: ingest_data_tool. Ingest videos from this user's directory into the Ragie index. Records videos in DB."""
    user_id = _safe_user_id(x_user_id)
    try:
        clear_index(user_id=user_id)
        directory = f"videos/{user_id}"
        ingest_data(directory, user_id=user_id)
        user = get_or_create_user(db, user_id)
        vid_dir = Path(directory)
        if vid_dir.exists():
            files = [f.name for f in vid_dir.iterdir() if f.is_file() and f.suffix.lower() in {".mp4", ".mkv", ".webm", ".mov", ".avi", ".flv", ".m4a"}]
            if files:
                b2_keys = [f"users/{user_id}/videos/{f}" for f in files] if _get_b2_bucket() else None
                record_videos(db, user.id, files, source="upload", b2_keys=b2_keys)
        return IngestDirectoryResponse(success=True, message="Data loaded successfully")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/retrieve", response_model=RetrieveResponse)
def retrieve(
    body: RetrieveRequest,
    x_user_id: str | None = Header(None, alias="X-User-Id"),
):
    """MCP: retrieve_data_tool. Query the Ragie index for this user; returns chunks with text, document_name, start_time, end_time."""
    user_id = _safe_user_id(x_user_id)
    try:
        chunks = retrieve_data(body.query, user_id=user_id)
        return RetrieveResponse(success=True, chunks=chunks)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/chunk", response_model=ChunkResponse)
def create_chunk(
    body: ChunkRequest,
    x_user_id: str | None = Header(None, alias="X-User-Id"),
):
    """MCP: show_video_tool. Create a video clip from a segment for this user. Returns URL to play the clip."""
    user_id = _safe_user_id(x_user_id)
    try:
        directory = body.directory if body.directory != "videos" else f"videos/{user_id}"
        result = chunk_video(
            body.document_name,
            body.start_time,
            body.end_time,
            directory=directory,
            user_id=user_id,
        )
        path = result.get("path")
        b2_key = result.get("b2_key")
        filename = path.name if path else None
        url = f"/api/chunks/files/{filename}?user_id={user_id}" if filename else None
        return ChunkResponse(
            success=True,
            message="Video chunk created successfully",
            path=str(path) if path else None,
            filename=filename,
            b2_key=b2_key,
            url=url,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Serve generated clips (per-user subdirs under video_chunks)
CHUNKS_BASE = Path(__file__).parent / "video_chunks"


def _chunks_dir_for_user(user_id: str) -> Path:
    safe = re.sub(r"[^a-zA-Z0-9_-]", "", user_id)
    return CHUNKS_BASE / (safe or "default")


@app.get("/api/chunks")
def list_chunks(x_user_id: str | None = Header(None, alias="X-User-Id")):
    """List this user's video chunk filenames."""
    user_id = _safe_user_id(x_user_id)
    dir_path = _chunks_dir_for_user(user_id)
    if not dir_path.exists():
        return {"chunks": []}
    files = [f.name for f in dir_path.iterdir() if f.is_file() and f.suffix.lower() == ".mp4"]
    return {"chunks": sorted(files)}


@app.get("/api/chunks/files/{filename}")
def get_chunk_file(
    filename: str,
    x_user_id: str | None = Header(None, alias="X-User-Id"),
    user_id: str | None = None,
):
    """Stream this user's video chunk for playback. Pass X-User-Id header or user_id query param."""
    uid = user_id or x_user_id
    if not uid:
        raise HTTPException(status_code=400, detail="X-User-Id header or user_id query param required")
    safe_uid = _safe_user_id(uid)
    safe_name = Path(filename).name
    path = _chunks_dir_for_user(safe_uid) / safe_name
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Chunk not found")
    return FileResponse(path, media_type="video/mp4")


# --- User (get or create by X-User-Id) ---
@app.get("/api/users/me", response_model=UserResponse)
def get_current_user(
    x_user_id: str | None = Header(None, alias="X-User-Id"),
    db: Session = Depends(get_db),
):
    """Get or create user by X-User-Id. Use this to resolve the current user and store optional email/name."""
    user_id = _safe_user_id(x_user_id)
    user = get_or_create_user(db, user_id)
    return UserResponse(
        id=user.id,
        external_id=user.external_id,
        email=user.email,
        name=user.name,
        created_at=user.created_at.isoformat(),
    )


# --- Videos (list stored videos for user, including B2 keys) ---
@app.get("/api/videos", response_model=list[VideoResponse])
def list_videos(
    x_user_id: str | None = Header(None, alias="X-User-Id"),
    db: Session = Depends(get_db),
    limit: int = 200,
):
    """List videos uploaded/ingested by this user (from DB; includes B2 keys when set)."""
    user_id = _safe_user_id(x_user_id)
    user = get_or_create_user(db, user_id)
    videos = get_user_videos(db, user.id, limit=limit)
    return [
        VideoResponse(
            id=v.id,
            filename=v.filename,
            b2_key=v.b2_key,
            source=v.source,
            source_url=v.source_url,
            created_at=v.created_at.isoformat(),
        )
        for v in videos
    ]


# --- Chats and messages ---
@app.post("/api/chats")
def create_chat_endpoint(
    body: ChatCreate | None = None,
    x_user_id: str | None = Header(None, alias="X-User-Id"),
    db: Session = Depends(get_db),
):
    """Create a new chat for this user. Returns chat id and title."""
    user_id = _safe_user_id(x_user_id)
    user = get_or_create_user(db, user_id)
    chat = create_chat(db, user.id, title=(body.title if body else None))
    return {"id": chat.id, "title": chat.title, "created_at": chat.created_at.isoformat()}


@app.get("/api/chats")
def list_chats(
    x_user_id: str | None = Header(None, alias="X-User-Id"),
    db: Session = Depends(get_db),
    limit: int = 50,
):
    """List this user's chats (newest first)."""
    user_id = _safe_user_id(x_user_id)
    user = get_or_create_user(db, user_id)
    chats = get_user_chats(db, user.id, limit=limit)
    return [
        {"id": c.id, "title": c.title, "created_at": c.created_at.isoformat(), "updated_at": c.updated_at.isoformat()}
        for c in chats
    ]


@app.get("/api/chats/{chat_id}")
def get_chat(
    chat_id: str,
    x_user_id: str | None = Header(None, alias="X-User-Id"),
    db: Session = Depends(get_db),
):
    """Get a chat with all its messages."""
    user_id = _safe_user_id(x_user_id)
    user = get_or_create_user(db, user_id)
    chat = get_chat_with_messages(db, chat_id, user.id)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    return {
        "id": chat.id,
        "title": chat.title,
        "created_at": chat.created_at.isoformat(),
        "updated_at": chat.updated_at.isoformat(),
        "messages": [
            {"id": m.id, "role": m.role, "content": m.content, "created_at": m.created_at.isoformat()}
            for m in chat.messages
        ],
    }


@app.post("/api/chats/{chat_id}/messages")
def add_message_endpoint(
    chat_id: str,
    body: MessageCreate,
    x_user_id: str | None = Header(None, alias="X-User-Id"),
    db: Session = Depends(get_db),
):
    """Add a message (user or assistant) to a chat."""
    user_id = _safe_user_id(x_user_id)
    user = get_or_create_user(db, user_id)
    chat = get_chat_with_messages(db, chat_id, user.id)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    msg = add_message(db, chat.id, body.role, body.content)
    return {"id": msg.id, "role": msg.role, "content": msg.content, "created_at": msg.created_at.isoformat()}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
