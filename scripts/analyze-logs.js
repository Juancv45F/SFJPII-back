const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '../logs');

function getTodayFile() {
  const date = new Date();
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const candidates = [
    path.join(LOG_DIR, `app-${yyyy}-${mm}-${dd}.jsonl`),
    path.join(LOG_DIR, `app-${yyyy}-${mm}-${dd}.log`),
    path.join(LOG_DIR, `app-${yyyy}-${mm}-${dd}.json`)
  ];
  for (const f of candidates) {
    if (fs.existsSync(f)) return f;
  }
  return candidates[0];
}

function readLines(file) {
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, 'utf8');
  return content.split(/\r?\n/).filter(Boolean);
}

function parseLine(line) {
  try { return JSON.parse(line); } catch { return null; }
}

function percentile(arr, p) {
  if (arr.length === 0) return null;
  const sorted = arr.slice().sort((a,b) => a-b);
  const idx = Math.ceil((p/100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function analyze() {
  const file = getTodayFile();
  const lines = readLines(file);
  const records = lines.map(parseLine).filter(Boolean);

  const requests = records.filter(r => r.message === 'request_completed');
  const errors = records.filter(r => r.level === 'error');
  const slowQueries = records.filter(r => r.message === 'slow_query');

  const respTimes = requests
    .map(r => {
      const v = r.responseTimeMs;
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? n : null;
    })
    .filter(v => v !== null);
  const p50 = percentile(respTimes, 50);
  const p95 = percentile(respTimes, 95);
  const p99 = percentile(respTimes, 99);

  const byRoute = {};
  for (const r of requests) {
    const route = r.path;
    byRoute[route] = (byRoute[route] || 0) + 1;
  }
  const topRoutes = Object.entries(byRoute).sort((a,b) => b[1]-a[1]).slice(0,10);

  const byErrorMsg = {};
  for (const e of errors) {
    const msg = e.message;
    byErrorMsg[msg] = (byErrorMsg[msg] || 0) + 1;
  }
  const topErrors = Object.entries(byErrorMsg).sort((a,b) => b[1]-a[1]).slice(0,10);

  const businessEvents = [
    'pedido_creado','producto_creado','producto_actualizado','producto_eliminado','stock_actualizado_evento',
    'ubicacion_creada','usuario_registrado','login_exitoso'
  ];
  const bizCounts = {};
  for (const ev of businessEvents) bizCounts[ev] = 0;
  for (const r of records) {
    if (businessEvents.includes(r.message)) {
      bizCounts[r.message]++;
    }
  }

  const histogram = {};
  for (const r of requests) {
    const t = new Date(r.timestamp);
    const key = `${t.getUTCHours().toString().padStart(2,'0')}:${t.getUTCMinutes().toString().padStart(2,'0')}`;
    histogram[key] = (histogram[key] || 0) + 1;
  }

  const summary = {
    total_records: records.length,
    total_requests: requests.length,
    response_time_ms: { p50, p95, p99 },
    top_routes: topRoutes.map(([route, count]) => ({ route, count })),
    top_errors: topErrors.map(([message, count]) => ({ message, count })),
    business_events: bizCounts,
    slow_queries_count: slowQueries.length,
    histogram_per_minute: histogram,
  };

  console.log(JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(LOG_DIR, 'analysis-summary.json'), JSON.stringify(summary, null, 2));
}

analyze();
