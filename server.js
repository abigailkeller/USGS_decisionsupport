const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
// chatbot for questions about results (see chat/chat.js for setup)
const chat = require('./chat/chat.js');

const ROOT = __dirname;
const STAGING_DIR = path.join(ROOT, 'data', 'staging');
const MODEL_DATA_DIR = path.join(ROOT, 'data', 'model_data');
const POSTERIOR_DIR = path.join(ROOT, 'data', 'posterior_samples');
const PROGRESS_PATH = path.join(POSTERIOR_DIR, 'progress.json');
const OUTPUT_PATH = path.join(POSTERIOR_DIR, 'twopulse.rds');
const ANALYZE_PROGRESS_PATH = path.join(POSTERIOR_DIR, 'analyze_progress.json');
const ANALYZE_OUTPUT_PATH = path.join(POSTERIOR_DIR, 'simulated_dynamics.json');
const SUMMARY_CSV_PATH = path.join(POSTERIOR_DIR, 'posterior_summary.csv');
// posterior summary READMEs, one per model version
const README_PATHS = {
  oneyear: path.join(ROOT, 'util_code', 'README_oneyear.txt'),
  multiyear: path.join(ROOT, 'util_code', 'README_multiyear.txt'),
  independent: path.join(ROOT, 'util_code', 'README_independentyears.txt'),
};
const OPTIMIZE_PROGRESS_PATH = path.join(POSTERIOR_DIR, 'optimize_progress.json');
const OPTIMIZE_OUTPUT_PATH = path.join(POSTERIOR_DIR, 'optimal_trap_schedule.json');
const OPTIMIZE_N_DRAW = 100;
// saved optimization scenarios, one JSON file each, for comparing settings
const SCENARIOS_DIR = path.join(POSTERIOR_DIR, 'scenarios');
// fresh posterior draws used to score the candidate schedules
const OPTIMIZE_N_DRAW_SCORE = 500;
const PORT = process.env.PORT || 8000;
// matches formatDateForExport() in script.js, which always writes dates in this shape
const EXPORT_DATE_FORMAT = '%m/%d/%Y';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.csv': 'text/csv',
  '.json': 'application/json',
};

