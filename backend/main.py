import os
import re
import shutil
import time
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from dotenv import load_dotenv
import cloudinary
import cloudinary.uploader
import httpx
from ragie import Ragie
from moviepy import VideoFileClip
import yt_dlp
from openai import OpenAI

load_dotenv()

# FFmpeg: allow cross-platform configuration.
# - Windows local dev: set FFMPEG_LOCATION to full path of ffmpeg.exe
# - Railway/Linux: install ffmpeg via apt and omit FFMPEG_LOCATION; we default to "ffmpeg"
_ffmpeg_exe = os.getenv("FFMPEG_LOCATION", "").strip() or "ffmpeg"
# Use env vars (compatible across MoviePy/imageio versions)
os.environ.setdefault("IMAGEIO_FFMPEG_EXE", _ffmpeg_exe)
try:
    import moviepy.config as _mp_cfg

    if hasattr(_mp_cfg, "FFMPEG_BINARY"):
        _mp_cfg.FFMPEG_BINARY = _ffmpeg_exe  # type: ignore[attr-defined]
except Exception:
    # Non-fatal: MoviePy will still try to resolve ffmpeg from PATH
    pass

# Cloudinary: configure once at startup (CLOUDINARY_URL or cloud_name + api_key + api_secret)
_cloudinary_url = os.getenv("CLOUDINARY_URL", "").strip()
if _cloudinary_url.startswith("cloudinary://"):
    cloudinary.config()
else:
    _cn = os.getenv("CLOUDINARY_CLOUD_NAME")
    _ak = os.getenv("CLOUDINARY_API_KEY")
    _as = os.getenv("CLOUDINARY_API_SECRET")
    if _cn and _ak and _as:
        cloudinary.config(cloud_name=_cn, api_key=_ak, api_secret=_as)

# Video file extensions for ingestion and YouTube output
VIDEO_EXTENSIONS = {".mp4", ".mkv", ".webm", ".mov", ".avi", ".flv", ".m4a"}


def _yt_dlp_cookie_opts() -> dict:
    """Cookie options for YouTube bot check: cookiesfrombrowser (e.g. chrome) or cookiefile (cookies.txt)."""
    opts = {}
    # 1) Browser cookies — set YT_DLP_COOKIES_FROM_BROWSER=chrome (or firefox, edge). Use tuple so yt-dlp gets one arg.
    browser = os.getenv("YT_DLP_COOKIES_FROM_BROWSER", "").strip().lower()
    if browser:
        opts["cookiesfrombrowser"] = (browser.split(":")[0],)
    # 2) Inline cookie content via env var — write to temp file at startup (for Railway where you can't upload files)
    cookie_content = os.getenv("YT_DLP_COOKIES_CONTENT", "").strip()
    if cookie_content:
        tmp_cookie_path = Path("/tmp/yt_cookies.txt")
        tmp_cookie_path.write_text(cookie_content)
        opts["cookiefile"] = str(tmp_cookie_path)
        return opts
    # 3) Exported cookies.txt file path — YT_DLP_COOKIES_FILE env, or default backend/cookies.txt if it exists
    cookiefile = os.getenv("YT_DLP_COOKIES_FILE", "").strip()
    if not cookiefile:
        default_cookies = Path(__file__).resolve().parent / "cookies.txt"
        if default_cookies.is_file():
            cookiefile = str(default_cookies)
    if cookiefile and Path(cookiefile).is_file():
        opts["cookiefile"] = cookiefile
    return opts


def _yt_dlp_youtube_opts() -> dict:
    """Options that may help with YouTube bot detection when not using cookies (e.g. Android client)."""
    return {
        "extractor_args": {"youtube": {"player_client": ["android"], "player_skip": ["webpage", "configs"]}},
    }


def _partition_for_user(user_id: str) -> str:
    """Ragie partition must be lowercase alphanumeric plus _ and - only."""
    if not user_id:
        return ""
    s = re.sub(r"[^a-z0-9_-]", "", user_id.lower().replace(" ", "_"))
    return s or "default"

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Startup diagnostics: confirm ffmpeg is reachable and log backend dir
_BACKEND_DIR = Path(__file__).resolve().parent
logger.info("Backend directory: %s", _BACKEND_DIR)
if shutil.which(_ffmpeg_exe):
    logger.info("ffmpeg found: %s", shutil.which(_ffmpeg_exe))
else:
    logger.warning("ffmpeg NOT found at '%s' — video merging/clipping will fail", _ffmpeg_exe)

# Gemini/OpenAI/OpenRouter (optional) for LLM answers from retrieved chunks
_gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
_gemini_model = os.getenv("GEMINI_MODEL", "gemini-2.0-flash").strip()
_gemini_client: OpenAI | None = None
if _gemini_key:
    _gemini_client = OpenAI(
        base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        api_key=_gemini_key,
    )

_openai_key = os.getenv("OPENAI_API_KEY", "").strip()
_openai_model = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip()
_openai_client: OpenAI | None = None
if _openai_key:
    _openai_client = OpenAI(api_key=_openai_key)

