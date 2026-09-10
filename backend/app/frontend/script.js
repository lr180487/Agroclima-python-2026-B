/* ═══════════════════════════════════════════════════════════════
   AgroClima · script.js
   Flujo:  Ubicación (Nominatim/OSM) → Clima (Open-Meteo)
           → Motor Analítico → Recomendaciones + Alertas
           Historial → localStorage (simula PostgreSQL)
   ═══════════════════════════════════════════════════════════════ */

'use strict';

// ─────────────────────────── CONFIG ───────────────────────────
const API = {
  nominatim: 'https://nominatim.openstreetmap.org/search',
  meteo: 'https://api.open-meteo.com/v1/forecast',
};

const HISTORY_KEY = 'agroclima_history';

// Requerimientos agroclimáticos por cultivo (°C, mm/semana, % humedad)
const CROPS = {
  papa:   { nombre: 'Papa',   tMin: 7,  tMax: 24, humMin: 60, humMax: 85, lluviaSemana: [15, 40], vientoMax: 40 },
  maiz:   { nombre: 'Maíz',   tMin: 12, tMax: 32, humMin: 50, humMax: 80, lluviaSemana: [20, 50], vientoMax: 45 },
  arroz:  { nombre: 'Arroz',  tMin: 18, tMax: 35, humMin: 70, humMax: 95, lluviaSemana: [30, 80], vientoMax: 35 },
  cafe:   { nombre: 'Café',   tMin: 15, tMax: 28, humMin: 60, humMax: 85, lluviaSemana: [25, 60], vientoMax: 30 },
  quinua: { nombre: 'Quinua', tMin: 5,  tMax: 25, humMin: 40, humMax: 70, lluviaSemana: [8, 30],  vientoMax: 50 },
  tomate: { nombre: 'Tomate', tMin: 13, tMax: 30, humMin: 55, humMax: 80, lluviaSemana: [15, 40], vientoMax: 35 },
  palta:  { nombre: 'Palta',  tMin: 14, tMax: 30, humMin: 55, humMax: 80, lluviaSemana: [20, 50], vientoMax: 30 },
  uva:    { nombre: 'Uva',    tMin: 12, tMax: 32, humMin: 40, humMax: 70, lluviaSemana: [5, 25],  vientoMax: 40 },
};

// Códigos WMO de Open-Meteo → descripción + icono
const WMO = {
  0: ['Despejado', '☀️'], 1: ['Mayormente despejado', '🌤️'], 2: ['Parcialmente nublado', '⛅'],
  3: ['Nublado', '☁️'], 45: ['Niebla', '🌫️'], 48: ['Niebla con escarcha', '🌫️'],
  51: ['Llovizna ligera', '🌦️'], 53: ['Llovizna moderada', '🌦️'], 55: ['Llovizna densa', '🌧️'],
  61: ['Lluvia ligera', '🌧️'], 63: ['Lluvia moderada', '🌧️'], 65: ['Lluvia fuerte', '🌧️'],
  66: ['Lluvia helada', '🌨️'], 67: ['Lluvia helada fuerte', '🌨️'],
  71: ['Nieve ligera', '🌨️'], 73: ['Nieve moderada', '🌨️'], 75: ['Nieve fuerte', '❄️'],
  80: ['Chubascos ligeros', '🌦️'], 81: ['Chubascos moderados', '🌧️'], 82: ['Chubascos violentos', '⛈️'],
  95: ['Tormenta eléctrica', '⛈️'], 96: ['Tormenta con granizo', '⛈️'], 99: ['Tormenta con granizo fuerte', '⛈️'],
};

// ─────────────────────────── ESTADO ───────────────────────────
let currentLocation = null; // { lat, lon, name }

// ─────────────────────────── HELPERS DOM ───────────────────────────
const $ = (id) => document.getElementById(id);

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

function setLoading(on) {
  if (on) {
    hide($('emptyState')); hide($('dashboard')); hide($('errorBox'));
    $('loader').classList.remove('hidden'); $('loader').classList.add('flex');
  } else {
    $('loader').classList.add('hidden'); $('loader').classList.remove('flex');
  }
}

function showError(msg) {
  setLoading(false);
  $('errorBox').textContent = '⚠️ ' + msg;
  show($('errorBox'));
}

