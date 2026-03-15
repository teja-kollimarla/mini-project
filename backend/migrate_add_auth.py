"""
One-off migration: add password_hash to users and ensure sessions table exists.
Run from backend dir: python migrate_add_auth.py
Or from project root: python backend/migrate_add_auth.py
"""
import os
import sys

# Ensure backend dir is on path so imports work
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv

load_dotenv()

# Use app's database module so we share the same DATABASE_URL
from database import engine
from sqlalchemy import text


def run():
    with engine.connect() as conn:
        if str(engine.url).startswith("postgresql"):
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)"))
            conn.commit()
            print("Added column users.password_hash (if missing).")
        else:
            try:
                conn.execute(text("ALTER TABLE users ADD COLUMN password_hash VARCHAR(255)"))
                conn.commit()
                print("Added column users.password_hash.")
            except Exception as e:
                if "duplicate column name" in str(e).lower():
                    print("Column users.password_hash already exists.")
                else:
                    raise

    # Ensure sessions table exists
    import models  # noqa: F401 - register Session with metadata
    from database import Base

    Base.metadata.create_all(bind=engine, tables=[models.Session.__table__])
    print("Sessions table ensured.")
    print("Migration done.")


if __name__ == "__main__":
    run()