_openrouter_key = os.getenv("OPENROUTER_API_KEY", "").strip()
_openrouter_model = os.getenv("OPENROUTER_MODEL", "meta-llama/llama-3.3-70b-instruct:free").strip()
_openrouter_fallback_models = [
    m.strip()
    for m in os.getenv("OPENROUTER_FALLBACK_MODELS", "").split(",")
    if m.strip()
]
_openrouter_client: OpenAI | None = None
if _openrouter_key:
    _openrouter_client = OpenAI(base_url="https://openrouter.ai/api/v1", api_key=_openrouter_key)

# Simple in-memory cache to reduce OpenRouter calls (helps avoid 429 RPM limits)
_llm_cache: dict[str, tuple[float, dict]] = {}
_llm_cache_ttl_s = float(os.getenv("LLM_CACHE_TTL_SECONDS", "600").strip() or "600")


def _cache_get(key: str) -> dict | None:
    try:
        item = _llm_cache.get(key)
        if not item:
            return None
        ts, val = item
        if time.time() - ts > _llm_cache_ttl_s:
            _llm_cache.pop(key, None)
            return None
        return val
    except Exception:
        return None


def _cache_put(key: str, val: dict) -> None:
    try:
        _llm_cache[key] = (time.time(), val)
    except Exception:
        return None


def _openrouter_models() -> list[str]:
    out = [_openrouter_model]
    for m in _openrouter_fallback_models:
        if m and m not in out:
            out.append(m)
    return out


def _answer_models() -> list[tuple[OpenAI, str]]:
    """Preferred answer providers, in order."""
    out: list[tuple[OpenAI, str]] = []
    if _gemini_client:
        out.append((_gemini_client, _gemini_model))
    if _openai_client:
        out.append((_openai_client, _openai_model))
    if _openrouter_client:
        for model in _openrouter_models():
            out.append((_openrouter_client, model))
    return out


def _strip_markdown_json(content: str) -> str:
    """Remove ```json ... ``` fences around JSON, if present."""
    s = (content or "").strip()
    if not s.startswith("```"):
        return s
    # Drop leading backticks and optional language tag
    s = s.lstrip("`")
    nl = s.find("\n")
    if nl != -1:
        s = s[nl + 1 :]
    # Drop trailing ```
    if s.endswith("```"):
        s = s[: -3]
    return s.strip()


def _phi3_fallback_answer(prompt: str) -> dict | None:
    """
    Final fallback: call external phi-3 endpoint that returns {"reply": "..."}.
    Endpoint: https://phi-3-production.up.railway.app/chat
    """
    url = "https://phi-3-production.up.railway.app/chat"
    try:
        resp = httpx.post(url, json={"prompt": prompt}, timeout=15.0)
        resp.raise_for_status()
        data = resp.json()
        reply = (data.get("reply") or "").strip()
        if not reply:
            return None
        return {"text": reply, "html": ""}
    except Exception as e:
        logger.warning("phi-3 fallback failed: %s", e)
        return None


def _is_rate_limit_error(e: Exception) -> bool:
    s = str(e).lower()
    return "rate limit" in s or "error code: 429" in s or "'code': 429" in s

_ragie_key = os.getenv("RAGIE_API_KEY", "").strip()
ragie: Ragie | None = None
if _ragie_key:
    ragie = Ragie(auth=_ragie_key)


def _require_ragie() -> Ragie:
    if ragie is None:
        raise RuntimeError("RAGIE_API_KEY is not set. Set it in environment variables to use ingest/retrieve.")
    return ragie


# Cloudinary (optional): set CLOUDINARY_URL or CLOUDINARY_CLOUD_NAME + API_KEY + API_SECRET
def _cloudinary_configured() -> bool:
    """True if Cloudinary is configured (CLOUDINARY_URL or cloud_name + api_key + api_secret)."""
    if os.getenv("CLOUDINARY_URL", "").strip().startswith("cloudinary://"):
        return True
    cloud_name = os.getenv("CLOUDINARY_CLOUD_NAME")
    api_key = os.getenv("CLOUDINARY_API_KEY")
    api_secret = os.getenv("CLOUDINARY_API_SECRET")
    return bool(cloud_name and api_key and api_secret)


def _cloudinary_sanitize_id(s: str, allow_slash: bool = False) -> str:
    """Cloudinary public_id: letters, numbers, _, -. Folder can also have /."""
    if allow_slash:
        out = re.sub(r"[^a-zA-Z0-9_\-/]", "_", s).strip("/")
    else:
        out = re.sub(r"[^a-zA-Z0-9_\-]", "_", s)
    return out or "video"


def _is_connection_error(e: Exception) -> bool:
    """True if error is likely connection abort/reset (e.g. 10053 local, 10054 remote host closed)."""
    s = str(e).lower()
    return (
        "10053" in str(e)
        or "10054" in str(e)
        or "connection" in s
        or "abort" in s
        or "reset" in s
        or "broken pipe" in s
        or "econnreset" in s
        or "forcibly closed" in s
    )


def _is_cloudinary_plan_limit_error(e: Exception) -> bool:
    """True if Cloudinary rejected due to file size limit (e.g. free tier 100 MB max)."""
    s = str(e)
    return "file size too large" in s.lower() or "maximum is 104857600" in s.lower() or "upgrade your plan" in s.lower()


