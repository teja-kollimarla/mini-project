import os
import re
import shutil
import time
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from dotenv import load_dotenv
from ragie import Ragie
from moviepy import VideoFileClip
import yt_dlp

load_dotenv()

# Video file extensions for ingestion and YouTube output
VIDEO_EXTENSIONS = {".mp4", ".mkv", ".webm", ".mov", ".avi", ".flv", ".m4a"}


def _yt_dlp_cookie_opts() -> dict:
    """Cookie options for YouTube bot check: cookiesfrombrowser (e.g. chrome) or cookiefile (cookies.txt)."""
    opts = {}
    # 1) Browser cookies — set YT_DLP_COOKIES_FROM_BROWSER=chrome (or firefox, edge). Use tuple so yt-dlp gets one arg.
    browser = os.getenv("YT_DLP_COOKIES_FROM_BROWSER", "").strip().lower()
    if browser:
        opts["cookiesfrombrowser"] = (browser.split(":")[0],)
    # 2) Exported cookies.txt — YT_DLP_COOKIES_FILE path, or default backend/cookies.txt if it exists
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

# initialize ragie client
ragie = Ragie(
    auth=os.getenv('RAGIE_API_KEY'),
)


# Backblaze B2 (optional): set B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET_NAME to enable
def _get_b2_bucket():
    try:
        from b2sdk.v2 import B2Api, InMemoryAccountInfo
        key_id = os.getenv("B2_KEY_ID")
        app_key = os.getenv("B2_APPLICATION_KEY")
        bucket_name = os.getenv("B2_BUCKET_NAME")
        if not all((key_id, app_key, bucket_name)):
            return None
        info = InMemoryAccountInfo()
        b2 = B2Api(info)
        b2.authorize_account("production", key_id, app_key)
        return b2.get_bucket_by_name(bucket_name)
    except Exception as e:
        logger.debug("B2 not configured or error: %s", e)
        return None


def b2_upload(local_path: Path, b2_key: str) -> str | None:
    """Upload a file to B2. Returns the B2 file key if successful, else None."""
    bucket = _get_b2_bucket()
    if bucket is None:
        return None
    try:
        bucket.upload_local_file(str(local_path), b2_key)
        logger.info("Uploaded to B2: %s", b2_key)
        return b2_key
    except Exception as e:
        logger.warning("B2 upload failed: %s", e)
        return None

# Remove previous docs from index (optionally scoped to user_id via partition)
def clear_index(user_id: str | None = None):
    partition = _partition_for_user(user_id) if user_id else None
    next_cursor = None
    while True:
        try:
            kwargs = {"cursor": next_cursor} if next_cursor else {}
            if partition:
                kwargs["partition"] = partition
            response = ragie.documents.list(**kwargs)
            documents = response.result.documents

            for document in documents:
                try:
                    ragie.documents.delete(document_id=document.id)
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
    format_str = "best[ext=mp4]/best[ext=mp4]/best"
    opts = {
        "outtmpl": out_tmpl,
        "format": format_str,
        "quiet": False,
        "no_warnings": False,
        **_yt_dlp_cookie_opts(),
        **_yt_dlp_youtube_opts(),
    }
    existing = set(f.name for f in output_path.iterdir() if f.is_file())
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([url])
    new_files = []
    for f in output_path.iterdir():
        if f.is_file() and f.suffix.lower() in VIDEO_EXTENSIONS and f.name not in existing:
            new_files.append(f.name)
    b2_prefix = f"users/{user_id}/videos/" if user_id else "videos/"
    bucket = _get_b2_bucket()
    result = [(name, f"{b2_prefix}{name}" if bucket else None) for name in new_files]
    return result


