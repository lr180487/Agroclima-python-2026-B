-- ═══════════════════════════════════════════════════════════
-- AgroClima · schema_postgres.sql
-- Esquema para PostgreSQL 14+ (equivalente a models.py).
--
-- Uso:
--   createdb agroclima
--   psql -d agroclima -f schema_postgres.sql
-- Luego en el backend:
--   DATABASE_URL=postgresql+psycopg2://agroclima:secret@localhost:5432/agroclima
--   (pip install psycopg2-binary)
-- ═══════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    name          VARCHAR(120) NOT NULL,
    password_hash VARCHAR(255),                      -- NULL si es cuenta OAuth
    role          VARCHAR(20)  NOT NULL DEFAULT 'agricultor'
                  CHECK (role IN ('admin', 'agronomo', 'agricultor')),
    provider      VARCHAR(20)  NOT NULL DEFAULT 'password'
                  CHECK (provider IN ('password', 'google')),
    google_sub    VARCHAR(64) UNIQUE,                -- "sub" del id_token de Google
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

CREATE TABLE IF NOT EXISTS parcels (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       VARCHAR(120) NOT NULL,
    crop       VARCHAR(60)  NOT NULL DEFAULT '🌾 Cultivo',
    lat        DOUBLE PRECISION NOT NULL,
    lon        DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parcels_user ON parcels (user_id);

CREATE TABLE IF NOT EXISTS query_history (
    id            SERIAL PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    location_name VARCHAR(255) NOT NULL,
    lat           DOUBLE PRECISION NOT NULL,
    lon           DOUBLE PRECISION NOT NULL,
    crop          VARCHAR(60) NOT NULL,
    temperature   DOUBLE PRECISION,
    rain_7d       DOUBLE PRECISION,
    humidity      INTEGER,
    score         INTEGER CHECK (score BETWEEN 0 AND 100),
    alerts_json   TEXT NOT NULL DEFAULT '[]',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_history_user ON query_history (user_id);
CREATE INDEX IF NOT EXISTS idx_history_date ON query_history (created_at DESC);

COMMIT;
