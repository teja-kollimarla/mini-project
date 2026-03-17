"""
FastAPI backend for video RAG: ingest (YouTube/directory), retrieve, and create clips.
Auth: JWT (access + refresh) and bcrypt; sessions stored in DB.
Videos and index are isolated per user via Authorization Bearer token or X-User-Id header.
Run with: uv run uvicorn app:app --reload --host 0.0.0.0
"""
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import Depends, File, Form, FastAPI, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from auth import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    create_access_token,
    create_refresh_token,
    decode_token,
    get_external_id_from_access_token,
    hash_password,
    verify_password,
)
from database import get_db, init_db
from db_service import (
    add_message,
    create_chat,
    create_session,
    get_chat_with_messages,
    get_or_create_user,
    get_user_by_email,
    get_user_chats,
    get_user_videos,
    get_user_chunks,
    get_video_by_user_and_filename,
    get_session_by_jti,
    record_chunk,
    record_video,
    record_videos,
    revoke_session,
    update_chat_title,
    update_video_b2_key,
)
from main import (
    VIDEO_EXTENSIONS,
    _BACKEND_DIR,
    _cloudinary_configured,
    chunk_video,
    cloudinary_segment_url,
    clear_index,
    download_youtube,
    ingest_data,
    ingest_data_from_urls,
    chunks_look_relevant,
    llm_answer_from_chunks,
    llm_general_answer,
    recover_video_to_cloudinary,
    retrieve_data,
    upload_directory_to_cloudinary,
)


def _safe_user_id(user_id: str | None) -> str:
    """Sanitize user_id for use in paths (alphanumeric, _, - only)."""
    if not user_id or not user_id.strip():
        raise HTTPException(status_code=400, detail="X-User-Id header is required")
    s = re.sub(r"[^a-zA-Z0-9_-]", "", user_id.strip())
    if not s:
        raise HTTPException(status_code=400, detail="X-User-Id must contain at least one alphanumeric character")
    return s


def get_current_user_id(
    authorization: str | None = Header(None),
    x_user_id: str | None = Header(None, alias="X-User-Id"),
) -> str:
    """Resolve user from Authorization Bearer token (JWT) or fallback to X-User-Id header."""
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:].strip()
        external_id = get_external_id_from_access_token(token)
        if external_id:
            return _safe_user_id(external_id)
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    if x_user_id:
        return _safe_user_id(x_user_id)
    raise HTTPException(status_code=401, detail="Authorization Bearer token or X-User-Id header required")

