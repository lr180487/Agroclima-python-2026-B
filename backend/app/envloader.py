"""
AgroClima · envloader.py
Carga las variables del archivo .env al entorno (sin dependencias).
Las variables ya definidas en el entorno real tienen prioridad
(patrón 12-factor: el entorno del servidor manda sobre el archivo).
"""
import os

_loaded = False


def load_env(path: str | None = None) -> None:
    global _loaded
    if _loaded:
        return
    _loaded = True

    if path is None:
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if not os.path.exists(path):
        return

    with open(path, encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            # El entorno real tiene prioridad sobre el archivo
            if key and key not in os.environ:
                os.environ[key] = value


load_env()