let modelRunInProgress = false;
let analysisInProgress = false;
let optimizeInProgress = false;
// The running optimization child process, if any, so it can be stopped when
// its inputs (data or objective) change
let optimizeChild = null;
// The run-model child process, if it's still alive and waiting (after
// finishing its MCMC run) for an "ANALYZE" command on its stdin. Reusing it
// skips recompiling the model for the analyze-results step. Always null
// unless a run-model process is specifically parked waiting for reuse.
let modelChild = null;

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Calendar date (e.g. "Mar 1") for a Julian day, read as a non-leap year
function julianDayToDateLabel(jday) {
  const date = new Date(Date.UTC(2001, 0, jday));
  return `${MONTH_ABBR[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

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

// Only the page's own files are served: the page, its script and styles,
// and images in img/ and figures/. Everything else in the app folder -
// uploaded data and results in data/, R code, server code, node_modules -
// is never sent, so visitors can't download other people's data. Results
// reach the page only through the api/ routes.
const PUBLIC_FILES = new Set(['/index.html', '/script.js', '/styles.css']);
const PUBLIC_DIRS = ['/img/', '/figures/'];
const PUBLIC_IMAGE_TYPES = new Set(['.png', '.svg', '.jpg', '.jpeg', '.gif', '.webp', '.ico']);

function isPublicPath(relativePath) {
  if (PUBLIC_FILES.has(relativePath)) return true;
  return PUBLIC_DIRS.some((dir) => relativePath.startsWith(dir))
    && PUBLIC_IMAGE_TYPES.has(path.extname(relativePath).toLowerCase());
}

function serveStatic(req, res, pathname) {
  let relativePath;
  try {
    relativePath = path.posix.normalize(decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
  } catch (error) {
    relativePath = null; // malformed %-encoding
  }
  // not found (rather than forbidden), so the response doesn't reveal which
  // other files exist
  if (!relativePath || relativePath.includes('\0') || !isPublicPath(relativePath)) {
    res.writeHead(404); res.end('Not found'); return;
  }
  const filePath = path.join(ROOT, relativePath);
  if (!filePath.startsWith(ROOT + path.sep)) { res.writeHead(404); res.end('Not found'); return; }
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
    // 'auto' lets run_model.R pick by number of years (20,000 multi-year,
    // 5,000 single year)
    const iter = Number.isFinite(payload.iter) ? Math.max(1, Math.round(payload.iter)) : 'auto';
    const thin = Number.isFinite(payload.thin) ? Math.max(1, Math.round(payload.thin)) : 10;
    const nchains = 4;

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
        // create_posterior_summary.R prints which model version it summarized
        { name: 'README.txt', data: fs.readFileSync(README_PATHS[stdout.trim()] || README_PATHS.multiyear) },
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

// Stops any optimization run and discards its results, used when the data
// or the objective changes so an out-of-date schedule can't be downloaded
function handleReleaseOptimize(req, res) {
  const released = Boolean(optimizeChild);
  if (optimizeChild) {
    // detached, so it leads its own process group
    try { process.kill(-optimizeChild.pid); } catch (error) { optimizeChild.kill(); }
    optimizeChild = null;
  }
  optimizeInProgress = false;
  fs.rmSync(OPTIMIZE_OUTPUT_PATH, { force: true });
  fs.rmSync(OPTIMIZE_PROGRESS_PATH, { force: true });
  sendJson(res, 200, { released });
}

function handleOptimizeTraps(req, res) {
  if (optimizeInProgress) {
    return sendJson(res, 409, { error: 'An optimization run is already in progress.' });
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
    const budget = Number(payload.budget);
    const costFukui = Number(payload.costFukui);
    const costShrimp = Number(payload.costShrimp);
    const costMinnow = Number(payload.costMinnow);
    if (!Number.isFinite(budget) || budget < 1) {
      return sendJson(res, 400, { error: "Trapping effort must be at least 1 Fukui trap's worth." });
    }
    // effort per trap is a multiple of a Fukui trap's (the reference), so 1
    // is the floor for every type
    for (const [label, cost] of [['Fukui', costFukui], ['Shrimp', costShrimp], ['Minnow', costMinnow]]) {
      if (!Number.isFinite(cost) || cost < 1) {
        return sendJson(res, 400, { error: `${label} trap effort must be at least 1 (a Fukui trap's worth).` });
      }
    }
    // constraints: which trap types can be set (at least one), and the most
    // effort (Fukui traps' worth) at any one biweek, from budget / number of
    // biweeks up to the whole budget (no limit)
    const TRAP_TYPES = ['fukui', 'shrimp', 'minnow'];
    const allowedTypes = Array.isArray(payload.allowedTypes)
      ? TRAP_TYPES.filter((type) => payload.allowedTypes.includes(type))
      : TRAP_TYPES;
    if (!allowedTypes.length) {
      return sendJson(res, 400, { error: 'Choose at least one available trap type.' });
    }
    let maxPerBiweek = Number(payload.maxPerBiweek);
    if (!Number.isFinite(maxPerBiweek) || maxPerBiweek > budget) maxPerBiweek = budget;
    if (maxPerBiweek < 1) {
      return sendJson(res, 400, { error: "Maximum traps per biweek must be at least 1 Fukui trap's worth." });
    }

    if (fs.existsSync(OPTIMIZE_PROGRESS_PATH)) fs.rmSync(OPTIMIZE_PROGRESS_PATH, { force: true });
    optimizeInProgress = true;

    const child = spawn('Rscript', [
      'util_code/optimize_traps.R',
      MODEL_DATA_DIR,
      OUTPUT_PATH,
      OPTIMIZE_OUTPUT_PATH,
      OPTIMIZE_PROGRESS_PATH,
      String(budget),
      String(costFukui),
      String(costShrimp),
      String(costMinnow),
      String(OPTIMIZE_N_DRAW),
      String(OPTIMIZE_N_DRAW_SCORE),
      allowedTypes.join(','),
      String(maxPerBiweek),
    ], { cwd: ROOT, detached: true, stdio: 'ignore' });
    child.unref();
    optimizeChild = child;
    child.on('exit', () => {
      if (optimizeChild === child) {
        optimizeChild = null;
        optimizeInProgress = false;
      }
    });

    sendJson(res, 200, { started: true });
  }).catch((error) => {
    optimizeInProgress = false;
    sendJson(res, 400, { error: error.message });
  });
}

