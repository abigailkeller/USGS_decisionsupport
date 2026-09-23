const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const ROOT = __dirname;
const STAGING_DIR = path.join(ROOT, 'data', 'staging');
const MODEL_DATA_DIR = path.join(ROOT, 'data', 'model_data');
const POSTERIOR_DIR = path.join(ROOT, 'data', 'posterior_samples');
const PROGRESS_PATH = path.join(POSTERIOR_DIR, 'progress.json');
const OUTPUT_PATH = path.join(POSTERIOR_DIR, 'onepulse.rds');
const PORT = process.env.PORT || 8000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.csv': 'text/csv',
  '.json': 'application/json',
};

let modelRunInProgress = false;

function csvField(value) {
  const stringValue = String(value ?? '');
  return /[",\n]/.test(stringValue) ? `"${stringValue.replace(/"/g, '""')}"` : stringValue;
}

function writeCsv(filePath, header, rows) {
  const lines = [header.map(csvField).join(',')];
  rows.forEach((row) => lines.push(row.map(csvField).join(',')));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines.join('\n'));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 50 * 1024 * 1024) req.destroy(new Error('Request body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  const relativePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(ROOT, relativePath));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

function handlePrepareData(req, res) {
  readBody(req).then((raw) => {
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (error) {
      return sendJson(res, 400, { error: 'Invalid JSON body.' });
    }
    const { catchRows, effortRows } = payload;
    if (!Array.isArray(catchRows) || !catchRows.length || !Array.isArray(effortRows) || !effortRows.length) {
      return sendJson(res, 400, { error: 'Both catchRows and effortRows are required and must be non-empty.' });
    }

    const catchPath = path.join(STAGING_DIR, 'catch.csv');
    const effortPath = path.join(STAGING_DIR, 'effort.csv');
    writeCsv(catchPath, ['Date', 'Trap_Type', 'Trap_Number', 'Size_mm'], catchRows);
    writeCsv(effortPath, ['Date', 'Trap_Type', 'Trap_Number'], effortRows);

    execFile('Rscript', ['util_code/prep_model_data.R', catchPath, effortPath, MODEL_DATA_DIR], { cwd: ROOT, maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        return sendJson(res, 500, { error: 'Data preparation failed.', details: stderr || stdout || error.message });
      }
      sendJson(res, 200, { ok: true });
    });
  }).catch((error) => sendJson(res, 400, { error: error.message }));
}

function handleRunModel(req, res) {
  if (modelRunInProgress) {
    return sendJson(res, 409, { error: 'A model run is already in progress.' });
  }
  readBody(req).then((raw) => {
    let payload = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch (error) {
      payload = {};
    }
    const iter = Number.isFinite(payload.iter) ? Math.max(1, Math.round(payload.iter)) : 5000;
    const thin = Number.isFinite(payload.thin) ? Math.max(1, Math.round(payload.thin)) : 10;
    const nchains = 2;

    if (fs.existsSync(PROGRESS_PATH)) fs.rmSync(PROGRESS_PATH, { force: true });
    modelRunInProgress = true;

    const child = spawn('Rscript', [
      'util_code/model_code_1pulse.R',
      MODEL_DATA_DIR,
      OUTPUT_PATH,
      PROGRESS_PATH,
      String(iter),
      String(thin),
      String(nchains),
    ], { cwd: ROOT, detached: true, stdio: 'ignore' });
    child.unref();
    child.on('exit', () => { modelRunInProgress = false; });

    sendJson(res, 200, { started: true });
  }).catch((error) => {
    modelRunInProgress = false;
    sendJson(res, 400, { error: error.message });
  });
}

function handleProgress(req, res) {
  fs.readFile(PROGRESS_PATH, 'utf8', (err, content) => {
    if (err) return sendJson(res, 200, { phase: 'idle', completed: 0, total: 0, done: false, error: null });
    try {
      sendJson(res, 200, JSON.parse(content));
    } catch (error) {
      sendJson(res, 200, { phase: 'idle', completed: 0, total: 0, done: false, error: null });
    }
  });
}

function handleDownload(req, res) {
  fs.access(OUTPUT_PATH, fs.constants.R_OK, (err) => {
    if (err) { res.writeHead(404); res.end('No posterior samples file found. Run the model first.'); return; }
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${path.basename(OUTPUT_PATH)}"`,
    });
    fs.createReadStream(OUTPUT_PATH).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'POST' && pathname === '/api/prepare-data') return handlePrepareData(req, res);
  if (req.method === 'POST' && pathname === '/api/run-model') return handleRunModel(req, res);
  if (req.method === 'GET' && pathname === '/api/run-model/progress') return handleProgress(req, res);
  if (req.method === 'GET' && pathname === '/api/run-model/download') return handleDownload(req, res);
  if (req.method === 'GET') return serveStatic(req, res, pathname);
  res.writeHead(405);
  res.end('Method not allowed');
});

server.listen(PORT, () => {
  console.log(`EGC Decision Support running at http://localhost:${PORT}`);
});