def _cloudinary_upload(local_path: Path, folder: str, public_id: str | None = None) -> str | None:
    """Upload a file to Cloudinary as video using the official Python SDK (upload / upload_large). Config set at startup."""
    if not _cloudinary_configured():
        return None
    pid = _cloudinary_sanitize_id((public_id or local_path.stem) or "video", allow_slash=False)
    folder_clean = _cloudinary_sanitize_id(folder, allow_slash=True) or None
    file_size_mb = local_path.stat().st_size / (1024 * 1024)
    # SDK params; resource_type="video" passed explicitly so SDK uses video endpoint (not image)
    opts = {
        "public_id": pid,
        "overwrite": True,
    }
    if folder_clean:
        opts["asset_folder"] = folder_clean
    max_attempts = 5
    backoff = 15  # longer wait when remote host closes connection (10054)
    try:
        # Large files (> 100 MB): use upload_large. Cloudinary requires chunks > 5 MB; default 6 MB per docs.
        # Use larger chunks for very large files (e.g. 1 GB) to reduce round-trips and connection drops.
        if file_size_mb > 100:
            opts["chunk_size"] = 6_000_000   # 6 MB per Cloudinary docs (min > 5 MB)
            if file_size_mb > 500:
                opts["chunk_size"] = 50_000_000   # 50 MB for 1 GB+ files
            elif file_size_mb > 200:
                opts["chunk_size"] = 20_000_000   # 20 MB for 200–500 MB
            logger.info("Cloudinary upload_large: %s (%.0f MB), chunk_size=%s MB", local_path.name, file_size_mb, opts["chunk_size"] // 1_000_000)
            for attempt in range(max_attempts):
                try:
                    result = cloudinary.uploader.upload_large(
                        str(local_path), resource_type="video", **opts
                    )
                    secure_url = result.get("secure_url") if isinstance(result, dict) else None
                    if secure_url:
                        logger.info("Uploaded to Cloudinary (chunked): %s", secure_url)
                    return secure_url
                except Exception as e:
                    if _is_cloudinary_plan_limit_error(e):
                        logger.warning(
                            "Cloudinary plan limit: %s (%.0f MB) exceeds your plan's max file size (e.g. 100 MB on free tier). "
                            "Video saved locally and indexed; upgrade at https://www.cloudinary.com/pricing for larger uploads.",
                            local_path.name, file_size_mb,
                        )
                        return None
                    if attempt < max_attempts - 1 and _is_connection_error(e):
                        wait = backoff * (attempt + 1)
                        logger.warning("Chunked upload attempt %s/%s failed: %s. Retrying in %ss...", attempt + 1, max_attempts, e, wait)
                        time.sleep(wait)
                        continue
                    logger.warning(
                        "Cloudinary upload_large failed for %s after %s retries: %s. Video is saved locally and will still be indexed; segment playback will use local clips.",
                        local_path.name, max_attempts, e,
                    )
                    return None
            return None
        # Smaller files: upload() — pass resource_type="video" so SDK uses video endpoint (avoids "Image file format mp4 not allowed")
        for attempt in range(max_attempts):
            try:
                result = cloudinary.uploader.upload(
                    str(local_path), resource_type="video", **opts
                )
                secure_url = result.get("secure_url") if isinstance(result, dict) else None
                if secure_url:
                    logger.info("Uploaded to Cloudinary: %s", secure_url)
                return secure_url
            except Exception as e:
                if attempt < max_attempts - 1 and _is_connection_error(e):
                    wait = backoff * (attempt + 1)
                    logger.warning("Upload attempt %s/%s failed: %s. Retrying in %ss...", attempt + 1, max_attempts, e, wait)
                    time.sleep(wait)
                    continue
                logger.warning("Cloudinary upload failed for %s: %s", local_path.name, e)
                return None
        return None
    except Exception as e:
        logger.warning("Cloudinary upload failed for %s: %s", local_path.name, e)
        return None


def upload_directory_to_cloudinary(directory_path: Path, folder: str) -> list[tuple[str, str | None]]:
    """Upload all video files in directory to Cloudinary. Returns list of (filename, secure_url or None)."""
    if not _cloudinary_configured():
        return []
    results = []
    for f in directory_path.iterdir():
        if not f.is_file() or f.suffix.lower() not in VIDEO_EXTENSIONS:
            continue
        url = _cloudinary_upload(f, folder, public_id=f.stem)
        results.append((f.name, url))
    return results

# Remove previous docs from index (optionally scoped to user_id via partition)
def clear_index(user_id: str | None = None):
    rag = _require_ragie()
    partition = _partition_for_user(user_id) if user_id else None
    next_cursor = None
    while True:
        try:
            kwargs = {"cursor": next_cursor} if next_cursor else {}
            # Ragie SDK list() does not accept partition (API uses header); we filter by partition after listing
            response = rag.documents.list(**kwargs)
            documents = response.result.documents
            if partition:
                documents = [d for d in documents if getattr(d, "partition", None) == partition]
            for document in documents:
                try:
                    rag.documents.delete(document_id=document.id)
                    logger.info(f"Deleted document {document.id}")
                except Exception as e:
                    logger.error(f"Failed to delete document {document.id}: {str(e)}")
                    raise

            pagination = getattr(response.result, "pagination", None)
            next_cursor = pagination.next_cursor if pagination else None
            if not next_cursor:
                break
        except Exception as e:
            logger.error(f"Failed to retrieve or process documents: {str(e)}")
            raise

def _is_youtube_page_url(u: str) -> bool:
    """True only for YouTube watch/page URLs (never direct stream URLs like googlevideo.com)."""
    if not u or not isinstance(u, str):
        return False
    return "youtube.com" in u or "youtu.be" in u


def _extract_video_urls(url: str) -> list[str]:
    """Get list of video URLs from a single video or playlist (no download). Only returns YouTube page URLs."""
    if not _is_youtube_page_url(url):
        logger.warning("URL is not a YouTube page URL, skipping: %s", url[:80])
        return []
    opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
        "skip_download": True,
        **_yt_dlp_cookie_opts(),
        **_yt_dlp_youtube_opts(),
    }
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:
        logger.warning("Extract info failed, using URL as single video: %s", e)
        return [url]
    if not info:
        return [url]
    if info.get("_type") == "playlist" and info.get("entries"):
        urls = []
        for e in info["entries"]:
            if not e:
                continue
            u = e.get("webpage_url") or (f"https://www.youtube.com/watch?v={e['id']}" if e.get("id") else None)
            if u and _is_youtube_page_url(u):
                urls.append(u)
            elif e.get("id"):
                urls.append(f"https://www.youtube.com/watch?v={e['id']}")
        return urls if urls else [url]
    # Single video: use only webpage_url or id (never "url" — can be direct stream = invalid filename).
    u = info.get("webpage_url") or (f"https://www.youtube.com/watch?v={info['id']}" if info.get("id") else None)
    if u and _is_youtube_page_url(u):
        return [u]
    return [url]