function handleOptimizeProgress(req, res) {
  fs.readFile(OPTIMIZE_PROGRESS_PATH, 'utf8', (err, content) => {
    if (err) return sendJson(res, 200, { phase: 'idle', completed: 0, total: 0, done: false, error: null });
    try {
      sendJson(res, 200, JSON.parse(content));
    } catch (error) {
      sendJson(res, 200, { phase: 'idle', completed: 0, total: 0, done: false, error: null });
    }
  });
}

// Builds the optimization download CSVs from the results JSON:
// optimization_summary.csv (the recommended schedule, one row per trapping
// occasion) and optimization_options.csv (every schedule from the
// multi-start search, scored on fresh posterior samples; null for results
// files from before the multi-start search)
function buildOptimizationCsvs(result) {
  const toCsv = (rows) => `${rows.map((row) => row.map(csvField).join(',')).join('\n')}\n`;
  const capitalize = (type) => type[0].toUpperCase() + type.slice(1);
  const trapTypes = Object.keys(result.schedule);

  const summaryRows = [
    ['Date', ...trapTypes.map(capitalize)],
    ...result.occasions.map((day, index) => [julianDayToDateLabel(day), ...trapTypes.map((type) => result.schedule[type][index])]),
  ];

  let optionsCsv = null;
  if (Array.isArray(result.options) && result.options.length) {
    const round = (value, digits) => Number(value).toFixed(digits);
    const describeSchedule = (schedule) => trapTypes
      .map((type) => {
        const placed = result.occasions
          .map((day, index) => [schedule[type][index], day])
          .filter(([count]) => count > 0)
          .map(([count, day]) => `${count} on ${julianDayToDateLabel(day)}`);
        return placed.length ? `${capitalize(type)}: ${placed.join(', ')}` : null;
      })
      .filter(Boolean)
      .join('; ');
    const optionRows = [
      ['Option', 'Recommended', 'Traps per search step', 'Total effort (Fukui traps worth)',
        'Expected abundance at start of next season', 'Abundance 95% CrI lower', 'Abundance 95% CrI upper',
        'Reduction vs no trapping (%)', 'Difference from best (crabs)', 'Difference 95% lower', 'Difference 95% upper',
        'Within 1% of best', 'Schedule'],
      ...result.options.map((option, index) => [
        index + 1,
        index === 0 ? 'yes' : 'no',
        [].concat(option.search_steps).join(' / '),
        option.total_cost,
        round(option.expected_abundance, 1),
        round(option.abundance_95[0], 1),
        round(option.abundance_95[1], 1),
        round(100 * option.reduction_vs_no_trapping, 1),
        round(option.difference_from_best, 2),
        round(option.difference_from_best_95[0], 1),
        round(option.difference_from_best_95[1], 1),
        option.within_1pct_of_best ? 'yes' : 'no',
        describeSchedule(option.schedule),
      ]),
    ];
    if (result.no_trapping) {
      optionRows.push(['No trapping', 'no', '', 0,
        round(result.no_trapping.expected_abundance, 1),
        round(result.no_trapping.abundance_95[0], 1),
        round(result.no_trapping.abundance_95[1], 1),
        '', '', '', '', '', 'No traps']);
    }
    // with a single schedule there is nothing to compare it against, so the
    // columns comparing options with the best one are left out
    if (result.options.length === 1) {
      const dropped = new Set(['Recommended', 'Difference from best (crabs)', 'Difference 95% lower',
        'Difference 95% upper', 'Within 1% of best']);
      const keep = optionRows[0].map((name, index) => (dropped.has(name) ? -1 : index)).filter((index) => index >= 0);
      optionRows.forEach((row, rowIndex) => { optionRows[rowIndex] = keep.map((index) => row[index]); });
    }
    optionsCsv = toCsv(optionRows);
  }

  return { summaryCsv: toCsv(summaryRows), optionsCsv };
}

