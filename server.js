const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const ROOT = __dirname;
const STAGING_DIR = path.join(ROOT, 'data', 'staging');
const MODEL_DATA_DIR = path.join(ROOT, 'data', 'model_data');
const POSTERIOR_DIR = path.join(ROOT, 'data', 'posterior_samples');
const PROGRESS_PATH = path.join(POSTERIOR_DIR, 'progress.json');
const OUTPUT_PATH = path.join(POSTERIOR_DIR, 'twopulse.rds');
const ANALYZE_PROGRESS_PATH = path.join(POSTERIOR_DIR, 'analyze_progress.json');
const ANALYZE_OUTPUT_PATH = path.join(POSTERIOR_DIR, 'simulated_dynamics.json');
const SUMMARY_CSV_PATH = path.join(POSTERIOR_DIR, 'posterior_summary.csv');
const README_PATH = path.join(ROOT, 'util_code', 'README.txt');
const PORT = process.env.PORT || 8000;
// matches formatDateForExport() in script.js, which always writes dates in this shape
const EXPORT_DATE_FORMAT = '%m/%d/%Y';

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
let analysisInProgress = false;
// The run-model child process, if it's still alive and waiting (after
// finishing its MCMC run) for an "ANALYZE" command on its stdin. Reusing it
// skips recompiling the model for the analyze-results step. Always null
// unless a run-model process is specifically parked waiting for reuse.
let modelChild = null;

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

    execFile('Rscript', ['util_code/prep_model_data.R', catchPath, effortPath, MODEL_DATA_DIR, EXPORT_DATE_FORMAT, EXPORT_DATE_FORMAT], { cwd: ROOT, maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
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

    // a prior run's process may still be parked waiting for an ANALYZE
    // command that never came; starting a new run supersedes it
    if (modelChild) { modelChild.kill(); modelChild = null; }

    if (fs.existsSync(PROGRESS_PATH)) fs.rmSync(PROGRESS_PATH, { force: true });
    modelRunInProgress = true;

    const child = spawn('Rscript', [
      'util_code/run_model.R',
      MODEL_DATA_DIR,
      OUTPUT_PATH,
      PROGRESS_PATH,
      String(iter),
      String(thin),
      String(nchains),
    ], { cwd: ROOT, stdio: ['pipe', 'ignore', 'ignore'] });
    child.stdin.on('error', () => {}); // ignore EPIPE if it exits before we write to it
    modelChild = child;
    child.on('exit', () => {
      modelRunInProgress = false;
      if (modelChild === child) modelChild = null;
    });

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

// ---- minimal ZIP writer (STORE method, no compression) ----
// Used to bundle the posterior summary CSV with the README into a single
// download without adding an npm dependency for it.
const CRC_TABLE = (() => {
  const table = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function buildZip(files) {
  const now = new Date();
  const dosTime = ((now.getHours() & 0x1F) << 11) | ((now.getMinutes() & 0x3F) << 5) | (Math.floor(now.getSeconds() / 2) & 0x1F);
  const dosDate = (((now.getFullYear() - 1980) & 0x7F) << 9) | (((now.getMonth() + 1) & 0xF) << 5) | (now.getDate() & 0x1F);

  const localParts = [];
  const centralParts = [];
  let offset = 0;

  files.forEach(({ name, data }) => {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuf, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + data.length;
  });

  const centralDir = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, end]);
}

function handlePosteriorSummaryDownload(req, res) {
  if (!fs.existsSync(OUTPUT_PATH)) {
    res.writeHead(400);
    res.end('No posterior samples found. Run the population model first.');
    return;
  }
  execFile('Rscript', ['util_code/create_posterior_summary.R', OUTPUT_PATH, SUMMARY_CSV_PATH], { cwd: ROOT, maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) {
      res.writeHead(500);
      res.end(`Could not create the posterior summary.\n${stderr || stdout || error.message}`);
      return;
    }
    try {
      const files = [
        { name: 'posterior_summary.csv', data: fs.readFileSync(SUMMARY_CSV_PATH) },
        { name: 'README.txt', data: fs.readFileSync(README_PATH) },
      ];
      const zipBuffer = buildZip(files);
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="posterior_summary.zip"',
      });
      res.end(zipBuffer);
    } catch (zipError) {
      res.writeHead(500);
      res.end(`Could not bundle the posterior summary download.\n${zipError.message}`);
    }
  });
}

