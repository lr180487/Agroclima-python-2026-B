"""
AgroClima · models.py
Modelos ORM (SQLAlchemy). Compatibles con SQLite y PostgreSQL.
El esquema SQL equivalente para PostgreSQL está en schema_postgres.sql
"""
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utcnow():
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=True)  # null si es cuenta OAuth
    role: Mapped[str] = mapped_column(String(20), default="agricultor")     # admin | agronomo | agricultor
    provider: Mapped[str] = mapped_column(String(20), default="password")   # password | google
    google_sub: Mapped[str] = mapped_column(String(64), nullable=True, unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    parcels: Mapped[list["Parcel"]] = relationship(back_populates="owner", cascade="all, delete-orphan")
    queries: Mapped[list["QueryHistory"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Parcel(Base):
    __tablename__ = "parcels"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    crop: Mapped[str] = mapped_column(String(60), default="🌾 Cultivo")
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lon: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    owner: Mapped["User"] = relationship(back_populates="parcels")


class QueryHistory(Base):
    __tablename__ = "query_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    location_name: Mapped[str] = mapped_column(String(255), nullable=False)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lon: Mapped[float] = mapped_column(Float, nullable=False)
    crop: Mapped[str] = mapped_column(String(60), nullable=False)
    temperature: Mapped[float] = mapped_column(Float)
    rain_7d: Mapped[float] = mapped_column(Float)
    humidity: Mapped[int] = mapped_column(Integer)
    score: Mapped[int] = mapped_column(Integer)
    alerts_json: Mapped[str] = mapped_column(Text, default="[]")  # JSON serializado de alertas
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    user: Mapped["User"] = relationship(back_populates="queries")