function readOptimizationResult(res, callback) {
  fs.readFile(OPTIMIZE_OUTPUT_PATH, 'utf8', (err, content) => {
    if (err) { res.writeHead(404); res.end('No optimization results found. Run the optimization first.'); return; }
    let result;
    try {
      result = JSON.parse(content);
    } catch (error) {
      res.writeHead(500); res.end('The optimization results file is corrupted.'); return;
    }
    callback(result);
  });
}

// "Download optimization summary": the recommended schedule and its README
function handleOptimizeDownload(req, res) {
  readOptimizationResult(res, (result) => {
    const { summaryCsv, optionsCsv } = buildOptimizationCsvs(result);
    // with a single option there is no alternatives pop-up to download the
    // options from, so they are included here (a README covers both files)
    const single = Boolean(optionsCsv) && result.options.length === 1;
    const files = [{ name: 'optimization_summary.csv', data: Buffer.from(summaryCsv) }];
    if (single) files.push({ name: 'optimization_options.csv', data: Buffer.from(optionsCsv) });
    files.push({ name: 'README.txt', data: Buffer.from(optimizationSummaryReadme(result, single)) });
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="optimization_summary.zip"',
    });
    res.end(buildZip(files));
  });
}

// "Download trap schedule options" (in the near-optimal alternatives pop-up):
// every schedule from the multi-start search and its README
function handleOptimizeOptionsDownload(req, res) {
  readOptimizationResult(res, (result) => {
    const { optionsCsv } = buildOptimizationCsvs(result);
    if (!optionsCsv) { res.writeHead(404); res.end('These optimization results have no alternative schedules.'); return; }
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="optimization_options.zip"',
    });
    res.end(buildZip([
      { name: 'optimization_options.csv', data: Buffer.from(optionsCsv) },
      { name: 'README.txt', data: Buffer.from(optimizationOptionsReadme(result)) },
    ]));
  });
}

// what the results page needs to lay itself out (e.g. whether to offer the
// near-optimal alternatives)
function handleOptimizeResult(req, res) {
  readOptimizationResult(res, (result) => {
    // traps of each type in the recommended schedule, and the effort they
    // use in Fukui traps' worth, for the results page's summary sentence
    const traps = {};
    let effortUsed = 0;
    for (const [type, counts] of Object.entries(result.schedule)) {
      traps[type] = counts.reduce((sum, count) => sum + Number(count), 0);
      effortUsed += traps[type] * Number(result.cost[type]);
    }
    sendJson(res, 200, {
      budget: result.budget,
      nOptions: Array.isArray(result.options) ? result.options.length : 1,
      traps,
      effortUsed,
      // settings, for the suggested scenario name
      allowedTypes: Array.isArray(result.allowed_types) ? result.allowed_types : Object.keys(result.cost),
      maxPerBiweek: Number.isFinite(result.max_per_biweek) ? result.max_per_biweek : result.budget,
      // the scenario these results are already saved as, if any
      savedAs: savedScenarioName(),
      // for the charts drawn in the browser: trapping dates, and each
      // option's schedule and expected abundance (option 1 = optimal)
      occasions: result.occasions.map(julianDayToDateLabel),
      options: (Array.isArray(result.options) && result.options.length
        ? result.options
        : [{ schedule: result.schedule, expected_abundance: result.objective_value, abundance_95: null, reduction_vs_no_trapping: null }])
        .map((option) => ({
          schedule: option.schedule,
          expectedAbundance: option.expected_abundance,
          abundance95: option.abundance_95 || null,
          reduction: Number.isFinite(option.reduction_vs_no_trapping) ? option.reduction_vs_no_trapping : null,
        })),
      noTrapping: result.no_trapping
        ? { expectedAbundance: result.no_trapping.expected_abundance, abundance95: result.no_trapping.abundance_95 || null }
        : null,
    });
  });
}