def _download_one_video(
    url: str,
    output_path: Path,
    user_id: str | None,
) -> list[tuple[str, str | None]]:
    """
    Download one video only (no B2 here — upload after all workers finish to avoid 0-byte uploads).
    Returns list of (filename, b2_key) for the new file(s) (usually 1).
    """
    out_tmpl = str(output_path / "%(id)s_%(title).80s.%(ext)s")
    format_str = "best[ext=mp4]/best"
    opts = {
        "outtmpl": out_tmpl,
        "format": format_str,
        "merge_output_format": "mp4",
        "quiet": False,
        "no_warnings": False,
        "retries": 3,
        "fragment_retries": 3,
        **_yt_dlp_cookie_opts(),
        **_yt_dlp_youtube_opts(),
    }
    existing = set(f.name for f in output_path.iterdir() if f.is_file())
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            rc = ydl.download([url])
            if rc != 0:
                logger.error("yt-dlp returned non-zero exit code %s for %s", rc, url)
    except Exception as e:
        err = str(e).lower()
        if "sign in" in err or "not a bot" in err or "cookies" in err or "confirm" in err:
            raise RuntimeError(
                f"YouTube is blocking this request (bot detection). "
                f"Set YT_DLP_COOKIES_FILE to a cookies.txt exported from your browser. "
                f"Original error: {e}"
            ) from e
        raise
    new_files = []
    for f in output_path.iterdir():
        if f.is_file() and f.suffix.lower() in VIDEO_EXTENSIONS and f.name not in existing:
            new_files.append(f.name)
    if not new_files:
        logger.warning("yt-dlp completed but no new video files found in %s for URL %s", output_path, url)
    cloud_folder = f"users/{user_id}/videos" if user_id else "videos"
    result = [(name, cloud_folder) for name in new_files]
    return result


# YouTube download (single video or full playlist)
def download_youtube(
    url: str, output_dir: str = "videos", user_id: str | None = None
) -> list[tuple[str, str | None]]:
    """
    Download videos in parallel; upload to Cloudinary after all downloads finish when configured.
    Returns list of (filename, cloudinary_url or None).
    """
    output_path = Path(output_dir).resolve()
    output_path.mkdir(parents=True, exist_ok=True)
    logger.info("Download directory resolved to: %s", output_path)
    urls = _extract_video_urls(url)
    urls = [u for u in urls if _is_youtube_page_url(u)]  # never pass direct stream URLs (invalid filename)
    if not urls:
        logger.warning("No video URLs extracted from %s", url)
        return []
    max_workers = min(4, max(1, len(urls)))
    all_results = []
    errors = []
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(_download_one_video, u, output_path, user_id): u
            for u in urls
        }
        for future in as_completed(futures):
            try:
                for item in future.result():
                    all_results.append(item)
            except Exception as e:
                failed_url = futures[future]
                logger.error("Download failed for %s: %s", failed_url, e)
                errors.append(str(e))
    # If every download failed, raise so the caller gets the real error message
    if not all_results and errors:
        raise RuntimeError("; ".join(errors))
    # Cloudinary upload only the files that were downloaded in this run (all_results).
    if _cloudinary_configured():
        seen = set()
        for name, folder in all_results:
            if not folder or name in seen:
                continue
            seen.add(name)
            path = output_path / name
            if path.is_file() and path.stat().st_size > 0:
                try:
                    logger.info("Uploading to Cloudinary: %s", name)
                    url = _cloudinary_upload(path, folder, public_id=Path(name).stem)
                    if url:
                        # Replace folder in all_results with URL for this file (same index)
                        idx = next(i for i, (n, _) in enumerate(all_results) if n == name)
                        all_results[idx] = (name, url)
                except Exception as e:
                    logger.warning("Cloudinary upload failed for %s: %s", name, e)
            else:
                logger.warning("Skipping Cloudinary upload for %s (missing or 0 bytes)", name)
        # Normalize: when Cloudinary not used or upload failed, store None for storage URL
        all_results = [(name, url if (url and url.startswith("http")) else None) for name, url in all_results]
    else:
        all_results = [(name, None) for name, _ in all_results]
    return all_results