function canReuseCompiledModel() {
  if (!modelChild) return false;
  try {
    const progress = JSON.parse(fs.readFileSync(PROGRESS_PATH, 'utf8'));
    return progress.phase === 'done' && !progress.error;
  } catch (error) {
    return false;
  }
}

function handleAnalyzeResults(req, res) {
  if (analysisInProgress) {
    return sendJson(res, 409, { error: 'An analysis run is already in progress.' });
  }
  if (!fs.existsSync(OUTPUT_PATH)) {
    return sendJson(res, 400, { error: 'No posterior samples found. Run the population model first.' });
  }
  readBody(req).then((raw) => {
    let payload = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch (error) {
      payload = {};
    }
    const nDraw = Number.isFinite(payload.nDraw) ? Math.max(1, Math.round(payload.nDraw)) : 200;

    if (fs.existsSync(ANALYZE_PROGRESS_PATH)) fs.rmSync(ANALYZE_PROGRESS_PATH, { force: true });
    analysisInProgress = true;

    if (canReuseCompiledModel()) {
      // Hand this one request to the still-running run-model process, which
      // already has a compiled model sitting in memory -- skips recompiling
      // entirely. It exits on its own once this request is fulfilled.
      const reusedChild = modelChild;
      modelChild = null;
      reusedChild.on('exit', () => { analysisInProgress = false; });
      reusedChild.stdin.write(`ANALYZE\t${OUTPUT_PATH}\t${ANALYZE_OUTPUT_PATH}\t${ANALYZE_PROGRESS_PATH}\t${nDraw}\n`);
      return sendJson(res, 200, { started: true, reused: true });
    }

    const child = spawn('Rscript', [
      'util_code/simulate_dynamics.R',
      MODEL_DATA_DIR,
      OUTPUT_PATH,
      ANALYZE_OUTPUT_PATH,
      ANALYZE_PROGRESS_PATH,
      String(nDraw),
    ], { cwd: ROOT, detached: true, stdio: 'ignore' });
    child.unref();
    child.on('exit', () => { analysisInProgress = false; });

    sendJson(res, 200, { started: true, reused: false });
  }).catch((error) => {
    analysisInProgress = false;
    sendJson(res, 400, { error: error.message });
  });
}

function handleAnalyzeProgress(req, res) {
  fs.readFile(ANALYZE_PROGRESS_PATH, 'utf8', (err, content) => {
    if (err) return sendJson(res, 200, { phase: 'idle', completed: 0, total: 0, done: false, error: null });
    try {
      sendJson(res, 200, JSON.parse(content));
    } catch (error) {
      sendJson(res, 200, { phase: 'idle', completed: 0, total: 0, done: false, error: null });
    }
  });
}

function handleAnalyzeData(req, res) {
  fs.readFile(ANALYZE_OUTPUT_PATH, 'utf8', (err, content) => {
    if (err) { res.writeHead(404); res.end('No analysis results found. Run the analysis first.'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(content);
  });
}

function handleReleaseModel(req, res) {
  const released = Boolean(modelChild);
  if (modelChild) { modelChild.kill(); modelChild = null; }
  sendJson(res, 200, { released });
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'POST' && pathname === '/api/prepare-data') return handlePrepareData(req, res);
  if (req.method === 'POST' && pathname === '/api/run-model') return handleRunModel(req, res);
  if (req.method === 'GET' && pathname === '/api/run-model/progress') return handleProgress(req, res);
  if (req.method === 'GET' && pathname === '/api/run-model/download') return handleDownload(req, res);
  if (req.method === 'GET' && pathname === '/api/posterior-summary/download') return handlePosteriorSummaryDownload(req, res);
  if (req.method === 'POST' && pathname === '/api/run-model/release') return handleReleaseModel(req, res);
  if (req.method === 'POST' && pathname === '/api/analyze-results') return handleAnalyzeResults(req, res);
  if (req.method === 'GET' && pathname === '/api/analyze-results/progress') return handleAnalyzeProgress(req, res);
  if (req.method === 'GET' && pathname === '/api/analyze-results/data') return handleAnalyzeData(req, res);
  if (req.method === 'GET') return serveStatic(req, res, pathname);
  res.writeHead(405);
  res.end('Method not allowed');
});

server.listen(PORT, () => {
  console.log(`EGC Decision Support running at http://localhost:${PORT}`);
});
