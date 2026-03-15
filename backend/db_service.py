"""
Database service: get-or-create user, record videos/chats/messages.
"""
from sqlalchemy.orm import Session

from models import User, Video, Chat, Message


def get_or_create_user(db: Session, external_id: str, email: str | None = None, name: str | None = None) -> User:
    user = db.query(User).filter(User.external_id == external_id).first()
    if user:
        if email is not None:
            user.email = email
        if name is not None:
            user.name = name
        db.commit()
        db.refresh(user)
        return user
    user = User(external_id=external_id, email=email, name=name)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


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