def _ingest_one_file(
    file_path: Path,
    file_name: str,
    partition: str | None,
    metadata: dict,
) -> str:
    """Ingest a single file to Ragie. Returns 'ready' | 'processing' | 'submitted'."""
    with open(file_path, mode="rb") as f:
        file_content = f.read()
    payload = {
        "file": {"file_name": file_name, "content": file_content},
        "mode": {"video": "audio_video", "audio": True},
    }
    if partition:
        payload["partition"] = partition
    if metadata:
        payload["metadata"] = metadata
    response = ragie.documents.create(request=payload)
    doc_id = response.id
    last_known_status: str | None = None
    for attempt in range(15):
        time.sleep(2)
        try:
            res = ragie.documents.get(document_id=doc_id)
            last_known_status = getattr(res, "status", None) or ""
            if last_known_status == "ready":
                logger.info("Successfully ingested %s (ready)", file_name)
                return "ready"
            if last_known_status == "failed":
                raise RuntimeError(f"Ragie document failed: {doc_id}")
            # pending, partitioning, chunked, indexed, etc. -> still processing
            logger.debug("Ragie document %s status: %s", file_name, last_known_status)
        except Exception as e:
            err_str = str(e).lower()
            is_404 = "not found" in err_str or "404" in err_str or "document not found" in err_str
            if is_404 and attempt >= 14:
                if last_known_status:
                    logger.info("Ragie document %s still %s (indexing in progress); id=%s", file_name, last_known_status, doc_id)
                    return "processing"
                logger.info("Ragie document %s submitted (indexing in background); id=%s", file_name, doc_id)
                return "submitted"
            if is_404:
                continue
            raise
    return "processing" if last_known_status else "submitted"


def _ingest_one_url(
    video_url: str,
    file_name: str,
    partition: str | None,
    metadata: dict,
) -> str:
    """Ingest a single video into Ragie from a public URL. Returns 'ready' | 'processing' | 'submitted'."""
    api_key = os.getenv("RAGIE_API_KEY")
    if not api_key:
        raise ValueError("RAGIE_API_KEY not set")
    payload = {
        "url": video_url,
        "mode": {"video": "audio_video", "audio": True},
        "name": file_name,
    }
    if partition:
        payload["partition"] = partition
    if metadata:
        payload["metadata"] = metadata
    with httpx.Client(timeout=60.0) as client:
        r = client.post(
            "https://api.ragie.ai/documents/url",
            json=payload,
            headers={"Authorization": f"Bearer {api_key}"},
        )
        r.raise_for_status()
        doc = r.json()
    doc_id = doc.get("id")
    if not doc_id:
        raise RuntimeError("Ragie did not return document id")
    last_known_status: str | None = None
    for attempt in range(15):
        time.sleep(2)
        try:
            res = ragie.documents.get(document_id=doc_id)
            last_known_status = getattr(res, "status", None) or ""
            if last_known_status == "ready":
                logger.info("Successfully ingested from URL %s (ready)", file_name)
                return "ready"
            if last_known_status == "failed":
                raise RuntimeError(f"Ragie document failed: {doc_id}")
            logger.debug("Ragie document from URL %s status: %s", file_name, last_known_status)
        except Exception as e:
            err_str = str(e).lower()
            is_404 = "not found" in err_str or "404" in err_str or "document not found" in err_str
            if is_404 and attempt >= 14:
                if last_known_status:
                    return "processing"
                logger.info("Ragie document from URL %s submitted (indexing in background)", file_name)
                return "submitted"
            if is_404:
                continue
            raise
    return "processing" if last_known_status else "submitted"


def ingest_data_from_urls(
    url_file_pairs: list[tuple[str, str]],
    user_id: str | None = None,
) -> list[tuple[str, str]]:
    """Ingest videos into Ragie from public URLs. Returns list of (file_name, status)."""
    _ = _require_ragie()
    statuses: list[tuple[str, str]] = []
    if not url_file_pairs:
        return statuses
    partition = _partition_for_user(user_id) if user_id else None
    metadata = {"user_id": user_id} if user_id else {}
    for video_url, file_name in url_file_pairs:
        if not video_url or not video_url.startswith("http"):
            continue
        try:
            st = _ingest_one_url(video_url, file_name, partition, metadata)
            statuses.append((file_name, st))
        except Exception as e:
            logger.error("Failed to ingest from URL %s: %s", file_name, e)
            statuses.append((file_name, "error"))
    return statuses


