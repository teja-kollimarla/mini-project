"""
Database service: users (with password), sessions, videos, chats, messages.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from models import User, Video, Chat, Message, Chunk, Session as SessionModel


def get_or_create_user(db: Session, external_id: str, email: str | None = None, name: str | None = None, password_hash: str | None = None) -> User:
    user = db.query(User).filter(User.external_id == external_id).first()
    if user:
        if email is not None:
            user.email = email
        if name is not None:
            user.name = name
        if password_hash is not None:
            user.password_hash = password_hash
        db.commit()
        db.refresh(user)
        return user
    user = User(external_id=external_id, email=email, name=name, password_hash=password_hash)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def get_user_by_email(db: Session, email: str) -> User | None:
    return db.query(User).filter(User.email == email).first()


def create_session(db: Session, user_id: str, jti: str, expires_at: datetime) -> SessionModel:
    s = SessionModel(user_id=user_id, jti=jti, expires_at=expires_at)
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


def get_session_by_jti(db: Session, jti: str) -> SessionModel | None:
    return db.query(SessionModel).filter(SessionModel.jti == jti).first()


def revoke_session(db: Session, jti: str) -> bool:
    s = db.query(SessionModel).filter(SessionModel.jti == jti).first()
    if s:
        db.delete(s)
        db.commit()
        return True
    return False


def revoke_all_sessions_for_user(db: Session, user_id: str) -> int:
    n = db.query(SessionModel).filter(SessionModel.user_id == user_id).delete()
    db.commit()
    return n


def cleanup_expired_sessions(db: Session) -> int:
    now = datetime.now(timezone.utc)
    n = db.query(SessionModel).filter(SessionModel.expires_at < now).delete()
    db.commit()
    return n


def record_video(
    db: Session,
    user_id: str,
    filename: str,
    source: str,
    source_url: str | None = None,
    b2_key: str | None = None,
) -> Video:
    """Record a single video (e.g. as soon as it is downloaded and uploaded to B2)."""
    v = Video(user_id=user_id, filename=filename, source=source, source_url=source_url, b2_key=b2_key)
    db.add(v)
    db.commit()
    db.refresh(v)
    return v


def record_videos(
    db: Session,
    user_id: str,
    filenames: list[str],
    source: str,
    source_url: str | None = None,
    b2_keys: list[str] | None = None,
) -> list[Video]:
    """Record uploaded/ingested videos. b2_keys optional, same order as filenames."""
    videos = []
    for i, filename in enumerate(filenames):
        b2_key = b2_keys[i] if b2_keys and i < len(b2_keys) else None
        v = Video(user_id=user_id, filename=filename, source=source, source_url=source_url, b2_key=b2_key)
        db.add(v)
        videos.append(v)
    db.commit()
    for v in videos:
        db.refresh(v)
    return videos


def create_chat(db: Session, user_id: str, title: str | None = None) -> Chat:
    chat = Chat(user_id=user_id, title=title)
    db.add(chat)
    db.commit()
    db.refresh(chat)
    return chat


def add_message(db: Session, chat_id: str, role: str, content: str) -> Message:
    msg = Message(chat_id=chat_id, role=role, content=content)
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return msg


def get_user_chats(db: Session, user_id: str, limit: int = 50):
    return db.query(Chat).filter(Chat.user_id == user_id).order_by(Chat.updated_at.desc()).limit(limit).all()


def get_chat_with_messages(db: Session, chat_id: str, user_id: str) -> Chat | None:
    return db.query(Chat).filter(Chat.id == chat_id, Chat.user_id == user_id).first()


def get_user_videos(db: Session, user_id: str, limit: int = 200):
    return db.query(Video).filter(Video.user_id == user_id).order_by(Video.created_at.desc()).limit(limit).all()


def get_video_by_user_and_filename(db: Session, user_internal_id: str, filename: str) -> Video | None:
    """Find a video by user's internal id and filename (for linking chunks)."""
    return db.query(Video).filter(Video.user_id == user_internal_id, Video.filename == filename).first()


def update_video_b2_key(db: Session, video_id: str, b2_key: str | None) -> None:
    """Update a video's Cloudinary URL (b2_key) after recovery from source."""
    v = db.query(Video).filter(Video.id == video_id).first()
    if v:
        v.b2_key = b2_key
        db.commit()


def record_chunk(
    db: Session,
    user_id: str,
    document_name: str,
    start_time: float,
    end_time: float,
    filename: str,
    video_id: str | None = None,
) -> Chunk:
    """Record a created video clip. user_id is the internal User.id."""
    c = Chunk(
        user_id=user_id,
        video_id=video_id,
        document_name=document_name,
        start_time=start_time,
        end_time=end_time,
        filename=filename,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


def get_user_chunks(db: Session, user_id: str, limit: int = 200):
    """List chunks for a user (user_id = User.id internal)."""
    return db.query(Chunk).filter(Chunk.user_id == user_id).order_by(Chunk.created_at.desc()).limit(limit).all()
