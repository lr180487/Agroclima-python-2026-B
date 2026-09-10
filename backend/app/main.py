
"""
═══════════════════════════════════════════════════════════════
AgroClima · main.py — Backend FastAPI
▸ Auth real: registro + login con JWT (PBKDF2) y RBAC por roles
▸ OAuth Google preparado (activar con GOOGLE_CLIENT_ID en .env)
▸ PostgreSQL-ready: SQLite por defecto, DATABASE_URL para migrar
▸ Sirve el frontend estático y expone /api/* + docs en /docs
═══════════════════════════════════════════════════════════════
"""

import json
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from app.database import Base, engine, get_db
from app.models import Parcel, QueryHistory, User
from app.security import (
    GOOGLE_CLIENT_ID,
    create_token,
    decode_token,
    hash_password,
    verify_google_id_token,
    verify_password,
)


# ══════════════════════════════════════════════════════════════
# DATABASE
# ══════════════════════════════════════════════════════════════

Base.metadata.create_all(bind=engine)


# ══════════════════════════════════════════════════════════════
# FASTAPI
# ══════════════════════════════════════════════════════════════

app = FastAPI(
    title="AgroClima API",
    version="1.0.0",
    description=(
        "Backend real: autenticación JWT + RBAC, "
        "parcelas e historial en base de datos "
        "(SQLite/PostgreSQL)."
    ),
)


# ══════════════════════════════════════════════════════════════
# CORS
# ══════════════════════════════════════════════════════════════

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Producción: restringir al dominio real
    allow_methods=["*"],
    allow_headers=["*"],
)


# ══════════════════════════════════════════════════════════════
# RBAC
# ══════════════════════════════════════════════════════════════

ROLE_PERMISSIONS = {
    "admin": [
        "dashboard.view",
        "map.view",
        "map.edit",
        "config.profile",
        "config.alerts",
        "config.units",
        "config.users",
        "config.system",
        "history.delete",
    ],
    "agronomo": [
        "dashboard.view",
        "map.view",
        "map.edit",
        "config.profile",
        "config.alerts",
        "config.units",
    ],
    "agricultor": [
        "dashboard.view",
        "map.view",
        "config.profile",
        "config.units",
    ],
}


# ══════════════════════════════════════════════════════════════
# PYDANTIC SCHEMAS
# ══════════════════════════════════════════════════════════════


class RegisterIn(BaseModel):
    email: EmailStr
    name: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=6, max_length=128)

    # Se mantiene por compatibilidad con el frontend actual.
    # IMPORTANTE: en producción el registro debería forzar
    # "agricultor" y reservar cambios de rol para administradores.
    role: str = "agricultor"


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class GoogleIn(BaseModel):
    id_token: str


class ParcelIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    crop: str = "🌾 Cultivo"
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class HistoryIn(BaseModel):
    location_name: str
    lat: float
    lon: float
    crop: str
    temperature: float
    rain_7d: float
    humidity: int
    score: int = Field(ge=0, le=100)
    alerts: list = Field(default_factory=list)


class RoleUpdate(BaseModel):
    role: str


# ══════════════════════════════════════════════════════════════
# AUTHENTICATION
# ══════════════════════════════════════════════════════════════