# Ingest data from a directory into the Ragie index (optionally scoped to user_id)
def ingest_data(directory, extensions: set | None = None, user_id: str | None = None, only_files: list[str] | None = None):
    """Ingest video/files from directory. If only_files is set, ingest just those filenames (avoids re-ingesting whole dir)."""
    _ = _require_ragie()
    directory_path = Path(directory)
    files = os.listdir(directory_path)
    if extensions is not None:
        files = [f for f in files if Path(f).suffix.lower() in extensions]
    if only_files is not None:
        only_set = set(only_files)
        files = [f for f in files if f in only_set]
    if files:
        logger.info("Ingesting %s file(s) to Ragie...", len(files))

    partition = _partition_for_user(user_id) if user_id else None
    metadata = {"user_id": user_id} if user_id else {}

    statuses: list[tuple[str, str]] = []
    max_workers = min(4, max(1, len(files)))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(
                _ingest_one_file,
                directory_path / file,
                file,
                partition,
                metadata,
            ): file
            for file in files
        }
        for future in as_completed(futures):
            name = futures[future]
            try:
                status = future.result()
                statuses.append((name, status))
            except Exception as e:
                logger.error("Failed to ingest %s: %s", name, e)
                statuses.append((name, "error"))
    return statuses

# Retrieve data from the Ragie index (optionally scoped to user_id via partition)
def retrieve_data(query, user_id: str | None = None):
    try:
        rag = _require_ragie()
        logger.info(f"Retrieving data for query: {query}")
        request = {"query": query}
        if user_id:
            request["partition"] = _partition_for_user(user_id)
        retrieval_response = rag.retrievals.retrieve(request=request)

        import json as _json
        content = []
        for chunk in retrieval_response.scored_chunks:
            meta = dict(chunk.document_metadata or {}) if hasattr(chunk.document_metadata, "items") else {}
            text = (chunk.text or "").strip()
            video_desc = meta.get("video_description") or ""
            audio_txt = meta.get("audio_transcript") or ""
            display_text = ""
            # 1) Prefer meta from Ragie
            if video_desc:
                display_text = video_desc.strip()
            elif audio_txt:
                display_text = audio_txt.strip()[:800] + ("..." if len(audio_txt) > 800 else "")
            # 2) chunk.text is often the full JSON blob; parse it to get video_description / audio_transcript
            if not display_text and text.startswith("{"):
                try:
                    parsed = _json.loads(text)
                    display_text = (parsed.get("video_description") or parsed.get("audio_transcript") or "").strip()
                    if display_text:
                        display_text = display_text[:2000] + ("..." if len(display_text) > 2000 else "")
                except Exception:
                    pass
            # 3) Fallback: use raw text (truncated) so we never return empty display when we have a chunk
            if not display_text and text:
                display_text = text[:1500] + ("..." if len(text) > 1500 else "")
            content.append({
                **meta,
                "text": text,
                "display_text": display_text[:2000] if display_text else "",
                "document_name": chunk.document_name,
                "start_time": chunk.metadata.get("start_time") if chunk.metadata else None,
                "end_time": chunk.metadata.get("end_time") if chunk.metadata else None,
            })

        logger.info(f"Successfully retrieved {len(content)} chunks")
        return content

    except Exception as e:
        logger.error(f"Failed to retrieve data: {str(e)}")
        raise


def llm_answer_from_chunks(query: str, chunks: list[dict]) -> dict | None:
    """
    Optional: synthesize a final answer using an LLM, grounded in retrieved Ragie chunks.
    Returns {"text": str, "html": str} or None if not configured/failed.
    """
    providers = _answer_models()
    if not providers:
        return None
    try:
        # Include the full retrieved set so Gemini can synthesize across every relevant chunk.
        top = chunks or []
        ctx_lines: list[str] = []
        for c in top:
            doc = str(c.get("document_name") or "")
            st = c.get("start_time")
            et = c.get("end_time")
            t = (c.get("display_text") or c.get("audio_transcript") or c.get("video_description") or c.get("text") or "").strip()
            if not t:
                continue
            t = t[:1600]
            tr = ""
            if st is not None and et is not None:
                tr = f" ({int(float(st))}s–{int(float(et))}s)"
            ctx_lines.append(f"- {doc}{tr}: {t}")

        if not ctx_lines:
            return None

        system = (
            "You are a tutoring assistant for a video-learning app.\n"
            "Answer the user's query using ONLY the provided evidence snippets.\n"
            "Use the snippets to explain the concept being asked in a clear, educational way.\n"
            "Prefer transcript/definition content over scene descriptions. Do not describe the people, camera, whiteboard, or background unless the user explicitly asks for visual details.\n"
            "If multiple snippets relate to the same concept, combine them into one concise explanation.\n"
            "If the evidence is insufficient, say so and ask a short clarifying question.\n"
            "Return your response as JSON with keys: text (plain text) and html (simple HTML using <p>, <strong>, <ul>, <li>, <hr>)."
        )
        user = f"Question: {query}\n\nEvidence snippets:\n" + "\n".join(ctx_lines)
        cache_key = "chunks:" + str(hash((query, "\n".join(ctx_lines))))
        cached = _cache_get(cache_key)
        if cached:
            return cached

        last_err: Exception | None = None
        for client, model in providers:
            try:
                resp = client.chat.completions.create(
                    model=model,
                    messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                    temperature=0.2,
                )
                content = (resp.choices[0].message.content or "").strip()
                if not content:
                    continue
                import json as _json
                try:
                    parsed = _json.loads(_strip_markdown_json(content))
                    if isinstance(parsed, dict) and isinstance(parsed.get("text"), str):
                        html = parsed.get("html")
                        out = {"text": parsed["text"], "html": html if isinstance(html, str) else ""}
                        _cache_put(cache_key, out)
                        return out
                except Exception:
                    pass
                out = {"text": content, "html": ""}
                _cache_put(cache_key, out)
                return out
            except Exception as e:
                last_err = e
                # On rate-limit, try fallbacks (if configured); otherwise bail quickly
                if _is_rate_limit_error(e):
                    time.sleep(1)  # brief backoff before trying next provider
                    continue
                break
        # If all primary providers failed, try phi-3 HTTP fallback before giving up.
        fallback_prompt = f"Question: {query}\n\nEvidence snippets:\n" + "\n".join(ctx_lines)
        phi_ans = _phi3_fallback_answer(fallback_prompt)
        if phi_ans:
            _cache_put(cache_key, phi_ans)
            return phi_ans
        if last_err:
            raise last_err
        return None
    except Exception as e:
        logger.warning("LLM answer synthesis failed: %s", e)
        return None


