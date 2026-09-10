"""
AgroClima · security.py
Hash de contraseñas (PBKDF2-SHA256, stdlib — sin dependencias nativas),
emisión/validación de JWT y verificación de id_tokens de Google OAuth.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import urllib.request
from datetime import datetime, timedelta, timezone

import jwt

# ─── Config (usa .env / entorno en producción) ───
JWT_SECRET = os.getenv("JWT_SECRET", "cambia-esto-en-produccion-" + "agroclima")
JWT_ALG = "HS256"
JWT_EXPIRE_MIN = int(os.getenv("JWT_EXPIRE_MIN", "480"))  # 8 horas

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")  # vacío = OAuth deshabilitado

PBKDF2_ITERATIONS = 260_000


# ─── Passwords ───
def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2${PBKDF2_ITERATIONS}${base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, iters, salt_b64, dk_b64 = stored.split("$")
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(dk_b64)
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, int(iters))
        return hmac.compare_digest(dk, expected)
    except Exception:
        return False


# ─── JWT ───
def create_token(user_id: int, email: str, role: str) -> str:
    payload = {
        "sub": str(user_id),
        "email": email,
        "role": role,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRE_MIN),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.PyJWTError:
        return None


# ─── Google OAuth (verificación de id_token vía tokeninfo) ───
def verify_google_id_token(id_token: str) -> dict | None:
    """
    Verifica un id_token de Google Identity Services.
    Producción ideal: validar firma localmente con las claves públicas de Google
    (google-auth). Aquí usamos el endpoint tokeninfo oficial por simplicidad.
    Devuelve {sub, email, name} o None si es inválido.
    """
    if not GOOGLE_CLIENT_ID:
        return None
    try:
        url = "https://oauth2.googleapis.com/tokeninfo?id_token=" + urllib.parse.quote(id_token)
        with urllib.request.urlopen(url, timeout=10) as r:
            info = json.loads(r.read())
        if info.get("aud") != GOOGLE_CLIENT_ID:
            return None
        return {"sub": info["sub"], "email": info["email"], "name": info.get("name", info["email"])}
    except Exception:
        return None