def current_user(
    authorization: str = Header(None),
    db: Session = Depends(get_db),
) -> User:
    """
    Obtiene el usuario autenticado a partir del JWT Bearer.
    """

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Falta el token Bearer.",
        )

    token = authorization.removeprefix("Bearer ").strip()

    payload = decode_token(token)

    if not payload:
        raise HTTPException(
            status_code=401,
            detail="Token inválido o expirado.",
        )

    try:
        user_id = int(payload["sub"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(
            status_code=401,
            detail="Token inválido.",
        )

    user = db.get(User, user_id)

    if not user or not user.is_active:
        raise HTTPException(
            status_code=401,
            detail="Usuario no encontrado o suspendido.",
        )

    return user


def require_permission(perm: str):
    """
    Dependency para autorización RBAC.
    """

    def checker(
        user: User = Depends(current_user),
    ) -> User:

        if perm not in ROLE_PERMISSIONS.get(user.role, []):
            raise HTTPException(
                status_code=403,
                detail=(
                    f"Tu rol '{user.role}' no tiene "
                    f"el permiso '{perm}'."
                ),
            )

        return user

    return checker


def user_out(u: User) -> dict:
    """
    Serialización pública del usuario.
    """

    return {
        "id": u.id,
        "email": u.email,
        "name": u.name,
        "role": u.role,
        "provider": u.provider,
        "permissions": ROLE_PERMISSIONS.get(u.role, []),
    }


# ══════════════════════════════════════════════════════════════
# SYSTEM
# ══════════════════════════════════════════════════════════════


@app.get("/api/health", tags=["sistema"])
def health():
    return {
        "status": "ok",
        "database": engine.url.drivername,
        "oauth_google": (
            "configurado"
            if GOOGLE_CLIENT_ID
            else "no configurado "
                 "(define GOOGLE_CLIENT_ID)"
        ),
    }


# ══════════════════════════════════════════════════════════════
# AUTH — REGISTER
# ══════════════════════════════════════════════════════════════


@app.post(
    "/api/auth/register",
    tags=["auth"],
    status_code=201,
)
def register(
    data: RegisterIn,
    db: Session = Depends(get_db),
):

    if data.role not in ROLE_PERMISSIONS:
        raise HTTPException(
            status_code=400,
            detail="Rol inválido.",
        )

    email = data.email.lower()

    if db.query(User).filter(User.email == email).first():
        raise HTTPException(
            status_code=409,
            detail="Ese correo ya está registrado.",
        )

    user = User(
        email=email,
        name=data.name,
        password_hash=hash_password(data.password),
        role=data.role,
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    return {
        "token": create_token(
            user.id,
            user.email,
            user.role,
        ),
        "user": user_out(user),
    }


# ══════════════════════════════════════════════════════════════
# AUTH — LOGIN
# ══════════════════════════════════════════════════════════════


@app.post(
    "/api/auth/login",
    tags=["auth"],
)
def login(
    data: LoginIn,
    db: Session = Depends(get_db),
):

    email = data.email.lower()

    user = (
        db.query(User)
        .filter(User.email == email)
        .first()
    )

    if (
        not user
        or not user.password_hash
        or not verify_password(
            data.password,
            user.password_hash,
        )
    ):
        raise HTTPException(
            status_code=401,
            detail="Credenciales incorrectas.",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=403,
            detail="Cuenta suspendida.",
        )

    return {
        "token": create_token(
            user.id,
            user.email,
            user.role,
        ),
        "user": user_out(user),
    }


# ══════════════════════════════════════════════════════════════
# AUTH — GOOGLE OAUTH
# ══════════════════════════════════════════════════════════════


@app.post(
    "/api/auth/google",
    tags=["auth"],
)
def login_google(
    data: GoogleIn,
    db: Session = Depends(get_db),
):
    """
    OAuth real con Google.

    El frontend envía el id_token obtenido
    mediante Google Identity Services.
    """

    if not GOOGLE_CLIENT_ID:
        raise HTTPException(
            status_code=501,
            detail=(
                "OAuth de Google no configurado. "
                "Define GOOGLE_CLIENT_ID "
                "en el entorno/.env."
            ),
        )

    info = verify_google_id_token(data.id_token)

    if not info:
        raise HTTPException(
            status_code=401,
            detail="id_token de Google inválido.",
        )

    google_sub = info["sub"]
    email = info["email"].lower()

    user = (
        db.query(User)
        .filter(User.google_sub == google_sub)
        .first()
    )

    if not user:

        user = (
            db.query(User)
            .filter(User.email == email)
            .first()
        )

        if user:

            user.google_sub = google_sub
            user.provider = "google"

        else:

            user = User(
                email=email,
                name=info["name"],
                provider="google",
                google_sub=google_sub,
                role="agricultor",
            )

            db.add(user)

        db.commit()
        db.refresh(user)

    if not user.is_active:
        raise HTTPException(
            status_code=403,
            detail="Cuenta suspendida.",
        )

    return {
        "token": create_token(
            user.id,
            user.email,
            user.role,
        ),
        "user": user_out(user),
    }


# ══════════════════════════════════════════════════════════════
# AUTH — CURRENT USER
# ══════════════════════════════════════════════════════════════


@app.get(
    "/api/auth/me",
    tags=["auth"],
)
def me(
    user: User = Depends(current_user),
):
    return user_out(user)


# ══════════════════════════════════════════════════════════════
# PARCELS — LIST
# ══════════════════════════════════════════════════════════════


@app.get(
    "/api/parcels",
    tags=["parcelas"],
)
def list_parcels(
    user: User = Depends(
        require_permission("map.view")
    ),
    db: Session = Depends(get_db),
):

    rows = (
        db.query(Parcel)
        .filter(Parcel.user_id == user.id)
        .order_by(Parcel.created_at)
        .all()
    )

    return [
        {
            "id": p.id,
            "name": p.name,
            "crop": p.crop,
            "lat": p.lat,
            "lon": p.lon,
        }
        for p in rows
    ]


# ══════════════════════════════════════════════════════════════
# PARCELS — CREATE
# ══════════════════════════════════════════════════════════════


@app.post(
    "/api/parcels",
    tags=["parcelas"],
    status_code=201,
)
def create_parcel(
    data: ParcelIn,
    user: User = Depends(
        require_permission("map.edit")
    ),
    db: Session = Depends(get_db),
):

    parcel = Parcel(
        user_id=user.id,
        **data.model_dump(),
    )

    db.add(parcel)
    db.commit()
    db.refresh(parcel)

    return {
        "id": parcel.id,
        "name": parcel.name,
        "crop": parcel.crop,
        "lat": parcel.lat,
        "lon": parcel.lon,
    }


# ══════════════════════════════════════════════════════════════
# PARCELS — DELETE
# ══════════════════════════════════════════════════════════════


@app.delete(
    "/api/parcels/{parcel_id}",
    tags=["parcelas"],
    status_code=204,
)
def delete_parcel(
    parcel_id: int,
    user: User = Depends(
        require_permission("map.edit")
    ),
    db: Session = Depends(get_db),
):

    parcel = db.get(Parcel, parcel_id)

    if not parcel or parcel.user_id != user.id:
        raise HTTPException(
            status_code=404,
            detail="Parcela no encontrada.",
        )

    db.delete(parcel)
    db.commit()


# ══════════════════════════════════════════════════════════════
# HISTORY — LIST
# ══════════════════════════════════════════════════════════════


@app.get(
    "/api/history",
    tags=["historial"],
)
def list_history(
    limit: int = 25,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):

    safe_limit = min(max(limit, 1), 100)

    rows = (
        db.query(QueryHistory)
        .filter(QueryHistory.user_id == user.id)
        .order_by(QueryHistory.created_at.desc())
        .limit(safe_limit)
        .all()
    )

    return [
        {
            "id": h.id,
            "fecha": h.created_at.strftime(
                "%d/%m/%y %H:%M"
            ),
            "ubicacion": h.location_name,
            "cultivo": h.crop,
            "temp": h.temperature,
            "lluvia": h.rain_7d,
            "humedad": h.humidity,
            "score": h.score,
            "alerts": json.loads(
                h.alerts_json or "[]"
            ),
        }
        for h in rows
    ]


# ══════════════════════════════════════════════════════════════
# HISTORY — CREATE
# ══════════════════════════════════════════════════════════════


@app.post(
    "/api/history",
    tags=["historial"],
    status_code=201,
)
def add_history(
    data: HistoryIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):

    history = QueryHistory(
        user_id=user.id,
        location_name=data.location_name,
        lat=data.lat,
        lon=data.lon,
        crop=data.crop,
        temperature=data.temperature,
        rain_7d=data.rain_7d,
        humidity=data.humidity,
        score=data.score,
        alerts_json=json.dumps(data.alerts),
    )

    db.add(history)
    db.commit()
    db.refresh(history)

    return {
        "id": history.id,
    }


# ══════════════════════════════════════════════════════════════
# HISTORY — DELETE
# ══════════════════════════════════════════════════════════════


@app.delete(
    "/api/history",
    tags=["historial"],
    status_code=204,
)
def clear_history(
    user: User = Depends(
        require_permission("history.delete")
    ),
    db: Session = Depends(get_db),
):

    (
        db.query(QueryHistory)
        .filter(QueryHistory.user_id == user.id)
        .delete()
    )

    db.commit()


# ══════════════════════════════════════════════════════════════
# ADMIN — LIST USERS
# ══════════════════════════════════════════════════════════════


@app.get(
    "/api/users",
    tags=["admin"],
)
def list_users(
    user: User = Depends(
        require_permission("config.users")
    ),
    db: Session = Depends(get_db),
):

    users = db.query(User).all()

    return [
        {
            "id": u.id,
            "email": u.email,
            "name": u.name,
            "role": u.role,
            "provider": u.provider,
            "is_active": u.is_active,
        }
        for u in users
    ]


# ══════════════════════════════════════════════════════════════
# ADMIN — CHANGE ROLE
# ══════════════════════════════════════════════════════════════


@app.patch(
    "/api/users/{user_id}/role",
    tags=["admin"],
)
def change_role(
    user_id: int,
    data: RoleUpdate,
    admin: User = Depends(
        require_permission("config.users")
    ),
    db: Session = Depends(get_db),
):

    if data.role not in ROLE_PERMISSIONS:
        raise HTTPException(
            status_code=400,
            detail="Rol inválido.",
        )

    user = db.get(User, user_id)

    if not user:
        raise HTTPException(
            status_code=404,
            detail="Usuario no encontrado.",
        )

    user.role = data.role

    db.commit()

    return {
        "id": user.id,
        "role": user.role,
    }


# ══════════════════════════════════════════════════════════════
# ADMIN — ENABLE / DISABLE USER
# ══════════════════════════════════════════════════════════════


@app.patch(
    "/api/users/{user_id}/toggle",
    tags=["admin"],
)
def toggle_user(
    user_id: int,
    admin: User = Depends(
        require_permission("config.users")
    ),
    db: Session = Depends(get_db),
):

    user = db.get(User, user_id)

    if not user:
        raise HTTPException(
            status_code=404,
            detail="Usuario no encontrado.",
        )

    if user.id == admin.id:
        raise HTTPException(
            status_code=400,
            detail="No puedes suspenderte a ti mismo.",
        )

    user.is_active = not user.is_active

    db.commit()

    return {
        "id": user.id,
        "is_active": user.is_active,
    }


# ══════════════════════════════════════════════════════════════
# DEVELOPMENT SEED
# ══════════════════════════════════════════════════════════════


def seed():
    """
    Crea usuarios demo solamente si la base de datos
    está vacía.

    Para producción se recomienda desactivar este seed.
    """

    from app.database import SessionLocal

    db = SessionLocal()

    try:

        if db.query(User).count() == 0:

            demo_users = [
                (
                    "admin@agroclima.pe",
                    "Ana Ríos",
                    "admin123",
                    "admin",
                ),
                (
                    "agronomo@agroclima.pe",
                    "Luis Quispe",
                    "agro123",
                    "agronomo",
                ),
                (
                    "agricultor@agroclima.pe",
                    "María Huamán",
                    "campo123",
                    "agricultor",
                ),
            ]

            for email, name, password, role in demo_users:

                db.add(
                    User(
                        email=email,
                        name=name,
                        password_hash=hash_password(
                            password
                        ),
                        role=role,
                    )
                )

            db.commit()

            print(
                "✔ Usuarios demo creados "
                "(contraseñas hasheadas con PBKDF2)"
            )

    finally:
        db.close()


seed()


# ══════════════════════════════════════════════════════════════
# FRONTEND
# ══════════════════════════════════════════════════════════════
#
# Estructura:
#
# proyecto_agricultura/
# ├── backend/
# │   └── app/
# │       └── main.py
# │
# └── frontend/
#     ├── landing.html
#     ├── landing.html
#     ├── login.html
#     ├── dashboard.html
#     ├── mapa.html
#     ├── config.html
#     ├── notificaciones.html
#     ├── auth.js
#     ├── script.js
#     ├── notify.js
#     └── styles.css
#
# Desde:
# backend/app/main.py
#
# parent       = backend/app
# parent.parent = backend
# parent.parent.parent = proyecto_agricultura
#
# Por tanto frontend está en:
# proyecto_agricultura/frontend
# ══════════════════════════════════════════════════════════════


BASE_DIR = Path(__file__).resolve().parent
BACKEND_DIR = BASE_DIR.parent
PROJECT_DIR = BACKEND_DIR.parent

FRONTEND_DIR = PROJECT_DIR / "frontend"


# ══════════════════════════════════════════════════════════════
# FRONTEND VALIDATION
# ══════════════════════════════════════════════════════════════

INDEX_FILE = FRONTEND_DIR / "landing.html"
LANDING_FILE = FRONTEND_DIR / "landing.html"


if not FRONTEND_DIR.exists():
    raise RuntimeError(
        f"No existe el directorio frontend: {FRONTEND_DIR}"
    )


if not INDEX_FILE.exists():
    raise RuntimeError(
        f"No existe landing.html: {INDEX_FILE}"
    )


if not LANDING_FILE.exists():
    raise RuntimeError(
        f"No existe landing.html: {LANDING_FILE}"
    )


# ══════════════════════════════════════════════════════════════
# FRONTEND — ROOT
# ══════════════════════════════════════════════════════════════


@app.get(
    "/",
    include_in_schema=False,
)
def frontend_index():
    return FileResponse(INDEX_FILE)


# ══════════════════════════════════════════════════════════════
# FRONTEND — LANDING
# ══════════════════════════════════════════════════════════════


@app.get(
    "/landing",
    include_in_schema=False,
)
@app.get(
    "/landing.html",
    include_in_schema=False,
)
def frontend_landing():
    return FileResponse(LANDING_FILE)


# ══════════════════════════════════════════════════════════════
# FRONTEND — LOGIN
# ══════════════════════════════════════════════════════════════


@app.get(
    "/login",
    include_in_schema=False,
)
@app.get(
    "/login.html",
    include_in_schema=False,
)
def frontend_login():
    return FileResponse(
        FRONTEND_DIR / "login.html"
    )


# ══════════════════════════════════════════════════════════════
# FRONTEND — DASHBOARD
# ══════════════════════════════════════════════════════════════


@app.get(
    "/dashboard",
    include_in_schema=False,
)
@app.get(
    "/dashboard.html",
    include_in_schema=False,
)
def frontend_dashboard():
    return FileResponse(
        FRONTEND_DIR / "dashboard.html"
    )


# ══════════════════════════════════════════════════════════════
# FRONTEND — MAPA
# ══════════════════════════════════════════════════════════════


@app.get(
    "/mapa",
    include_in_schema=False,
)
@app.get(
    "/mapa.html",
    include_in_schema=False,
)
def frontend_mapa():
    return FileResponse(
        FRONTEND_DIR / "mapa.html"
    )


# ══════════════════════════════════════════════════════════════
# FRONTEND — CONFIG
# ══════════════════════════════════════════════════════════════


@app.get(
    "/config",
    include_in_schema=False,
)
@app.get(
    "/config.html",
    include_in_schema=False,
)
def frontend_config():
    return FileResponse(
        FRONTEND_DIR / "config.html"
    )


# ══════════════════════════════════════════════════════════════
# FRONTEND — NOTIFICACIONES
# ══════════════════════════════════════════════════════════════


@app.get(
    "/notificaciones",
    include_in_schema=False,
)
@app.get(
    "/notificaciones.html",
    include_in_schema=False,
)
def frontend_notificaciones():
    return FileResponse(
        FRONTEND_DIR / "notificaciones.html"
    )


# ══════════════════════════════════════════════════════════════
# FRONTEND — JAVASCRIPT
# ══════════════════════════════════════════════════════════════


@app.get(
    "/auth.js",
    include_in_schema=False,
)
def frontend_auth_js():
    return FileResponse(
        FRONTEND_DIR / "auth.js"
    )


@app.get(
    "/script.js",
    include_in_schema=False,
)
def frontend_script_js():
    return FileResponse(
        FRONTEND_DIR / "script.js"
    )


@app.get(
    "/notify.js",
    include_in_schema=False,
)
def frontend_notify_js():
    return FileResponse(
        FRONTEND_DIR / "notify.js"
    )


# ══════════════════════════════════════════════════════════════
# FRONTEND — CSS
# ══════════════════════════════════════════════════════════════


@app.get(
    "/styles.css",
    include_in_schema=False,
)
def frontend_styles_css():
    return FileResponse(
        FRONTEND_DIR / "styles.css"
    )


# ══════════════════════════════════════════════════════════════
# STATIC FILES
# ══════════════════════════════════════════════════════════════
#
# Permite acceder también a:
#
# /static/<archivo>
#
# Ejemplo:
# /static/styles.css
# /static/auth.js
# ══════════════════════════════════════════════════════════════


app.mount(
    "/static",
    StaticFiles(directory=str(FRONTEND_DIR)),
    name="static",
)