def _chunk_text_blob(c: dict) -> str:
    return (
        str(c.get("display_text") or "")
        + " "
        + str(c.get("video_description") or "")
        + " "
        + str(c.get("audio_transcript") or "")
        + " "
        + str(c.get("text") or "")
    ).strip()


def _rank_chunks_for_query(query: str, chunks: list[dict], limit: int = 3) -> list[dict]:
    """Return the chunks with the strongest query-token overlap first."""
    q = (query or "").lower()
    if not q or not chunks:
        return chunks[:limit]

    stop = {
        "the",
        "and",
        "for",
        "with",
        "from",
        "this",
        "that",
        "what",
        "why",
        "how",
        "can",
        "you",
        "me",
        "tell",
        "difference",
        "between",
        "explain",
        "please",
    }
    q_tokens = [t for t in re.findall(r"[a-z0-9_+-]{2,}", q) if t not in stop]
    if not q_tokens:
        return chunks[:limit]

    def score(chunk: dict) -> tuple[int, int]:
        blob = _chunk_text_blob(chunk).lower()
        matches = sum(1 for t in q_tokens if t in blob)
        return (matches, len(blob))

    return sorted(chunks, key=score, reverse=True)[:limit]


def chunks_look_relevant(query: str, chunks: list[dict]) -> bool:
    """
    Heuristic: require some keyword overlap between query and retrieved chunks.
    Prevents unrelated video descriptions from being treated as an answer.
    """
    q = (query or "").lower()
    if not q or not chunks:
        return False
    # Tokenize: keep short technical tokens like npm/npx
    stop = {
        "the",
        "and",
        "for",
        "with",
        "from",
        "this",
        "that",
        "what",
        "why",
        "how",
        "can",
        "you",
        "me",
        "tell",
        "difference",
        "between",
        "explain",
        "please",
    }
    q_tokens = {t for t in re.findall(r"[a-z0-9_+-]{2,}", q) if t not in stop}
    if not q_tokens:
        return True
    blob = " ".join(_chunk_text_blob(c).lower() for c in chunks[:8])
    # "Strong" tokens: short technical terms (npm/npx), anything with digits, or tokens with '+'/'-'/'_'
    strong = {t for t in q_tokens if len(t) <= 4 or any(ch.isdigit() for ch in t) or any(ch in t for ch in "+-_")}
    if strong:
        return any(t in blob for t in strong)
    return any(t in blob for t in q_tokens)


def llm_general_answer(query: str) -> dict | None:
    """Optional: general LLM answer when query isn't answered by video evidence."""
    providers = _answer_models()
    if not providers:
        return None
    q = (query or "").strip()
    if not q:
        return None
    try:
        cache_key = "general:" + str(hash(q))
        cached = _cache_get(cache_key)
        if cached:
            return cached
        system = (
            "You are a helpful assistant.\n"
            "Return JSON with keys: text (plain text) and html (simple HTML using <p>, <strong>, <ul>, <li>, <hr>)."
        )
        last_err: Exception | None = None
        for client, model in providers:
            try:
                resp = client.chat.completions.create(
                    model=model,
                    messages=[{"role": "system", "content": system}, {"role": "user", "content": q}],
                    temperature=0.2,
                )
                content = (resp.choices[0].message.content or "").strip()
                if not content:
                    continue
                import json as _json
                try:
                    parsed = _json.loads(_strip_markdown_json(content))
                    if isinstance(parsed, dict) and isinstance(parsed.get("text"), str):
                        html = parsed.get("html")
                        out = {"text": parsed["text"], "html": html if isinstance(html, str) else ""}
                        _cache_put(cache_key, out)
                        return out
                except Exception:
                    pass
                out = {"text": content, "html": ""}
                _cache_put(cache_key, out)
                return out
            except Exception as e:
                last_err = e
                if _is_rate_limit_error(e):
                    time.sleep(1)  # brief backoff before trying next provider
                    continue
                break
        # Final fallback: phi-3 HTTP endpoint with plain-text reply.
        phi_ans = _phi3_fallback_answer(q)
        if phi_ans:
            _cache_put(cache_key, phi_ans)
            return phi_ans
        if last_err:
            raise last_err
        return None
    except Exception as e:
        logger.warning("General LLM answer failed: %s", e)
        return None

