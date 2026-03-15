from mcp.server.fastmcp import FastMCP
from main import (
    VIDEO_EXTENSIONS,
    clear_index,
    ingest_data,
    retrieve_data,
    chunk_video,
    download_youtube,
)

mcp = FastMCP("ragie")

@mcp.tool()
def ingest_youtube_tool(url: str, clear_existing: bool = True) -> str:
    """
    Download a YouTube video or full playlist and index it in Ragie so the user can chat with it.
    Use clear_existing=False to add to the existing index instead of replacing it.

    Args:
        url (str): YouTube video or playlist URL.
        clear_existing (bool): If True, clear the index before ingesting. If False, append to existing index.

    Returns:
        str: Status message listing how many videos were downloaded and indexed.
    """
    try:
        if clear_existing:
            clear_index()
        files = download_youtube(url, output_dir="videos")
        if not files:
            return "No video files downloaded."
        ingest_data("videos", extensions=VIDEO_EXTENSIONS)
        summary = ", ".join(files[:10]) + ("..." if len(files) > 10 else "")
        return f"Downloaded and indexed {len(files)} video(s). Documents: {summary}"
    except Exception as e:
        return f"Failed to download or index: {str(e)}"


@mcp.tool()
def ingest_data_tool(directory: str) -> str:
    """
    Loads data from a directory into the Ragie index. Wait until the data is fully ingested before continuing.

    Args:
        directory (str): The directory to load data from.

    Returns:
        str: A message indicating that the data was loaded successfully.
    """
    try:
        clear_index()
        ingest_data(directory)
        return "Data loaded successfully"   
    except Exception as e:
        return f"Failed to load data: {str(e)}"

@mcp.tool()
def retrieve_data_tool(query: str) -> list[dict]:
    """
    Retrieves data from the Ragie index based on the query. The data is returned as a list of dictionaries, each containing the following keys:
    - text: The text of the retrieved chunk
    - document_name: The name of the document the chunk belongs to
    - start_time: The start time of the chunk
    - end_time: The end time of the chunk

    Args:
        query (str): The query to retrieve data from the Ragie index.

    Returns:
        list[dict]: The retrieved data.
    """
    try:
        content = retrieve_data(query)
        return content
    except Exception as e:
        return f"Failed to retrieve data: {str(e)}"

@mcp.tool()
def show_video_tool(document_name: str, start_time: float, end_time: float) -> str:
    """
    Creates and saves a video chunk based on the document name, start time, and end time of the chunk.
    Returns a message indicating that the video chunk was created successfully.

    Args:
        document_name (str): The name of the document the chunk belongs to
        start_time (float): The start time of the chunk
        end_time (float): The end time of the chunk

    Returns:
        str: A message indicating that the video chunk was created successfully
    """
    try:
        result = chunk_video(document_name, start_time, end_time)
        msg = "Video chunk created successfully"
        if isinstance(result, dict) and result.get("b2_key"):
            msg += f" (uploaded to B2: {result['b2_key']})"
        return msg
    except Exception as e:
        return f"Failed to create video chunk: {str(e)}"

# Run the server locally
if __name__ == "__main__":
    mcp.run(transport='stdio')