# YouTube download (single video or full playlist)
def download_youtube(
    url: str, output_dir: str = "videos", user_id: str | None = None
) -> list[tuple[str, str | None]]:
    """
    Download videos in parallel; upload all to B2 only after all downloads finish (avoids 0-byte uploads from race).
    Returns list of (filename, b2_key).
    """
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    urls = _extract_video_urls(url)
    urls = [u for u in urls if _is_youtube_page_url(u)]  # never pass direct stream URLs (invalid filename)
    if not urls:
        logger.warning("No video URLs extracted from %s", url)
        return []
    max_workers = min(4, max(1, len(urls)))
    all_results = []
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
                logger.warning("Download failed for %s: %s", futures[future], e)
    # B2 upload only the files that were downloaded in this run (all_results), not the whole directory.
    if _get_b2_bucket():
        seen = set()
        for name, b2_key in all_results:
            if not b2_key or name in seen:
                continue
            seen.add(name)
            path = output_path / name
            if path.is_file() and path.stat().st_size > 0:
                try:
                    logger.info("Uploading to B2: %s", name)
                    b2_upload(path, b2_key)
                except Exception as e:
                    logger.warning("B2 upload failed for %s: %s", name, e)
            else:
                logger.warning("Skipping B2 upload for %s (missing or 0 bytes)", name)
    return all_results

def _ingest_one_file(
    file_path: Path,
    file_name: str,
    partition: str | None,
    metadata: dict,
) -> None:
    """Ingest a single file to Ragie (used by parallel workers)."""
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
    while True:
        res = ragie.documents.get(document_id=response.id)
        if res.status == "ready":
            break
        time.sleep(2)
    logger.info("Successfully ingested %s", file_name)


# Ingest data from a directory into the Ragie index (optionally scoped to user_id)
def ingest_data(directory, extensions: set | None = None, user_id: str | None = None):
    """Ingest video/files from directory. If user_id is set, documents are stored in that partition and tagged with metadata. Runs ingest in parallel for speed."""
    directory_path = Path(directory)
    files = os.listdir(directory_path)
    if extensions is not None:
        files = [f for f in files if Path(f).suffix.lower() in extensions]
    if files:
        logger.info("Ingesting %s file(s) to Ragie...", len(files))

    partition = _partition_for_user(user_id) if user_id else None
    metadata = {"user_id": user_id} if user_id else {}

    # Ingest to Ragie in parallel (limit workers to avoid memory and rate limits)
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
                future.result()
            except Exception as e:
                logger.error("Failed to ingest %s: %s", name, e)

# Retrieve data from the Ragie index (optionally scoped to user_id via partition)
def retrieve_data(query, user_id: str | None = None):
    try:
        logger.info(f"Retrieving data for query: {query}")
        request = {"query": query}
        if user_id:
            request["partition"] = _partition_for_user(user_id)
        retrieval_response = ragie.retrievals.retrieve(request=request)

        content = [
            {
                **chunk.document_metadata,
                "text": chunk.text,
                "document_name": chunk.document_name,
                "start_time": chunk.metadata.get("start_time"),
                "end_time": chunk.metadata.get("end_time")
            }
            for chunk in retrieval_response.scored_chunks
        ]

        logger.info(f"Successfully retrieved {len(content)} chunks")
        return content

    except Exception as e:
        logger.error(f"Failed to retrieve data: {str(e)}")
        raise

def chunk_video(document_name, start_time, end_time, directory="videos", user_id: str | None = None):
    """Create a video clip. When user_id is set, output is under video_chunks/{user_id}/ and B2 under users/{user_id}/chunks/."""
    if user_id:
        output_dir = Path("video_chunks") / _partition_for_user(user_id)
    else:
        output_dir = Path("video_chunks")
    output_dir.mkdir(parents=True, exist_ok=True)

    chunk_filename = f"video_chunk_{start_time:.1f}_{end_time:.1f}.mp4"
    output_path = output_dir / chunk_filename

    video_path = Path(directory) / document_name
    with VideoFileClip(str(video_path)) as video:
        video_duration = video.duration
        actual_end_time = min(end_time, video_duration) if end_time is not None else video_duration
        video_chunk = video.subclipped(start_time, actual_end_time)
        video_chunk.write_videofile(str(output_path))

    b2_prefix = f"users/{user_id}/chunks/" if user_id else "chunks/"
    b2_key = b2_upload(output_path, f"{b2_prefix}{chunk_filename}")
    return {"path": output_path, "b2_key": b2_key}


if __name__ == "__main__":
    clear_index()
    ingest_data("videos")
    print(retrieve_data("What is the main topic of the video?"))
