# AgroClima · Backend (FastAPI)

API real con autenticación JWT, RBAC y persistencia en base de datos.

## Ejecutar

```bash
cd backend
pip install -r requirements.txt
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000
```

Sirve **frontend + API en el mismo puerto**:
- Frontend: `http://localhost:8000/` (landing, login, dashboard…)
- API: `http://localhost:8000/api/*`
- **Documentación interactiva (Swagger): `http://localhost:8000/docs`**

## Endpoints

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| GET | `/api/health` | público | Estado del sistema, DB y OAuth |
| POST | `/api/auth/register` | público | Crear cuenta (PBKDF2 260k iteraciones) |
| POST | `/api/auth/login` | público | Login → JWT (8 h) |
| POST | `/api/auth/google` | público | OAuth Google real (id_token) |
| GET | `/api/auth/me` | token | Usuario actual + permisos |
| GET | `/api/parcels` | `map.view` | Parcelas del usuario |
| POST | `/api/parcels` | `map.edit` | Crear parcela |
| DELETE | `/api/parcels/{id}` | `map.edit` | Eliminar parcela |
| GET | `/api/history` | token | Historial de consultas |
| POST | `/api/history` | token | Guardar consulta del motor analítico |
| DELETE | `/api/history` | `history.delete` | Vaciar historial (solo admin) |
| GET | `/api/users` | `config.users` | Listar usuarios (solo admin) |
| PATCH | `/api/users/{id}/role` | `config.users` | Cambiar rol |
| PATCH | `/api/users/{id}/toggle` | `config.users` | Suspender/activar |

## Usuarios demo (seed automático)

| Email | Contraseña | Rol |
|---|---|---|
| admin@agroclima.pe | admin123 | 🛡️ admin |
| agronomo@agroclima.pe | agro123 | 🔬 agronomo |
| agricultor@agroclima.pe | campo123 | 🌾 agricultor |

## Migrar a PostgreSQL real

1. `createdb agroclima && psql -d agroclima -f schema_postgres.sql`
2. `pip install psycopg2-binary`
3. `export DATABASE_URL=postgresql+psycopg2://usuario:clave@localhost:5432/agroclima`
4. Reinicia el servidor. Nada más cambia: SQLAlchemy usa el mismo código.

## Activar OAuth de Google real

1. [console.cloud.google.com](https://console.cloud.google.com) → proyecto → OAuth consent screen
2. Credenciales → **OAuth Client ID** (tipo Web) → autoriza el origen del frontend
3. `export GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com`
4. El frontend envía el `id_token` de Google Identity Services a `POST /api/auth/google`;
   el backend lo verifica contra Google y emite su propio JWT.

Ver `.env.example` para todas las variables.