// ─────────────────────────── 1) UBICACIÓN (OSM/Nominatim · prioriza Perú 🇵🇪) ───────────────────────────
async function geocode(query) {
  // Primero busca solo dentro del Perú; si no hay resultados, amplía a búsqueda mundial.
  const base = `${API.nominatim}?format=json&limit=5&accept-language=es&q=${encodeURIComponent(query)}`;
  let res = await fetch(base + '&countrycodes=pe', { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('No se pudo conectar con OpenStreetMap.');
  let results = await res.json();
  if (!results.length) {
    res = await fetch(base, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error('No se pudo conectar con OpenStreetMap.');
    results = await res.json();
  }
  return results;
}

function renderSearchResults(results) {
  const box = $('searchResults');
  box.innerHTML = '';
  if (!results.length) {
    box.innerHTML = '<button disabled>Sin resultados…</button>';
  } else {
    results.forEach((r) => {
      const btn = document.createElement('button');
      btn.textContent = '📍 ' + r.display_name;
      btn.addEventListener('click', () => {
        hide(box);
        $('searchInput').value = r.display_name.split(',').slice(0, 2).join(',');
        selectLocation(parseFloat(r.lat), parseFloat(r.lon), r.display_name);
      });
      box.appendChild(btn);
    });
  }
  show(box);
}

function selectLocation(lat, lon, name) {
  currentLocation = { lat, lon, name };
  $('locationText').textContent = `${name}  ·  (${lat.toFixed(4)}, ${lon.toFixed(4)})`;
  show($('locationLabel'));
  runAnalysis();
}

// ─────────────────────────── 2) CLIMA (Open-Meteo) ───────────────────────────
async function fetchWeather(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: [
      'temperature_2m', 'apparent_temperature', 'relative_humidity_2m',
      'precipitation', 'weather_code', 'wind_speed_10m', 'wind_direction_10m',
    ].join(','),
    hourly: 'shortwave_radiation,dew_point_2m',
    daily: [
      'weather_code', 'temperature_2m_max', 'temperature_2m_min',
      'precipitation_sum', 'precipitation_probability_max',
      'wind_speed_10m_max', 'uv_index_max', 'shortwave_radiation_sum',
    ].join(','),
    forecast_days: 7,
    timezone: 'auto',
  });
  const res = await fetch(`${API.meteo}?${params}`);
  if (!res.ok) throw new Error('No se pudo obtener datos de Open-Meteo.');
  return res.json();
}

// ─────────────────────────── 3) MOTOR ANALÍTICO ───────────────────────────
function windDirection(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  return dirs[Math.round(deg / 45) % 8];
}

function analyze(weather, cropKey) {
  const crop = CROPS[cropKey];
  const cur = weather.current;
  const daily = weather.daily;

  const temp = cur.temperature_2m;
  const hum = cur.relative_humidity_2m;
  const wind = cur.wind_speed_10m;
  const rain7d = daily.precipitation_sum.reduce((a, b) => a + (b || 0), 0);
  const tMinWeek = Math.min(...daily.temperature_2m_min);
  const tMaxWeek = Math.max(...daily.temperature_2m_max);
  const uvMax = Math.max(...daily.uv_index_max.map((v) => v || 0));
  const windMaxWeek = Math.max(...daily.wind_speed_10m_max);

  let score = 100;
  const recs = [];
  const alerts = [];

  // ---- Temperatura ----
  if (temp < crop.tMin) {
    score -= 20;
    recs.push(['🥶', `La temperatura actual (<strong>${temp.toFixed(1)}°C</strong>) está por debajo del rango óptimo de la ${crop.nombre.toLowerCase()} (${crop.tMin}–${crop.tMax}°C). Considera coberturas térmicas o riego por aspersión anti-helada.`]);
  } else if (temp > crop.tMax) {
    score -= 20;
    recs.push(['🥵', `Temperatura actual (<strong>${temp.toFixed(1)}°C</strong>) sobre el máximo tolerado (${crop.tMax}°C). Aumenta la frecuencia de riego y aplica mulching para conservar humedad del suelo.`]);
  } else {
    recs.push(['✅', `Temperatura actual (<strong>${temp.toFixed(1)}°C</strong>) dentro del rango óptimo para ${crop.nombre.toLowerCase()} (${crop.tMin}–${crop.tMax}°C).`]);
  }

  if (tMinWeek <= 0) {
    score -= 15;
    alerts.push(['danger', '❄️ Alerta de helada', `Se pronostican mínimas de ${tMinWeek.toFixed(1)}°C esta semana. Riesgo alto de daño por congelamiento en tejidos vegetales.`]);
  } else if (tMinWeek < crop.tMin - 3) {
    score -= 8;
    alerts.push(['warning', '🌡️ Descenso térmico', `Mínimas de hasta ${tMinWeek.toFixed(1)}°C previstas, por debajo de la tolerancia del cultivo.`]);
  }
  if (tMaxWeek > crop.tMax + 5) {
    score -= 10;
    alerts.push(['warning', '🔥 Ola de calor', `Máximas de hasta ${tMaxWeek.toFixed(1)}°C esta semana. Riesgo de estrés térmico y aborto floral.`]);
  }

  // ---- Precipitación ----
  const [rainMin, rainMax] = crop.lluviaSemana;
  if (rain7d < rainMin) {
    score -= 15;
    recs.push(['💧', `Lluvia acumulada prevista (7 días): <strong>${rain7d.toFixed(1)} mm</strong>, por debajo del requerimiento (${rainMin}–${rainMax} mm/semana). Programa <strong>riego suplementario</strong>.`]);
  } else if (rain7d > rainMax) {
    score -= 15;
    recs.push(['🌊', `Exceso de lluvia previsto (<strong>${rain7d.toFixed(1)} mm</strong> en 7 días). Verifica drenajes y monitorea aparición de hongos (tizón, mildiu).`]);
    if (rain7d > rainMax * 1.8) {
      alerts.push(['danger', '🌊 Riesgo de anegamiento', `Precipitación acumulada de ${rain7d.toFixed(0)} mm en 7 días. Posible saturación del suelo y pérdida de raíces.`]);
    }
  } else {
    recs.push(['✅', `Precipitación semanal prevista (<strong>${rain7d.toFixed(1)} mm</strong>) adecuada para el cultivo.`]);
  }

  // ---- Humedad ----
  if (hum > crop.humMax) {
    score -= 10;
    recs.push(['🍄', `Humedad relativa alta (<strong>${hum}%</strong>). Riesgo de enfermedades fúngicas: considera aplicación preventiva de fungicida y mejora la ventilación del cultivo.`]);
  } else if (hum < crop.humMin) {
    score -= 8;
    recs.push(['🏜️', `Humedad relativa baja (<strong>${hum}%</strong>). Aumenta la lámina de riego en horas de menor evaporación (amanecer/atardecer).`]);
  }

  // ---- Viento ----
  if (windMaxWeek > crop.vientoMax) {
    score -= 10;
    alerts.push(['warning', '💨 Vientos fuertes', `Ráfagas de hasta ${windMaxWeek.toFixed(0)} km/h previstas. Refuerza tutores y cortavientos; evita aplicaciones foliares esos días.`]);
  }
  if (wind > 25) {
    recs.push(['💨', `Viento actual de <strong>${wind.toFixed(0)} km/h</strong>: evita pulverizaciones para prevenir deriva del producto.`]);
  }

  // ---- Radiación / UV ----
  if (uvMax >= 11) {
    alerts.push(['warning', '☀️ Radiación UV extrema', `Índice UV máximo de ${uvMax.toFixed(0)} esta semana. Riesgo de golpe de sol en frutos; considera mallas de sombreo.`]);
    score -= 5;
  }

  // ---- Tormentas en el pronóstico ----
  const stormDays = daily.weather_code.filter((c) => c >= 95).length;
  if (stormDays > 0) {
    alerts.push(['danger', '⛈️ Tormentas eléctricas', `Se prevén tormentas en ${stormDays} día(s) de los próximos 7. Suspende labores de campo durante los eventos y protege equipos de riego.`]);
    score -= 8;
  }

  // ---- Ventana de siembra / labores ----
  const dryDays = daily.precipitation_sum.filter((p) => (p || 0) < 1).length;
  if (dryDays >= 3) {
    recs.push(['🚜', `Hay <strong>${dryDays} días con baja probabilidad de lluvia</strong> esta semana: ventana favorable para labores de campo, siembra o cosecha.`]);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, recs, alerts, rain7d };
}

// ─────────────────────────── RENDERIZADO ───────────────────────────
function renderCurrent(w) {
  const cur = w.current;
  const d = w.daily;
  const [skyTxt, skyIco] = WMO[cur.weather_code] || ['—', '❔'];

  // radiación: promedio de las próximas 24 h
  const now = new Date(cur.time);
  const radValues = w.hourly.shortwave_radiation.slice(0, 24).filter((v) => v != null);
  const radAvg = radValues.length ? radValues.reduce((a, b) => a + b, 0) / radValues.length : 0;
  const dewNow = w.hourly.dew_point_2m[0];

  $('mTemp').textContent = `${cur.temperature_2m.toFixed(1)}°C`;
  $('mTempFeel').textContent = `Sensación: ${cur.apparent_temperature.toFixed(1)}°C`;
  $('mRain').textContent = `${cur.precipitation.toFixed(1)} mm`;
  $('mRainProb').textContent = `Prob. hoy: ${d.precipitation_probability_max[0] ?? '--'}%`;
  $('mHum').textContent = `${cur.relative_humidity_2m}%`;
  $('mDew').textContent = `Rocío: ${dewNow != null ? dewNow.toFixed(1) + '°C' : '--'}`;
  $('mWind').textContent = `${cur.wind_speed_10m.toFixed(0)} km/h`;
  $('mWindDir').textContent = `Dirección: ${windDirection(cur.wind_direction_10m)} (${cur.wind_direction_10m}°)`;
  $('mRad').textContent = `${radAvg.toFixed(0)} W/m²`;
  $('mUV').textContent = `Índice UV: ${d.uv_index_max[0]?.toFixed(1) ?? '--'}`;
  $('mSkyIcon').textContent = skyIco;
  $('mSky').textContent = skyTxt;
  $('updatedAt').textContent = 'Actualizado: ' + now.toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' });
}

function renderForecast(w) {
  const d = w.daily;
  const grid = $('forecastGrid');
  grid.innerHTML = '';
  d.time.forEach((dateStr, i) => {
    const date = new Date(dateStr + 'T12:00:00');
    const [txt, ico] = WMO[d.weather_code[i]] || ['—', '❔'];
    const card = document.createElement('div');
    card.className = 'forecast-card';
    card.title = txt;
    card.innerHTML = `
      <p class="fc-day">${i === 0 ? 'Hoy' : date.toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric' })}</p>
      <p class="fc-icon">${ico}</p>
      <p class="fc-temp">${d.temperature_2m_max[i].toFixed(0)}° / ${d.temperature_2m_min[i].toFixed(0)}°</p>
      <p class="fc-rain">💧 ${(d.precipitation_sum[i] || 0).toFixed(1)} mm · ${d.precipitation_probability_max[i] ?? 0}%</p>`;
    grid.appendChild(card);
  });
}

function renderAnalysis(analysis, cropKey) {
  const crop = CROPS[cropKey];
  $('cropName').textContent = crop.nombre;

  // Gauge
  const circumference = 2 * Math.PI * 52;
  const arc = $('gaugeArc');
  const color = analysis.score >= 70 ? '#22c55e' : analysis.score >= 40 ? '#eab308' : '#ef4444';
  arc.style.stroke = color;
  requestAnimationFrame(() => {
    arc.style.strokeDashoffset = circumference * (1 - analysis.score / 100);
  });
  $('gaugeValue').textContent = analysis.score;

  const label = $('gaugeLabel');
  if (analysis.score >= 70) {
    label.textContent = '🌿 Condiciones favorables';
    label.className = 'mt-3 px-4 py-1.5 rounded-full text-xs font-bold bg-green-100 text-green-700';
  } else if (analysis.score >= 40) {
    label.textContent = '⚠️ Condiciones regulares';
    label.className = 'mt-3 px-4 py-1.5 rounded-full text-xs font-bold bg-yellow-100 text-yellow-700';
  } else {
    label.textContent = '🚨 Condiciones adversas';
    label.className = 'mt-3 px-4 py-1.5 rounded-full text-xs font-bold bg-red-100 text-red-700';
  }

  // Recomendaciones
  const list = $('recommendList');
  list.innerHTML = '';
  analysis.recs.forEach(([icon, html], i) => {
    const li = document.createElement('li');
    li.className = 'rec-item';
    li.style.animationDelay = `${i * 80}ms`;
    li.innerHTML = `<span class="rec-icon">${icon}</span><span>${html}</span>`;
    list.appendChild(li);
  });

  // Alertas
  const alertsSec = $('alertsSection');
  alertsSec.innerHTML = '';
  if (!analysis.alerts.length) {
    alertsSec.innerHTML = `
      <div class="alert-card info">
        <span class="text-xl">🛡️</span>
        <div>
          <p class="alert-title">Sin alertas meteorológicas activas</p>
          <p class="alert-desc">No se detectaron eventos de riesgo (heladas, tormentas, vientos o anegamiento) en los próximos 7 días.</p>
        </div>
      </div>`;
  } else {
    analysis.alerts.forEach(([level, title, desc], i) => {
      const div = document.createElement('div');
      div.className = `alert-card ${level}`;
      div.style.animationDelay = `${i * 100}ms`;
      div.innerHTML = `
        <span class="text-xl">${title.split(' ')[0]}</span>
        <div>
          <p class="alert-title">${title.substring(title.indexOf(' ') + 1)}</p>
          <p class="alert-desc">${desc}</p>
        </div>`;
      alertsSec.appendChild(div);
    });
  }
}

// ─────────────────────────── 4) HISTORIAL (simula PostgreSQL) ───────────────────────────
function getHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
  catch { return []; }
}

