"""Database connection. Reads DATABASE_URL from the environment (set by
docker-compose.yml for the containerized setup, or export it yourself for local dev)."""
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+psycopg2://urbanrisk:urbanrisk@localhost:5432/urbanrisk",
)

engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_schema():
    """Runs schema.sql idempotently (every statement is CREATE TABLE IF NOT EXISTS /
    ON CONFLICT DO NOTHING) — safe to call on every startup."""
    schema_path = os.path.join(os.path.dirname(__file__), "schema.sql")
    with open(schema_path) as f:
        sql = f.read()
    with engine.begin() as conn:
        from sqlalchemy import text
        for statement in sql.split(";"):
            statement = statement.strip()
            if statement:
                conn.execute(text(statement))