app = FastAPI(
    title="Video RAG API",
    description="Ingest YouTube or local videos, query with RAG, create video clips. All data is isolated per user (X-User-Id). Endpoints align with MCP tools.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("FRONTEND_URL") or "*"],
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


class IngestUploadResponse(BaseModel):
    success: bool
    message: str
    count: int = 0
    documents: list[str] = []
    indexing_status: list[dict] = []  # [{"document": name, "status": "ready"|"processing"|"submitted"|"error"}, ...]

class RetrieveRequest(BaseModel):
    query: str = Field(..., description="Search query")

class RetrieveResponse(BaseModel):
    success: bool
    chunks: list[dict]
    answer_text: str | None = None
    answer_html: str | None = None
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
class RegisterRequest(BaseModel):
    email: str = Field(..., min_length=1, max_length=255)
    name: str = Field("", max_length=255)
    password: str = Field(..., min_length=6, max_length=128)


class RegisterResponse(BaseModel):
    id: str
    external_id: str
    email: str | None
    name: str | None
    created_at: str
    access_token: str
    refresh_token: str
    expires_in: int  # seconds
    token_type: str = "bearer"


class LoginRequest(BaseModel):
    email: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(..., min_length=1)


class UserResponse(BaseModel):
    id: str
    external_id: str
    email: str | None
    name: str | None
    created_at: str


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    expires_in: int
    token_type: str = "bearer"
    user: UserResponse


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


class ChatUpdate(BaseModel):
    title: str | None = None


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
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """MCP: ingest_youtube_tool. Download a YouTube video or playlist and index it in Ragie for this user. Records videos in DB (with B2 keys if configured)."""
    try:
        if body.clear_existing:
            clear_index(user_id=user_id)
        output_dir = f"videos/{user_id}"
        # Parallel pipeline: each video is downloaded → uploaded to B2 → we save to DB as it completes
        results = download_youtube(body.url, output_dir=output_dir, user_id=user_id)
        if not results:
            return IngestYouTubeResponse(
                success=False,
                message="No video files downloaded. If YouTube asked to sign in or confirm you're not a bot, set YT_DLP_COOKIES_FILE in backend .env to a cookies.txt path (export from browser).",
                count=0,
                documents=[],
            )
        user = get_or_create_user(db, user_id)
        files = []
        for filename, b2_key in results:
            record_video(db, user.id, filename, source="youtube", source_url=body.url, b2_key=b2_key)
            files.append(filename)
        # Upload to B2 is done inside download_youtube; now ingest all downloaded files to Ragie
        ingest_data(output_dir, extensions=VIDEO_EXTENSIONS, user_id=user_id)
        return IngestYouTubeResponse(
            success=True,
            message=f"Downloaded and indexed {len(files)} video(s).",
            count=len(files),
            documents=files,
        )
    except Exception as e:
        err_msg = str(e)
        if "ffmpeg" in err_msg.lower() or "merge" in err_msg.lower():
            raise HTTPException(
                status_code=503,
                detail="FFmpeg is required for YouTube download but is not installed. Install FFmpeg and add it to your PATH: https://ffmpeg.org/download.html (Windows: choco install ffmpeg, or download from https://www.gyan.dev/ffmpeg/builds/)",
            )
        if "sign in" in err_msg.lower() or "not a bot" in err_msg.lower() or "cookies" in err_msg.lower():
            raise HTTPException(
                status_code=503,
                detail="YouTube is asking to sign in / confirm you're not a bot. Set YT_DLP_COOKIES_FILE in backend .env to the path of a cookies.txt file (export from your browser when logged into YouTube).",
            )
        raise HTTPException(status_code=500, detail=err_msg)


@app.post("/api/ingest/directory", response_model=IngestDirectoryResponse)
def ingest_directory(
    body: IngestDirectoryRequest,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """MCP: ingest_data_tool. Ingest videos from this user's directory into the Ragie index. Records videos in DB."""
    try:
        clear_index(user_id=user_id)
        directory = f"videos/{user_id}"
        ingest_data(directory, user_id=user_id)
        user = get_or_create_user(db, user_id)
        vid_dir = Path(directory)
        if vid_dir.exists():
            files = [f.name for f in vid_dir.iterdir() if f.is_file() and f.suffix.lower() in {".mp4", ".mkv", ".webm", ".mov", ".avi", ".flv", ".m4a"}]
            if files:
                if _cloudinary_configured():
                    uploaded = upload_directory_to_cloudinary(vid_dir, f"users/{user_id}/videos")
                    url_by_name = {name: url for name, url in uploaded}
                    b2_keys = [url_by_name.get(f) for f in files]
                else:
                    b2_keys = None
                record_videos(db, user.id, files, source="upload", b2_keys=b2_keys)
        return IngestDirectoryResponse(success=True, message="Data loaded successfully")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Allowed video extensions for upload
UPLOAD_VIDEO_EXTENSIONS = {".mp4", ".mkv", ".webm", ".mov", ".avi", ".flv", ".m4a"}


@app.post("/api/ingest/upload", response_model=IngestUploadResponse)
async def ingest_upload(
    files: list[UploadFile] = File(..., alias="files", description="Video files to upload and index"),
    clear_existing: bool = Form(True, description="Clear Ragie index before ingesting"),
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """Upload custom video files, save to user directory, optional Cloudinary, record in DB, and index in Ragie."""
    file_list = files if isinstance(files, list) else [files]
    if not file_list:
        return IngestUploadResponse(success=False, message="No files in request. Use multipart/form-data with key 'files'.", count=0, documents=[])
    try:
        if clear_existing:
            clear_index(user_id=user_id)
        output_dir = Path(f"videos/{user_id}")
        output_dir.mkdir(parents=True, exist_ok=True)
        saved_names: list[str] = []
        for upload in file_list:
            if not upload.filename:
                continue
            ext = Path(upload.filename).suffix.lower()
            if ext not in UPLOAD_VIDEO_EXTENSIONS:
                continue
            base = re.sub(r"[^\w\-.]", "_", Path(upload.filename).stem)[:80]
            name = f"{base}{ext}"
            dest = output_dir / name
            content = await upload.read()
            dest.write_bytes(content)
            saved_names.append(name)
        if not saved_names:
            allowed = ", ".join(sorted(UPLOAD_VIDEO_EXTENSIONS))
            return IngestUploadResponse(
                success=False,
                message=f"No valid video files. Allowed extensions: {allowed}. Ensure each file has a valid filename.",
                count=0,
                documents=[],
            )
        url_by_name: dict[str, str | None] = {}
        if _cloudinary_configured():
            uploaded_list = upload_directory_to_cloudinary(output_dir, f"users/{user_id}/videos")
            url_by_name = {n: u for n, u in uploaded_list}
        cloudinary_failed = [n for n in saved_names if _cloudinary_configured() and not url_by_name.get(n)]
        user = get_or_create_user(db, user_id)
        for name in saved_names:
            record_video(db, user.id, name, source="upload", source_url=None, b2_key=url_by_name.get(name))
        indexing_status: list[dict] = []
        url_pairs = [(url_by_name[name], name) for name in saved_names if url_by_name.get(name) and str(url_by_name[name]).startswith("http")]
        if url_pairs:
            statuses = ingest_data_from_urls(url_pairs, user_id=user_id)
            indexing_status = [{"document": name, "status": st} for name, st in statuses]
        else:
            statuses = ingest_data(str(output_dir), extensions=VIDEO_EXTENSIONS, user_id=user_id, only_files=saved_names)
            indexing_status = [{"document": name, "status": st} for name, st in statuses]
        all_ready = all(s.get("status") == "ready" for s in indexing_status)
        any_processing = any(s.get("status") == "processing" for s in indexing_status)
        if all_ready:
            msg = f"Uploaded {len(saved_names)} video(s). All indexed and ready for search."
        elif any_processing:
            msg = f"Uploaded {len(saved_names)} video(s). Some still processing; search may work shortly."
        else:
            msg = f"Uploaded {len(saved_names)} video(s). Indexing in progress; search may work in a few minutes."
        if cloudinary_failed:
            msg += f" ({len(cloudinary_failed)} not uploaded to Cloudinary—connection reset by remote; saved locally, indexed, and clip playback will use local file.)"
        return IngestUploadResponse(
            success=True,
            message=msg,
            count=len(saved_names),
            documents=saved_names,
            indexing_status=indexing_status,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/retrieve", response_model=RetrieveResponse)
def retrieve(
    body: RetrieveRequest,
    user_id: str = Depends(get_current_user_id),
):
    """MCP: retrieve_data_tool. Query the Ragie index for this user; returns chunks with text, document_name, start_time, end_time."""
    try:
        chunks = retrieve_data(body.query, user_id=user_id)
        answer = None
        relevant = bool(chunks and chunks_look_relevant(body.query, chunks))
        if relevant:
            answer = llm_answer_from_chunks(body.query, chunks)
        if not answer:
            # If chunks are irrelevant (or none), optionally answer generally via LLM
            answer = llm_general_answer(body.query)
        # If chunks are not relevant and we couldn't answer generally, avoid returning misleading chunks
        if (not relevant) and not answer:
            return RetrieveResponse(
                success=True,
                chunks=[],
                answer_text=None,
                answer_html=None,
                message="No relevant segments found in your videos for that question.",
            )
        return RetrieveResponse(
            success=True,
            chunks=chunks if relevant else [],
            answer_text=answer.get("text") if isinstance(answer, dict) else None,
            answer_html=answer.get("html") if isinstance(answer, dict) else None,
            message=None if relevant else "No relevant segments found in your videos for that question.",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/chunk", response_model=ChunkResponse)
def create_chunk(
    body: ChunkRequest,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """MCP: show_video_tool. Return a segment URL: Cloudinary so/du if video is on Cloudinary, else create local clip."""
    user = get_or_create_user(db, user_id)
    video = get_video_by_user_and_filename(db, user.id, body.document_name)
    directory = body.directory if body.directory != "videos" else f"videos/{user_id}"
    video_path = _BACKEND_DIR / directory / body.document_name

    # If video is on Cloudinary: fetch segment via URL params (so=start offset, du=duration) — no download
    cloudinary_url = video.b2_key if video and video.b2_key else None
    if cloudinary_url and str(cloudinary_url).startswith("http"):
        segment_url = cloudinary_segment_url(
            cloudinary_url, body.start_time, body.end_time
        )
        return ChunkResponse(
            success=True,
            message="Stream segment from Cloudinary",
            url=segment_url,
            filename=None,
            path=None,
            b2_key=segment_url,
        )

    # Not on disk and no Cloudinary: try to recover from source (e.g. YouTube) and add to Cloudinary
    if not video_path.exists():
        if video and video.source_url and str(video.source_url).startswith("http") and _cloudinary_configured():
            cloudinary_url, recover_error = recover_video_to_cloudinary(
                video.source_url, video_path, user_id
            )
            if cloudinary_url:
                update_video_b2_key(db, video.id, cloudinary_url)
                segment_url = cloudinary_segment_url(
                    cloudinary_url, body.start_time, body.end_time
                )
                return ChunkResponse(
                    success=True,
                    message="Video recovered from source and streamed from Cloudinary",
                    url=segment_url,
                    filename=None,
                    path=None,
                    b2_key=segment_url,
                )
            # Recovery failed: tell user why (e.g. YouTube bot block, Cloudinary upload failed)
            raise HTTPException(
                status_code=502,
                detail=f"Recovery from source failed: {recover_error or 'Unknown error'}. Re-upload the video or try again.",
            )
        if not video:
            raise HTTPException(
                status_code=404,
                detail="Video not in database. Ingest or upload the video first.",
            )
        if not video.source_url:
            raise HTTPException(
                status_code=404,
                detail="Video not found locally and no source URL (uploaded videos cannot be recovered). Re-upload the video.",
            )
        raise HTTPException(
            status_code=404,
            detail="Video not found locally and no Cloudinary URL. Re-upload or re-ingest the video.",
        )
    try:
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
        if filename:
            record_chunk(
                db,
                user.id,
                body.document_name,
                body.start_time,
                body.end_time,
                filename,
                video_id=video.id if video else None,
            )
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
def list_chunks(
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """List this user's chunks from DB (with video link). Returns list of chunk objects."""
    user = get_or_create_user(db, user_id)
    chunks = get_user_chunks(db, user.id)
    return {
        "chunks": [
            {
                "id": c.id,
                "filename": c.filename,
                "document_name": c.document_name,
                "start_time": c.start_time,
                "end_time": c.end_time,
                "video_id": c.video_id,
                "created_at": c.created_at.isoformat(),
            }
            for c in chunks
        ]
    }


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


# --- Register (create user with bcrypt password, JWT + session in DB) ---
@app.post("/api/register", response_model=RegisterResponse)
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    """Create a new user. Password is hashed with bcrypt. Returns JWT access + refresh tokens."""
    try:
        email = body.email.strip().lower()
        if not email:
            raise HTTPException(status_code=400, detail="Email is required")
        existing = get_user_by_email(db, email)
        if existing:
            raise HTTPException(status_code=409, detail="An account with this email already exists")
        external_id = re.sub(r"[^a-zA-Z0-9_.-]", "_", email).strip("_") or f"user_{email[:8]}"
        password_hash = hash_password(body.password)
        user = get_or_create_user(db, external_id, email=email, name=(body.name.strip() or None), password_hash=password_hash)
        jti = str(uuid.uuid4())
        expires_at = datetime.now(timezone.utc) + timedelta(days=7)
        create_session(db, user.id, jti, expires_at)
        access_token = create_access_token(user.external_id)
        refresh_token = create_refresh_token(user.external_id, jti)
        return RegisterResponse(
            id=user.id,
            external_id=user.external_id,
            email=user.email,
            name=user.name,
            created_at=user.created_at.isoformat(),
            access_token=access_token,
            refresh_token=refresh_token,
            expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
            token_type="bearer",
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Registration failed: {str(e)}")


# --- Login (bcrypt verify, JWT + session) ---
@app.post("/api/login", response_model=LoginResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    """Authenticate with email and password. Returns JWT access + refresh tokens."""
    email = body.email.strip().lower()
    user = get_user_by_email(db, email)
    if not user or not user.password_hash:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    jti = str(uuid.uuid4())
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    create_session(db, user.id, jti, expires_at)
    access_token = create_access_token(user.external_id)
    refresh_token = create_refresh_token(user.external_id, jti)
    return LoginResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        token_type="bearer",
        user=UserResponse(
            id=user.id,
            external_id=user.external_id,
            email=user.email,
            name=user.name,
            created_at=user.created_at.isoformat(),
        ),
    )


# --- Refresh token ---
@app.post("/api/refresh", response_model=LoginResponse)
def refresh_tokens(body: RefreshRequest, db: Session = Depends(get_db)):
    """Issue new access + refresh tokens using a valid refresh token."""
    payload = decode_token(body.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    jti = payload.get("jti")
    sub = payload.get("sub")
    if not jti or not sub:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    session = get_session_by_jti(db, jti)
    if not session or session.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Refresh token expired or revoked")
    user = get_or_create_user(db, sub)
    new_jti = str(uuid.uuid4())
    new_expires = datetime.now(timezone.utc) + timedelta(days=7)
    create_session(db, user.id, new_jti, new_expires)
    revoke_session(db, jti)
    access_token = create_access_token(user.external_id)
    refresh_token = create_refresh_token(user.external_id, new_jti)
    return LoginResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        token_type="bearer",
        user=UserResponse(
            id=user.id,
            external_id=user.external_id,
            email=user.email,
            name=user.name,
            created_at=user.created_at.isoformat(),
        ),
    )


# --- Logout (revoke session) ---
@app.post("/api/logout")
def logout(body: RefreshRequest, db: Session = Depends(get_db)):
    """Revoke the refresh token (session)."""
    payload = decode_token(body.refresh_token)
    if payload and payload.get("type") == "refresh" and payload.get("jti"):
        revoke_session(db, payload["jti"])
    return {"message": "Logged out"}


# --- User (JWT or X-User-Id) ---
@app.get("/api/users/me", response_model=UserResponse)
def get_current_user(
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """Get or create user. Auth via Bearer token (JWT) or X-User-Id header."""
    user = get_or_create_user(db, user_id)
    return UserResponse(
        id=user.id,
        external_id=user.external_id,
        email=user.email,
        name=user.name,
        created_at=user.created_at.isoformat(),
    )


# --- Videos (list stored videos for user, including B2 keys) ---
VIDEOS_BASE = Path(__file__).parent / "videos"


@app.get("/api/videos", response_model=list[VideoResponse])
def list_videos(
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    limit: int = 200,
):
    """List videos uploaded/ingested by this user (from DB; includes B2 keys when set)."""
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


@app.get("/api/videos/stream/{filename}")
def stream_video(
    filename: str,
    x_user_id: str | None = Header(None, alias="X-User-Id"),
    user_id: str | None = None,
):
    """Stream this user's video file for playback. Use when b2_key is null (local file). Pass user_id query or X-User-Id header."""
    uid = user_id or x_user_id
    if not uid:
        raise HTTPException(status_code=400, detail="user_id query or X-User-Id header required")
    safe_uid = _safe_user_id(uid)
    safe_name = Path(filename).name
    path = VIDEOS_BASE / safe_uid / safe_name
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Video file not found")
    return FileResponse(path, media_type="video/mp4")


# --- Chats and messages ---
@app.post("/api/chats")
def create_chat_endpoint(
    body: ChatCreate | None = None,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """Create a new chat for this user. Returns chat id and title."""
    user = get_or_create_user(db, user_id)
    chat = create_chat(db, user.id, title=(body.title if body else None))
    return {"id": chat.id, "title": chat.title, "created_at": chat.created_at.isoformat()}


@app.get("/api/chats")
def list_chats(
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
    limit: int = 50,
):
    """List this user's chats (newest first)."""
    user = get_or_create_user(db, user_id)
    chats = get_user_chats(db, user.id, limit=limit)
    return [
        {"id": c.id, "title": c.title, "created_at": c.created_at.isoformat(), "updated_at": c.updated_at.isoformat()}
        for c in chats
    ]


@app.get("/api/chats/{chat_id}")
def get_chat(
    chat_id: str,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """Get a chat with all its messages."""
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


@app.patch("/api/chats/{chat_id}")
def update_chat(
    chat_id: str,
    body: ChatUpdate,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """Update a chat (currently only title)."""
    user = get_or_create_user(db, user_id)
    chat = update_chat_title(db, chat_id, user.id, body.title)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    return {"id": chat.id, "title": chat.title, "updated_at": chat.updated_at.isoformat()}


@app.post("/api/chats/{chat_id}/messages")
def add_message_endpoint(
    chat_id: str,
    body: MessageCreate,
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """Add a message (user or assistant) to a chat."""
    user = get_or_create_user(db, user_id)
    chat = get_chat_with_messages(db, chat_id, user.id)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    msg = add_message(db, chat.id, body.role, body.content)
    return {"id": msg.id, "role": msg.role, "content": msg.content, "created_at": msg.created_at.isoformat()}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
