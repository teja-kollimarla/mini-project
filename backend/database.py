"""
Database connection and session. Uses SQLite by default; set DATABASE_URL for PostgreSQL.
"""
import os

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "sqlite:///./video_rag.db",
)
if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}
else:
    connect_args = {}

_pool_kwargs: dict = {}
if not DATABASE_URL.startswith("sqlite"):
    # Cloud Postgres (Neon, Railway, Supabase) closes idle connections after ~5 min.
    # pool_pre_ping tests the connection before use and reconnects if stale.
    # pool_recycle discards connections older than 5 minutes proactively.
    _pool_kwargs = {
        "pool_pre_ping": True,
        "pool_recycle": 300,
        "pool_size": 5,
        "max_overflow": 10,
    }

engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    echo=os.getenv("SQL_ECHO", "").lower() in ("1", "true"),
    **_pool_kwargs,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Create all tables. Call on app startup."""
    import models  # noqa: F401 - register models with Base.metadata
    Base.metadata.create_all(bind=engine)
