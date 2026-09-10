"""
AgroClima · database.py
Conexión a base de datos con SQLAlchemy.

▸ Por defecto usa SQLite (archivo agroclima.db, persiste en el workspace).
▸ Para PostgreSQL real: define DATABASE_URL en .env / entorno, p. ej.
    DATABASE_URL=postgresql+psycopg2://agroclima:secret@localhost:5432/agroclima
  y ejecuta antes schema_postgres.sql (o deja que SQLAlchemy cree las tablas).
"""
import os

from app import envloader  # noqa: F401
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{os.path.join(BASE_DIR, 'agroclima.db')}")

# check_same_thread solo aplica a SQLite
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