// README section describing optimization_summary.csv
const SUMMARY_CSV_SECTION = `optimization_summary.csv
-------------------------
One row per trapping occasion:

  Date          the trapping occasion (day of year shown as a calendar date)
  Fukui, Minnow, Shrimp
                number of traps of that type to set on that date (one
                column per trap type)

The schedule's total effort (traps of each type multiplied by that type's
effort per trap, in Fukui traps' worth) is within your trapping effort.
`;

// README section describing optimization_options.csv when the search found
// a single schedule (no columns comparing options)
const OPTIONS_CSV_SECTION_SINGLE = (result) => `optimization_options.csv
-------------------------
The optimal schedule (option 1) and no trapping, for reference. The search
was run several times with different step sizes (the number of traps added
at a time), using ${result.n_draw} posterior samples, and every search ended at the
same schedule. That schedule and no trapping were then scored on ${result.n_draw_score}
fresh posterior samples (new parameter draws, recruitment, catch randomness
and winter severity).

  Option                       option number (1 = best)
  Traps per search step        step size(s) of the search(es) that found it
  Total effort (Fukui traps worth)
                               effort the schedule uses: traps of each type
                               multiplied by that type's effort per trap
  Expected abundance at start of next season
                               mean over the fresh posterior samples
  Abundance 95% CrI lower/upper
                               95% credible interval of that abundance;
                               mostly reflects uncertainty about next year's
                               recruitment and winter, which affects every
                               schedule alike
  Reduction vs no trapping (%) expected abundance compared with no trapping
  Schedule                     traps of each type and the dates they are set
`;

// wraps a README paragraph to `width` characters
function wrapText(text, width = 76) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && line.length + 1 + word.length > width) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

function describeBudget(result) {
  const efforts = Object.entries(result.cost).filter(([type]) => type !== 'fukui')
    .map(([type, value]) => `${type} ${value}`).join(', ');
  let text = `a trapping effort of ${result.budget} Fukui traps' worth (effort per trap compared with a Fukui trap: ${efforts})`;
  // constraints, for results that have them (older results files don't)
  if (Array.isArray(result.allowed_types)) {
    text += `, with ${result.allowed_types.length === Object.keys(result.cost).length
      ? 'all trap types available'
      : `only ${result.allowed_types.join(' and ')} traps available`}`;
  }
  if (Number.isFinite(result.max_per_biweek)) {
    text += result.max_per_biweek >= result.budget
      ? ' and no limit on traps per biweek'
      : ` and at most ${result.max_per_biweek} Fukui traps' worth of traps in any one biweek`;
  }
  return text;
}

