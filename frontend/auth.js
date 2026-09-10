/* ═══════════════════════════════════════════════════════
   AgroClima · auth.js
   RBAC (Role-Based Access Control) + sesión simulada.
   En producción esto lo haría un backend con OAuth 2.0 /
   OpenID Connect y JWT firmados.
   ═══════════════════════════════════════════════════════ */
'use strict';

const AUTH_KEY = 'agroclima_session';

// ─── Definición de roles y permisos (RBAC) ───
const ROLES = {
  admin: {
    label: 'Administrador',
    icon: '🛡️',
    color: 'red',
    permissions: [
      'dashboard.view', 'map.view', 'map.edit',
      'config.profile', 'config.alerts', 'config.units',
      'config.users', 'config.system', 'history.delete',
    ],
  },
  agronomo: {
    label: 'Agrónomo',
    icon: '🔬',
    color: 'blue',
    permissions: [
      'dashboard.view', 'map.view', 'map.edit',
      'config.profile', 'config.alerts', 'config.units',
    ],
  },
  agricultor: {
    label: 'Agricultor',
    icon: '🌾',
    color: 'green',
    permissions: ['dashboard.view', 'map.view', 'config.profile', 'config.units'],
  },
};

// ─── Usuarios demo (en producción: PostgreSQL + hash bcrypt) ───
const DEMO_USERS = [
  { email: 'admin@agroclima.pe',      password: 'admin123', name: 'Ana Ríos',      role: 'admin' },
  { email: 'agronomo@agroclima.pe',   password: 'agro123',  name: 'Luis Quispe',   role: 'agronomo' },
  { email: 'agricultor@agroclima.pe', password: 'campo123', name: 'María Huamán',  role: 'agricultor' },
];

// ─── API de sesión ───
function login(email, password) {
  const user = DEMO_USERS.find(
    (u) => u.email.toLowerCase() === email.toLowerCase() && u.password === password
  );
  if (!user) return { ok: false, error: 'Credenciales incorrectas. Usa una de las cuentas demo.' };
  const session = {
    email: user.email, name: user.name, role: user.role,
    provider: 'password', loginAt: new Date().toISOString(),
  };
  localStorage.setItem(AUTH_KEY, JSON.stringify(session));
  return { ok: true, session };
}

function loginOAuth(provider, role) {
  // Simula el flujo OAuth 2.0: redirect → consent → callback con token.
  const names = { google: 'Usuario Google', microsoft: 'Usuario Microsoft', github: 'Usuario GitHub' };
  const session = {
    email: `demo.${provider}@agroclima.pe`,
    name: names[provider] || 'Usuario OAuth',
    role: role || 'agricultor',
    provider,
    loginAt: new Date().toISOString(),
  };
  localStorage.setItem(AUTH_KEY, JSON.stringify(session));
  return session;
}

function getSession() {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY)); } catch { return null; }
}

function logout() {
  localStorage.removeItem(AUTH_KEY);
  window.location.href = 'login.html';
}

function hasPermission(perm) {
  const s = getSession();
  if (!s) return false;
  return (ROLES[s.role]?.permissions || []).includes(perm);
}

// Protege una página: redirige al login si no hay sesión o falta permiso.
function requireAuth(requiredPerm) {
  const s = getSession();
  if (!s) { window.location.href = 'login.html'; return null; }
  if (requiredPerm && !hasPermission(requiredPerm)) {
    alert('⛔ No tienes permisos para acceder a esta sección (rol: ' + (ROLES[s.role]?.label || s.role) + ').');
    window.location.href = 'dashboard.html';
    return null;
  }
  return s;
}

// Pinta la insignia de usuario en la navbar (elemento #userBadge si existe).
function renderUserBadge() {
  const s = getSession();
  const el = document.getElementById('userBadge');
  if (!el || !s) return;
  const r = ROLES[s.role];
  el.innerHTML = `
    <div class="flex items-center gap-3">
      <div class="text-right hidden sm:block">
        <p class="text-sm font-bold leading-none">${s.name}</p>
        <p class="text-[11px] opacity-70 mt-0.5">${r.icon} ${r.label}</p>
      </div>
      <div class="w-9 h-9 rounded-full bg-white/20 border border-white/30 flex items-center justify-center font-black text-sm">
        ${s.name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()}
      </div>
      <button onclick="logout()" title="Cerrar sesión"
        class="ml-1 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-bold transition">
        Salir
      </button>
    </div>`;
}