# Base dir for videos and video_chunks (backend folder), so paths work regardless of process cwd
_BACKEND_DIR = Path(__file__).resolve().parent


def recover_video_to_cloudinary(
    source_url: str,
    video_path: Path,
    user_id: str,
) -> tuple[str | None, str]:
    """
    When video is missing locally and not on Cloudinary: fetch from source_url (YouTube or direct URL),
    save to video_path, upload to Cloudinary.
    Returns (secure_url or None, error_message for logging/API).
    """
    if not source_url or not str(source_url).strip().startswith("http"):
        return None, "No source_url or invalid URL in database"
    if not _cloudinary_configured():
        return None, "Cloudinary not configured; set CLOUDINARY_* env vars"
    video_path = Path(video_path)
    try:
        video_path.parent.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        return None, f"Cannot create directory: {e!s}"
    try:
        if _is_youtube_page_url(source_url):
            logger.info("Recovery: re-downloading from YouTube %s", source_url[:80])
            directory = str(video_path.parent)
            results = download_youtube(source_url, output_dir=directory, user_id=user_id)
            if not results:
                return None, "YouTube download returned no files (check cookies or bot detection)"
            _name, cloudinary_url = results[0]
            if cloudinary_url and str(cloudinary_url).startswith("http"):
                first_path = video_path.parent / _name
                if first_path.exists() and first_path != video_path:
                    shutil.move(str(first_path), str(video_path))
                return cloudinary_url, ""
            first_path = video_path.parent / _name
            if first_path.exists():
                if first_path != video_path:
                    shutil.move(str(first_path), str(video_path))
                folder = f"users/{user_id}/videos"
                url = _cloudinary_upload(video_path, folder, public_id=video_path.stem)
                return url, "" if url else "Cloudinary upload failed after download"
            return None, "Downloaded file not found on disk"
        # Direct video URL
        logger.info("Recovery: downloading from direct URL")
        download_video_from_url(source_url, video_path)
        folder = f"users/{user_id}/videos"
        url = _cloudinary_upload(video_path, folder, public_id=video_path.stem)
        return url, "" if url else "Cloudinary upload failed"
    except Exception as e:
        logger.warning("Recovery to Cloudinary failed: %s", e, exc_info=True)
        return None, str(e)


def cloudinary_segment_url(secure_url: str, start_time: float, end_time: float) -> str:
    """Build a Cloudinary URL that streams only the segment using so (start offset) and du (duration)."""
    if not secure_url or "/upload/" not in secure_url:
        return secure_url or ""
    so = max(0.0, start_time)
    du = max(0.1, end_time - start_time)
    trans = f"so_{so:.1f},du_{du:.1f}"
    idx = secure_url.find("/upload/") + len("/upload/")
    return secure_url[:idx] + trans + "/" + secure_url[idx:]


def download_video_from_url(url: str, local_path: Path, timeout: float = 300.0) -> None:
    """Download a video from URL (e.g. Cloudinary) to local_path. Streams to file to avoid large memory use."""
    if not url or not str(url).startswith("http"):
        raise ValueError("Invalid video URL")
    local_path = Path(local_path)
    local_path.parent.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        with client.stream("GET", url) as r:
            r.raise_for_status()
            with open(local_path, "wb") as f:
                for chunk in r.iter_bytes(chunk_size=65536):
                    f.write(chunk)
    logger.info("Downloaded video from URL to %s", local_path)


def chunk_video(document_name, start_time, end_time, directory="videos", user_id: str | None = None):
    """Create a video clip. When user_id is set, output is under video_chunks/{user_id}/ and optionally uploaded to Cloudinary."""
    if user_id:
        output_dir = _BACKEND_DIR / "video_chunks" / _partition_for_user(user_id)
    else:
        output_dir = _BACKEND_DIR / "video_chunks"
    output_dir.mkdir(parents=True, exist_ok=True)

    chunk_filename = f"video_chunk_{start_time:.1f}_{end_time:.1f}.mp4"
    output_path = output_dir / chunk_filename

    # Resolve video path relative to backend dir so it works whether cwd is project root or backend
    video_path = _BACKEND_DIR / directory / document_name
    if not video_path.exists():
        raise FileNotFoundError(f"Video not found: {video_path}")
    with VideoFileClip(str(video_path)) as video:
        video_duration = video.duration
        actual_end_time = min(end_time, video_duration) if end_time is not None else video_duration
        video_chunk = video.subclipped(start_time, actual_end_time)
        video_chunk.write_videofile(str(output_path))

    storage_url = None
    if _cloudinary_configured():
        folder = f"users/{user_id}/chunks" if user_id else "chunks"
        storage_url = _cloudinary_upload(output_path, folder, public_id=Path(chunk_filename).stem)
    return {"path": output_path, "b2_key": storage_url}


if __name__ == "__main__":
    clear_index()
    ingest_data("videos")
    print(retrieve_data("What is the main topic of the video?"))