// README bundled with "Download optimization summary". With a single
// option (`withOptions`) the download also includes optimization_options.csv,
// so the README describes both files.
function optimizationSummaryReadme(result, withOptions = false) {
  if (withOptions) {
    return `OPTIMIZATION SUMMARY — README
==============================

${wrapText(`This download contains the optimal trap schedule found by the optimization for ${describeBudget(result)}, and how it compares with no trapping.`)}

The optimization minimizes the expected abundance of crabs at the start of
the next trapping season, after overwinter mortality, using your fitted
population model.

${SUMMARY_CSV_SECTION}
${OPTIONS_CSV_SECTION_SINGLE(result)}`;
  }
  return `OPTIMIZATION SUMMARY — README
==============================

${wrapText(`This download contains the recommended (optimal) trap schedule found by the optimization for ${describeBudget(result)}.`)}

The optimization minimizes the expected abundance of crabs at the start of
the next trapping season, after overwinter mortality, using your fitted
population model.

optimization_summary.csv
-------------------------
One row per trapping occasion:

  Date          the trapping occasion (day of year shown as a calendar date)
  Fukui, Minnow, Shrimp
                number of traps of that type to set on that date (one
                column per trap type)

The schedule's total effort (traps of each type multiplied by that type's
effort per trap, in Fukui traps' worth) is within your trapping effort.

The objective is often flat, meaning that other trap schedules can produce
very similar outcomes. Near-optimal alternatives can be explored and
downloaded in the app with "Explore other near-optimal alternatives".
`;
}

// README bundled with "Download trap schedule options"; the column list
// differs when the search found only one schedule (no comparison columns)
function optimizationOptionsReadme(result) {
  const single = Array.isArray(result.options) && result.options.length === 1;
  const intro = single
    ? `${wrapText(`This download contains the trap schedule found by the optimization for ${describeBudget(result)}, compared with no trapping.`)}

The optimization minimizes the expected abundance of crabs at the start of
the next trapping season, after overwinter mortality.

How the schedule was found: the search was run several times with different
step sizes (the number of traps added at a time), using ${result.n_draw}
posterior samples. Every search ended at the same schedule. That schedule,
and no trapping for reference, was then scored on ${result.n_draw_score} fresh posterior
samples (new parameter draws, recruitment, catch randomness and winter
severity).`
    : `${wrapText(`This download contains near-optimal trap schedules found by the optimization for ${describeBudget(result)}.`)}

The optimization minimizes the expected abundance of crabs at the start of
the next trapping season, after overwinter mortality. The objective is often
flat, meaning that multiple trap schedules can produce very similar outcomes.

How the options were found: the search was run several times with different
step sizes (the number of traps added at a time), using ${result.n_draw}
posterior samples. Different searches can end at different but similarly
good schedules. Every distinct schedule found, and no trapping for
reference, was then scored on ${result.n_draw_score} fresh posterior samples (new
parameter draws, recruitment, catch randomness and winter severity), so the
options are compared fairly. Options are sorted best first; option 1 is the
recommended schedule.`;

  const columns = single
    ? `  Option                       option number (1 = best)
  Traps per search step        step size(s) of the search(es) that found it
  Total effort (Fukui traps worth)
                               effort the schedule uses: traps of each type
                               multiplied by that type's effort per trap
  Expected abundance at start of next season
                               mean over the fresh posterior samples
  Abundance 95% CrI lower/upper
                               95% credible interval of that abundance;
                               mostly reflects uncertainty about next year's
                               recruitment and winter, which affects every
                               schedule alike
  Reduction vs no trapping (%) expected abundance compared with no trapping
  Schedule                     traps of each type and the dates they are set
`
    : `  Option                       option number (1 = best)
  Recommended                  whether this is the recommended schedule
  Traps per search step        step size(s) of the search(es) that found it
  Total effort (Fukui traps worth)
                               effort the schedule uses: traps of each type
                               multiplied by that type's effort per trap
  Expected abundance at start of next season
                               mean over the fresh posterior samples
  Abundance 95% CrI lower/upper
                               95% credible interval of that abundance;
                               mostly reflects uncertainty about next year's
                               recruitment and winter, which affects every
                               schedule alike
  Reduction vs no trapping (%) expected abundance compared with no trapping
  Difference from best (crabs) how many more crabs this schedule leaves than
                               the best one, compared within each posterior
                               sample (paired) and averaged
  Difference 95% lower/upper   middle 95% of those per-sample differences; an
                               interval that includes 0 means the option is
                               not reliably worse than the best
  Within 1% of best            whether the expected abundance is within 1% of
                               the best option's
  Schedule                     traps of each type and the dates they are set

Options with differences close to zero are effectively equivalent; choosing
among them can be based on practical considerations such as staffing or trap
availability.
`;

  return `TRAP SCHEDULE OPTIONS — README
===============================

${intro}

optimization_options.csv
-------------------------
One row per option, plus a final "No trapping" row for reference:

${columns}`;
}

