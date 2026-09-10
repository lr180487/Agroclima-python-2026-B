/* ═══════════════════════════════════════════════════════════════
   AgroClima · notify.js
   Envío de notificaciones por correo mediante la GMAIL API.

   Dos modos de operación:
   ▸ REAL  : OAuth 2.0 con Google Identity Services (scope gmail.send)
             → POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send
             Requiere un Client ID de Google Cloud Console con la
             Gmail API habilitada y el origen autorizado.
   ▸ DEMO  : si no hay Client ID configurado, el correo se "envía"
             a una bandeja de salida simulada en localStorage.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

const NOTIFY_CFG_KEY = 'agroclima_notify_cfg';
const OUTBOX_KEY = 'agroclima_outbox';
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

let _tokenClient = null;
let _accessToken = null;

// ─────────── Configuración persistente ───────────
function getNotifyCfg() {
  try {
    return JSON.parse(localStorage.getItem(NOTIFY_CFG_KEY)) || {
      clientId: '', recipients: '', senderName: 'AgroClima Alertas',
      types: { helada: true, calor: true, lluvia: true, viento: true, uv: false, resumen: true },
      frequency: 'inmediato',
    };
  } catch { return { clientId: '', recipients: '', senderName: 'AgroClima Alertas', types: {}, frequency: 'inmediato' }; }
}
function saveNotifyCfg(cfg) { localStorage.setItem(NOTIFY_CFG_KEY, JSON.stringify(cfg)); }

// ─────────── Bandeja de salida ───────────
function getOutbox() {
  try { return JSON.parse(localStorage.getItem(OUTBOX_KEY)) || []; } catch { return []; }
}
function pushOutbox(entry) {
  const box = getOutbox();
  box.unshift(entry);
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(box.slice(0, 30)));
}

// ─────────── OAuth 2.0 (Google Identity Services) ───────────
function gmailReady() { return typeof google !== 'undefined' && google.accounts && google.accounts.oauth2; }

function gmailConnect(clientId) {
  return new Promise((resolve, reject) => {
    if (!gmailReady()) { reject(new Error('Google Identity Services no cargó. Verifica tu conexión.')); return; }
    if (!clientId) { reject(new Error('Ingresa un Client ID de Google Cloud.')); return; }
    try {
      _tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: GMAIL_SCOPE,
        callback: (resp) => {
          if (resp.error) { reject(new Error('OAuth: ' + resp.error)); return; }
          _accessToken = resp.access_token;
          resolve(resp);
        },
      });
      _tokenClient.requestAccessToken({ prompt: 'consent' });
    } catch (e) { reject(e); }
  });
}

function gmailConnected() { return !!_accessToken; }

// ─────────── Construcción MIME (RFC 2822, UTF-8, base64url) ───────────
function b64url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function buildMime({ to, subject, html, senderName }) {
  const headers = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
    `From: ${senderName || 'AgroClima'} <me>`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ].join('\r\n');
  const body = btoa(unescape(encodeURIComponent(html)));
  return b64url(headers + '\r\n\r\n' + body);
}

// ─────────── Plantilla HTML del correo ───────────
function emailTemplate({ title, location, alerts, metrics, footerNote }) {
  const alertRows = (alerts && alerts.length)
    ? alerts.map(([lvl, t, d]) => `
        <tr><td style="padding:10px 14px;border-radius:10px;background:${lvl === 'danger' ? '#fef2f2' : '#fffbeb'};
          border:1px solid ${lvl === 'danger' ? '#fecaca' : '#fde68a'};color:${lvl === 'danger' ? '#b91c1c' : '#b45309'};
          font-family:Arial,sans-serif;font-size:13px">
          <strong>${t}</strong><br/><span style="opacity:.85">${d}</span></td></tr>
        <tr><td style="height:8px"></td></tr>`).join('')
    : `<tr><td style="padding:10px 14px;border-radius:10px;background:#f0fdf4;border:1px solid #bbf7d0;color:#15803d;
        font-family:Arial,sans-serif;font-size:13px"><strong>🛡️ Sin alertas activas</strong><br/>
        Condiciones estables en los próximos 7 días.</td></tr>`;

  const metricCells = (metrics || []).map(([label, val]) => `
    <td style="background:#f8fafc;border-radius:10px;padding:12px;text-align:center;font-family:Arial,sans-serif">
      <div style="font-size:11px;color:#94a3b8;font-weight:bold;text-transform:uppercase">${label}</div>
      <div style="font-size:18px;color:#1e293b;font-weight:800;margin-top:2px">${val}</div>
    </td><td style="width:8px"></td>`).join('');

  return `
  <div style="background:#f1f5f9;padding:24px">
    <table style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;width:100%" cellpadding="0" cellspacing="0">
      <tr><td style="background:#166534;padding:20px 24px;font-family:Arial,sans-serif">
        <span style="font-size:22px">🌱</span>
        <span style="color:#fff;font-size:18px;font-weight:800;margin-left:6px">AgroClima</span>
        <span style="color:#bbf7d0;font-size:11px;float:right;margin-top:8px">Notificación automática · Gmail API</span>
      </td></tr>
      <tr><td style="padding:24px">
        <h2 style="font-family:Arial,sans-serif;color:#1e293b;margin:0 0 4px">${title}</h2>
        <p style="font-family:Arial,sans-serif;color:#94a3b8;font-size:13px;margin:0 0 18px">📍 ${location} · ${new Date().toLocaleString('es-PE', { dateStyle: 'full', timeStyle: 'short' })}</p>
        ${metricCells ? `<table width="100%" cellpadding="0" cellspacing="0"><tr>${metricCells}</tr></table><div style="height:18px"></div>` : ''}
        <table width="100%" cellpadding="0" cellspacing="0">${alertRows}</table>
        <div style="height:18px"></div>
        <a href="#" style="display:block;text-align:center;background:#16a34a;color:#fff;font-family:Arial,sans-serif;
          font-weight:800;font-size:14px;text-decoration:none;padding:13px;border-radius:12px">Ver dashboard completo →</a>
      </td></tr>
      <tr><td style="background:#f8fafc;padding:14px 24px;font-family:Arial,sans-serif;font-size:11px;color:#94a3b8;text-align:center">
        ${footerNote || 'Recibes este correo porque activaste las alertas de AgroClima.'}<br/>
        Datos: Open-Meteo · OpenStreetMap
      </td></tr>
    </table>
  </div>`;
}

// ─────────── Envío principal ───────────
async function sendNotification({ to, subject, html, senderName }) {
  const cfg = getNotifyCfg();
  const entry = {
    fecha: new Date().toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'medium' }),
    to, subject, mode: '', status: '',
  };

  // MODO REAL: Gmail API con token OAuth
  if (gmailConnected()) {
    try {
      const raw = buildMime({ to, subject, html, senderName: senderName || cfg.senderName });
      const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + _accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || 'HTTP ' + res.status);
      }
      const j = await res.json();
      entry.mode = 'Gmail API'; entry.status = 'enviado'; entry.gmailId = j.id;
      pushOutbox(entry);
      return { ok: true, mode: 'gmail', id: j.id };
    } catch (e) {
      entry.mode = 'Gmail API'; entry.status = 'error: ' + e.message;
      pushOutbox(entry);
      return { ok: false, mode: 'gmail', error: e.message };
    }
  }

  // MODO DEMO: bandeja simulada
  await new Promise((r) => setTimeout(r, 600)); // simula latencia
  entry.mode = 'Simulado (demo)'; entry.status = 'enviado'; entry.previewHtml = html;
  pushOutbox(entry);
  return { ok: true, mode: 'demo' };
}