function saveHistoryEntry(entry) {
  const hist = getHistory();
  hist.unshift(entry);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(hist.slice(0, 25)));
}

function renderHistory() {
  const hist = getHistory();
  const body = $('historyBody');
  body.innerHTML = '';
  if (!hist.length) { show($('historyEmpty')); return; }
  hide($('historyEmpty'));
  hist.forEach((h) => {
    const cls = h.score >= 70 ? 'good' : h.score >= 40 ? 'mid' : 'bad';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="whitespace-nowrap">${h.fecha}</td>
      <td class="max-w-[220px] truncate" title="${h.ubicacion}">${h.ubicacion}</td>
      <td>${h.cultivo}</td>
      <td>${h.temp}°C</td>
      <td>${h.lluvia} mm</td>
      <td>${h.humedad}%</td>
      <td><span class="badge-score ${cls}">${h.score}</span></td>`;
    body.appendChild(tr);
  });
}

// ─────────────────────────── ORQUESTADOR ───────────────────────────
async function runAnalysis() {
  if (!currentLocation) return;
  setLoading(true);
  try {
    const weather = await fetchWeather(currentLocation.lat, currentLocation.lon);
    const cropKey = $('cropSelect').value;
    const analysis = analyze(weather, cropKey);

    renderCurrent(weather);
    renderForecast(weather);
    renderAnalysis(analysis, cropKey);

    // Guardar en "PostgreSQL" (localStorage)
    saveHistoryEntry({
      fecha: new Date().toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }),
      ubicacion: currentLocation.name.split(',').slice(0, 2).join(','),
      cultivo: CROPS[cropKey].nombre,
      temp: weather.current.temperature_2m.toFixed(1),
      lluvia: analysis.rain7d.toFixed(1),
      humedad: weather.current.relative_humidity_2m,
      score: analysis.score,
    });
    renderHistory();

    setLoading(false);
    hide($('emptyState'));
    show($('dashboard'));
  } catch (err) {
    console.error(err);
    showError(err.message || 'Error inesperado al procesar los datos.');
  }
}

// ─────────────────────────── EVENTOS ───────────────────────────
async function handleSearch() {
  const q = $('searchInput').value.trim();
  if (!q) return;
  try {
    const results = await geocode(q);
    if (results.length === 1) {
      selectLocation(parseFloat(results[0].lat), parseFloat(results[0].lon), results[0].display_name);
    } else {
      renderSearchResults(results);
    }
  } catch (err) {
    showError(err.message);
  }
}

$('btnSearch').addEventListener('click', handleSearch);
$('searchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSearch(); });

// Autocompletado con debounce
let debounceTimer;
$('searchInput').addEventListener('input', () => {
  clearTimeout(debounceTimer);
  const q = $('searchInput').value.trim();
  if (q.length < 3) { hide($('searchResults')); return; }
  debounceTimer = setTimeout(async () => {
    try { renderSearchResults(await geocode(q)); } catch { /* silencioso */ }
  }, 450);
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('#searchInput') && !e.target.closest('#searchResults')) {
    hide($('searchResults'));
  }
});

// Geolocalización del navegador
$('btnGeo').addEventListener('click', () => {
  if (!navigator.geolocation) { showError('Tu navegador no soporta geolocalización.'); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      $('searchInput').value = 'Mi ubicación';
      selectLocation(pos.coords.latitude, pos.coords.longitude, `Mi ubicación (GPS)`);
    },
    () => showError('No se pudo obtener tu ubicación. Verifica los permisos del navegador.')
  );
});

// Re-analizar al cambiar de cultivo
$('cropSelect').addEventListener('change', () => { if (currentLocation) runAnalysis(); });

// Limpiar historial
$('btnClearHistory').addEventListener('click', () => {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
});

// Inicio
renderHistory();