// ---- Saved scenarios ----
// Each completed optimization can be saved as a scenario (a copy of its
// results plus a name), so runs with different effort and constraints can be
// compared. A scenario records the fitted model it came from (the posterior
// file's modification time): results from different fits aren't comparable,
// so scenarios from any other fit are discarded when scenarios are listed.
function posteriorStamp() {
  try { return fs.statSync(OUTPUT_PATH).mtimeMs; } catch (error) { return null; }
}

function readScenarios() {
  if (!fs.existsSync(SCENARIOS_DIR)) return [];
  const stamp = posteriorStamp();
  const scenarios = [];
  for (const file of fs.readdirSync(SCENARIOS_DIR).filter((name) => name.endsWith('.json'))) {
    const filePath = path.join(SCENARIOS_DIR, file);
    let scenario;
    try { scenario = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (error) { scenario = null; }
    if (!scenario || stamp === null || scenario.posteriorStamp !== stamp) {
      fs.rmSync(filePath, { force: true });
      continue;
    }
    scenarios.push(scenario);
  }
  return scenarios.sort((a, b) => a.savedAt - b.savedAt);
}

// name of the saved scenario holding the current optimization results
function savedScenarioName() {
  try {
    const stamp = fs.statSync(OPTIMIZE_OUTPUT_PATH).mtimeMs;
    const match = readScenarios().find((scenario) => scenario.resultStamp === stamp);
    return match ? match.name : null;
  } catch (error) { return null; }
}

// what the comparison table and chart need from a scenario
function summarizeScenario(scenario) {
  const result = scenario.result;
  const best = Array.isArray(result.options) && result.options.length ? result.options[0] : null;
  const traps = {};
  let effortUsed = 0;
  for (const [type, counts] of Object.entries(result.schedule)) {
    traps[type] = counts.reduce((sum, count) => sum + Number(count), 0);
    effortUsed += traps[type] * Number(result.cost[type]);
  }
  return {
    id: scenario.id,
    name: scenario.name,
    budget: result.budget,
    cost: result.cost,
    allowedTypes: Array.isArray(result.allowed_types) ? result.allowed_types : Object.keys(result.cost),
    maxPerBiweek: Number.isFinite(result.max_per_biweek) ? result.max_per_biweek : result.budget,
    traps,
    effortUsed,
    occasions: result.occasions.map(julianDayToDateLabel),
    schedule: result.schedule,
    expectedAbundance: best ? best.expected_abundance : result.objective_value,
    abundance95: best ? best.abundance_95 : null,
    reduction: best ? best.reduction_vs_no_trapping : null,
    prevented: best && Number.isFinite(best.prevented_vs_no_trapping) ? best.prevented_vs_no_trapping : null,
    prevented95: best && Array.isArray(best.prevented_vs_no_trapping_95) ? best.prevented_vs_no_trapping_95 : null,
    noTrapping: result.no_trapping || null,
  };
}

function handleListScenarios(req, res) {
  sendJson(res, 200, { scenarios: readScenarios().map(summarizeScenario) });
}

// saves the current optimization results as a scenario
function handleSaveScenario(req, res) {
  readBody(req).then((raw) => {
    let payload = {};
    try { payload = raw ? JSON.parse(raw) : {}; } catch (error) { payload = {}; }
    if (!fs.existsSync(OPTIMIZE_OUTPUT_PATH)) {
      return sendJson(res, 404, { error: 'No optimization results to save. Run the optimization first.' });
    }
    const stamp = posteriorStamp();
    if (stamp === null) return sendJson(res, 400, { error: 'Run the population model first.' });
    let result;
    try { result = JSON.parse(fs.readFileSync(OPTIMIZE_OUTPUT_PATH, 'utf8')); } catch (error) {
      return sendJson(res, 500, { error: 'The optimization results file is corrupted.' });
    }
    const resultStamp = fs.statSync(OPTIMIZE_OUTPUT_PATH).mtimeMs;
    const existing = readScenarios();
    // the same run saved twice would just duplicate a row
    const duplicate = existing.find((scenario) => scenario.resultStamp === resultStamp);
    if (duplicate) return sendJson(res, 409, { error: `These results are already saved as "${duplicate.name}".` });
    const name = String(payload.name || '').trim().slice(0, 80) || `Scenario ${existing.length + 1}`;
    const id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const scenario = { id, name, savedAt: Date.now(), posteriorStamp: stamp, resultStamp, result };
    fs.mkdirSync(SCENARIOS_DIR, { recursive: true });
    fs.writeFileSync(path.join(SCENARIOS_DIR, `${id}.json`), JSON.stringify(scenario));
    sendJson(res, 200, { scenario: summarizeScenario(scenario) });
  });
}

function handleDeleteScenario(req, res, id) {
  if (!/^s[a-z0-9]+$/.test(id)) return sendJson(res, 400, { error: 'Unknown scenario.' });
  fs.rmSync(path.join(SCENARIOS_DIR, `${id}.json`), { force: true });
  sendJson(res, 200, { deleted: id });
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
  if (req.method === 'POST' && pathname === '/api/optimize-traps') return handleOptimizeTraps(req, res);
  if (req.method === 'POST' && pathname === '/api/optimize-traps/release') return handleReleaseOptimize(req, res);
  if (req.method === 'GET' && pathname === '/api/optimize-traps/progress') return handleOptimizeProgress(req, res);
  if (req.method === 'GET' && pathname === '/api/optimize-traps/download') return handleOptimizeDownload(req, res);
  if (req.method === 'GET' && pathname === '/api/optimize-traps/result') return handleOptimizeResult(req, res);
  if (req.method === 'GET' && pathname === '/api/optimize-traps/options/download') return handleOptimizeOptionsDownload(req, res);
  if (req.method === 'POST' && pathname === '/api/chat') return chat.handleChat(req, res);
  if (req.method === 'GET' && pathname === '/api/chat/config') return chat.handleChatConfig(req, res);
  if (req.method === 'GET' && pathname === '/api/chat/context') return chat.handleChatContext(req, res);
  if (req.method === 'GET' && pathname === '/api/scenarios') return handleListScenarios(req, res);
  if (req.method === 'POST' && pathname === '/api/scenarios') return handleSaveScenario(req, res);
  if (req.method === 'DELETE' && pathname.startsWith('/api/scenarios/')) return handleDeleteScenario(req, res, pathname.slice('/api/scenarios/'.length));
  if (req.method === 'GET') return serveStatic(req, res, pathname);
  res.writeHead(405);
  res.end('Method not allowed');
});

// A run that was in progress when the server stopped (for example, a
// restart after running out of memory) can't finish: its R process is gone,
// but its progress file still says it's running, so the page would wait for
// it forever. Mark such runs as failed when the server starts.
function markInterruptedRuns() {
  for (const progressPath of [PROGRESS_PATH, ANALYZE_PROGRESS_PATH, OPTIMIZE_PROGRESS_PATH]) {
    let progress;
    try { progress = JSON.parse(fs.readFileSync(progressPath, 'utf8')); } catch (error) { continue; }
    if (!progress || progress.done) continue;
    fs.writeFileSync(progressPath, JSON.stringify({
      ...progress,
      done: true,
      error: 'This run was interrupted because the server restarted (for example, after running out of memory). Please run it again.',
      updatedAt: new Date().toISOString(),
    }));
  }
}
markInterruptedRuns();

server.listen(PORT, () => {
  console.log(`EGC Decision Support running at http://localhost:${PORT}`);
});
