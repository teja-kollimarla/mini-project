import os
import time
import logging
from pathlib import Path

from dotenv import load_dotenv
from ragie import Ragie
from moviepy import VideoFileClip
import yt_dlp

load_dotenv()

# Video file extensions for ingestion and YouTube output
VIDEO_EXTENSIONS = {".mp4", ".mkv", ".webm", ".mov", ".avi", ".flv", ".m4a"}

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

# Remove previous docs from index
def clear_index():
    next_cursor = None
    while True:
        try:
            kwargs = {"cursor": next_cursor} if next_cursor else {}
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

# YouTube download (single video or full playlist)
def download_youtube(url: str, output_dir: str = "videos") -> list[str]:
    """
    Download a YouTube video or full playlist to output_dir.
    Returns list of downloaded file names (for use as document_name in Ragie).
    """
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    out_tmpl = str(output_path / "%(id)s_%(title).80s.%(ext)s")
    opts = {
        "outtmpl": out_tmpl,
        "format": "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "merge_output_format": "mp4",
        "quiet": False,
        "no_warnings": False,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([url])
    downloaded = []
    for f in output_path.iterdir():
        if f.is_file() and f.suffix.lower() in VIDEO_EXTENSIONS:
            downloaded.append(f.name)
    # Optionally upload to B2
    if _get_b2_bucket():
        for name in downloaded:
            b2_upload(output_path / name, f"videos/{name}")
    return downloaded

# Ingest data from a directory into the Ragie index
def ingest_data(directory, extensions: set | None = None):
    """Ingest video/files from directory. If extensions is set, only those extensions are ingested."""
    directory_path = Path(directory)
    files = os.listdir(directory_path)
    if extensions is not None:
        files = [f for f in files if Path(f).suffix.lower() in extensions]

    for file in files:
        try:
            file_path = directory_path / file
            # Read file content
            with open(file_path, mode='rb') as f:
                file_content = f.read()   
            # Create document in Ragie
            response = ragie.documents.create(request={
                "file": {
                    "file_name": file,
                    "content": file_content,
                },
                "mode": {
                    "video": "audio_video",
                    "audio": True
                }
            })
            # Wait for document to be ready
            while True:
                res = ragie.documents.get(document_id=response.id)
                if res.status == "ready":
                    break
        
                time.sleep(2)

            logger.info(f"Successfully uploaded {file}")
            
        except Exception as e:
            logger.error(f"Failed to process file {file}: {str(e)}")
            continue

# Retrieve data from the Ragie index
def retrieve_data(query):
    try:
        logger.info(f"Retrieving data for query: {query}")
        retrieval_response = ragie.retrievals.retrieve(request={
            "query": query
        })

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

def chunk_video(document_name, start_time, end_time, directory="videos"):
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

    b2_key = b2_upload(output_path, f"chunks/{chunk_filename}")
    return {"path": output_path, "b2_key": b2_key}


if __name__ == "__main__":
    clear_index()
    ingest_data("videos")
    print(retrieve_data("What is the main topic of the video?"))
