const http = require('http');
const fs = require('fs');
const path = require('path');
// chatbot for questions about results (see chat/chat.js for setup)
const chat = require('./chat/chat.js');
// each user's model fits, analyses and optimizations run as private jobs
const jobsLib = require('./jobs.js');

const { JobError } = jobsLib;
const ROOT = __dirname;
// posterior summary READMEs, one per model version
const README_PATHS = {
  oneyear: path.join(ROOT, 'util_code', 'README_oneyear.txt'),
  multiyear: path.join(ROOT, 'util_code', 'README_multiyear.txt'),
  independent: path.join(ROOT, 'util_code', 'README_independentyears.txt'),
};
const OPTIMIZE_N_DRAW = 100;
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

// ---- jobs: model fit, analysis and optimization ----
// The browser sends everything a step needs and collects the outputs when
// the job is done (see jobs.js); nothing is kept on the server between
// steps, so users can't see or overwrite each other's data.

// fit: catch/effort rows -> model inputs, posterior samples and posterior
// summary
function startFitJob(payload) {
  const { catchRows, effortRows } = payload;
  if (!Array.isArray(catchRows) || !catchRows.length || !Array.isArray(effortRows) || !effortRows.length) {
    throw new JobError('Both catchRows and effortRows are required and must be non-empty.');
  }
  // 'auto' lets run_model.R pick by number of years (20,000 multi-year,
  // 5,000 single year)
  const iter = Number.isFinite(payload.iter) ? Math.max(1, Math.round(payload.iter)) : 'auto';
  const thin = Number.isFinite(payload.thin) ? Math.max(1, Math.round(payload.thin)) : 10;
  const nchains = 4;

  return jobsLib.createJob('fit', async (job) => {
    const catchPath = path.join(job.dir, 'catch.csv');
    const effortPath = path.join(job.dir, 'effort.csv');
    writeCsv(catchPath, ['Date', 'Trap_Type', 'Trap_Number', 'Size_mm'], catchRows);
    writeCsv(effortPath, ['Date', 'Trap_Type', 'Trap_Number'], effortRows);

    const modelDataDir = path.join(job.dir, 'model_data');
    job.progress = { phase: 'preparing', message: 'Building model inputs from your catch and effort data...' };
    try {
      await jobsLib.runR(job, ['util_code/prep_model_data.R', catchPath, effortPath, modelDataDir, EXPORT_DATE_FORMAT, EXPORT_DATE_FORMAT]);
    } catch (error) {
      throw new JobError(`Data preparation failed. ${error.message}`);
    }

    const posteriorPath = path.join(job.dir, 'twopulse.rds');
    const progressPath = path.join(job.dir, 'progress.json');
    const child = await jobsLib.runFitProcess(job,
      ['util_code/run_model.R', modelDataDir, posteriorPath, progressPath, String(iter), String(thin), String(nchains)],
      progressPath);
    // the process stays alive with its compiled model so "Analyze results"
    // can reuse it (see jobs.js for when it's released)
    if (child.exitCode === null) {
      jobsLib.parked.set(job.id, { child, parkedAt: Date.now() });
      child.on('exit', () => {
        if (jobsLib.parked.get(job.id)?.child === child) jobsLib.parked.delete(job.id);
      });
    }

    job.progress = { ...job.progress, phase: 'saving', message: 'Summarizing the posterior samples...' };
    const summaryCsvPath = path.join(job.dir, 'posterior_summary.csv');
    // prints which model version it summarized, to pick the README
    const modelType = (await jobsLib.runR(job, ['util_code/create_posterior_summary.R', posteriorPath, summaryCsvPath])).trim();
    const summaryCsv = fs.readFileSync(summaryCsvPath, 'utf8');
    const summaryZip = buildZip([
      { name: 'posterior_summary.csv', data: Buffer.from(summaryCsv) },
      { name: 'README.txt', data: fs.readFileSync(README_PATHS[modelType] || README_PATHS.multiyear) },
    ]);
    return {
      fitId: job.id,
      modelType,
      modelData: jobsLib.readFilesBase64(modelDataDir),
      posterior: fs.readFileSync(posteriorPath).toString('base64'),
      posteriorSummaryCsv: summaryCsv,
      posteriorSummaryZip: summaryZip.toString('base64'),
    };
  });
}

// writes the model inputs and posterior sent by the browser into a job
function writeFitInputs(job, payload) {
  const modelDataDir = path.join(job.dir, 'model_data');
  jobsLib.writeFiles(modelDataDir, payload.modelData);
  const posteriorPath = path.join(job.dir, 'twopulse.rds');
  fs.writeFileSync(posteriorPath, Buffer.from(payload.posterior, 'base64'));
  return { modelDataDir, posteriorPath };
}

function requireFitInputs(payload) {
  if (!payload.modelData || typeof payload.modelData !== 'object' || !Object.keys(payload.modelData).length) {
    throw new JobError('Missing model inputs. Run the population model again.');
  }
  jobsLib.requireBase64(payload.posterior, 'posterior samples');
}

// analyze: model inputs + posterior -> simulated dynamics. Reuses the fit's
// still-running process (and its compiled model) when it's available.
function startAnalyzeJob(payload) {
  requireFitInputs(payload);
  const nDraw = Number.isFinite(payload.nDraw) ? Math.max(1, Math.round(payload.nDraw)) : 200;
  const reuseFitId = typeof payload.fitId === 'string' && jobsLib.parked.has(payload.fitId) ? payload.fitId : null;

  return jobsLib.createJob('analyze', async (job) => {
    const { modelDataDir, posteriorPath } = writeFitInputs(job, payload);
    const outputPath = path.join(job.dir, 'simulated_dynamics.json');
    const progressPath = path.join(job.dir, 'analyze_progress.json');
    const entry = reuseFitId && jobsLib.parked.get(reuseFitId);
    if (entry && entry.child.exitCode === null) {
      jobsLib.parked.delete(reuseFitId);
      job.progress = { phase: 'preparing', message: 'Reusing the already-compiled model from the population model run.' };
      await jobsLib.runReusedAnalysis(job, entry.child,
        `ANALYZE\t${posteriorPath}\t${outputPath}\t${progressPath}\t${nDraw}\n`, progressPath);
    } else {
      job.progress = { phase: 'compiling', message: 'Building and compiling the model. This can take a minute.' };
      await jobsLib.runR(job, ['util_code/simulate_dynamics.R', modelDataDir, posteriorPath, outputPath, progressPath, String(nDraw)], { progressPath });
    }
    return { analysis: JSON.parse(fs.readFileSync(outputPath, 'utf8')) };
  }, { reuseFitId });
}

// optimization settings from the browser, checked
function parseOptimizeSettings(payload) {
  const budget = Number(payload.budget);
  const costFukui = Number(payload.costFukui);
  const costShrimp = Number(payload.costShrimp);
  const costMinnow = Number(payload.costMinnow);
  if (!Number.isFinite(budget) || budget < 1) {
    throw new JobError("Trapping effort must be at least 1 Fukui trap's worth.");
  }
  // effort per trap is a multiple of a Fukui trap's (the reference), so 1
  // is the floor for every type
  for (const [label, cost] of [['Fukui', costFukui], ['Shrimp', costShrimp], ['Minnow', costMinnow]]) {
    if (!Number.isFinite(cost) || cost < 1) {
      throw new JobError(`${label} trap effort must be at least 1 (a Fukui trap's worth).`);
    }
  }
  // constraints: which trap types can be set (at least one), and the most
  // effort (Fukui traps' worth) at any one biweek, from budget / number of
  // biweeks up to the whole budget (no limit)
  const TRAP_TYPES = ['fukui', 'shrimp', 'minnow'];
  const allowedTypes = Array.isArray(payload.allowedTypes)
    ? TRAP_TYPES.filter((type) => payload.allowedTypes.includes(type))
    : TRAP_TYPES;
  if (!allowedTypes.length) throw new JobError('Choose at least one available trap type.');
  let maxPerBiweek = Number(payload.maxPerBiweek);
  if (!Number.isFinite(maxPerBiweek) || maxPerBiweek > budget) maxPerBiweek = budget;
  if (maxPerBiweek < 1) throw new JobError("Maximum traps per biweek must be at least 1 Fukui trap's worth.");
  return { budget, costFukui, costShrimp, costMinnow, allowedTypes, maxPerBiweek };
}

// optimize: model inputs + posterior + settings -> trap schedule, the
// summary the results page needs, and the two downloads
function startOptimizeJob(payload) {
  requireFitInputs(payload);
  const settings = parseOptimizeSettings(payload.settings || {});

  return jobsLib.createJob('optimize', async (job) => {
    const { modelDataDir, posteriorPath } = writeFitInputs(job, payload);
    const outputPath = path.join(job.dir, 'optimal_trap_schedule.json');
    const progressPath = path.join(job.dir, 'optimize_progress.json');
    job.progress = { phase: 'preparing', message: 'Loading model inputs and posterior samples...' };
    await jobsLib.runR(job, [
      'util_code/optimize_traps.R',
      modelDataDir,
      posteriorPath,
      outputPath,
      progressPath,
      String(settings.budget),
      String(settings.costFukui),
      String(settings.costShrimp),
      String(settings.costMinnow),
      String(OPTIMIZE_N_DRAW),
      String(OPTIMIZE_N_DRAW_SCORE),
      settings.allowedTypes.join(','),
      String(settings.maxPerBiweek),
    ], { progressPath });
    const result = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    const zips = optimizationZips(result);
    return {
      result,
      info: optimizationInfo(result),
      summaryZip: zips.summaryZip.toString('base64'),
      optionsZip: zips.optionsZip ? zips.optionsZip.toString('base64') : null,
    };
  });
}

const JOB_STARTERS = { fit: startFitJob, analyze: startAnalyzeJob, optimize: startOptimizeJob };

// POST /api/jobs { type: "fit" | "analyze" | "optimize", ...inputs }
function handleCreateJob(req, res) {
  readBody(req).then((raw) => {
    let payload;
    try { payload = raw ? JSON.parse(raw) : {}; } catch (error) { return sendJson(res, 400, { error: 'Invalid JSON body.' }); }
    const start = JOB_STARTERS[payload.type];
    if (!start) return sendJson(res, 400, { error: 'Unknown job type.' });
    try {
      const job = start(payload);
      sendJson(res, 200, { id: job.id });
    } catch (error) {
      sendJson(res, error instanceof JobError ? 400 : 500, { error: error.message });
    }
  }).catch((error) => sendJson(res, 400, { error: error.message }));
}

const INTERRUPTED = 'This run was interrupted because the server restarted (for example, after running out of memory) or it was left unattended. Please run it again.';

// GET /api/jobs/:id - progress (polled by the page)
function handleJobStatus(req, res, id) {
  const job = jobsLib.jobs.get(id);
  if (!job) return sendJson(res, 404, { error: INTERRUPTED, done: true });
  job.lastSeen = Date.now();
  sendJson(res, 200, jobsLib.jobStatus(job));
}

// GET /api/jobs/:id/result - the outputs, once; the job's files are then
// deleted from the server
function handleJobResult(req, res, id) {
  const job = jobsLib.jobs.get(id);
  if (!job) return sendJson(res, 404, { error: INTERRUPTED });
  if (job.status === 'failed') return sendJson(res, 409, { error: job.error });
  if (job.status !== 'done') return sendJson(res, 409, { error: 'This run has not finished yet.' });
  sendJson(res, 200, job.result);
  jobsLib.removeJob(job);
}

// DELETE /api/jobs/:id - stop a job (e.g. the data or settings changed) and
// release the fit's kept-alive process
function handleCancelJob(req, res, id) {
  const job = jobsLib.jobs.get(id);
  if (job) jobsLib.cancelJob(job);
  jobsLib.releaseFit(id);
  sendJson(res, 200, { cancelled: Boolean(job) });
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

// The two optimization downloads, built when an optimization finishes and
// handed to the browser with the results.
//   summaryZip  "Download optimization summary": the recommended schedule and
//               its README (with a single option, also the options CSV, since
//               there's no alternatives pop-up to download it from)
//   optionsZip  "Download trap schedule options" in the alternatives pop-up
//               (null with a single option)
function optimizationZips(result) {
  const { summaryCsv, optionsCsv } = buildOptimizationCsvs(result);
  const single = Boolean(optionsCsv) && result.options.length === 1;
  const summaryFiles = [{ name: 'optimization_summary.csv', data: Buffer.from(summaryCsv) }];
  if (single) summaryFiles.push({ name: 'optimization_options.csv', data: Buffer.from(optionsCsv) });
  summaryFiles.push({ name: 'README.txt', data: Buffer.from(optimizationSummaryReadme(result, single)) });
  return {
    summaryZip: buildZip(summaryFiles),
    optionsZip: optionsCsv && !single
      ? buildZip([
        { name: 'optimization_options.csv', data: Buffer.from(optionsCsv) },
        { name: 'README.txt', data: Buffer.from(optimizationOptionsReadme(result)) },
      ])
      : null,
  };
}

// what the results page and saved scenarios need from an optimization
function optimizationInfo(result) {
  // traps of each type in the recommended schedule, and the effort they use
  // in Fukui traps' worth, for the results page's summary sentence
  const traps = {};
  let effortUsed = 0;
  for (const [type, counts] of Object.entries(result.schedule)) {
    traps[type] = counts.reduce((sum, count) => sum + Number(count), 0);
    effortUsed += traps[type] * Number(result.cost[type]);
  }
  return {
    budget: result.budget,
    cost: result.cost,
    nOptions: Array.isArray(result.options) ? result.options.length : 1,
    traps,
    effortUsed,
    // settings, for the suggested scenario name
    allowedTypes: Array.isArray(result.allowed_types) ? result.allowed_types : Object.keys(result.cost),
    maxPerBiweek: Number.isFinite(result.max_per_biweek) ? result.max_per_biweek : result.budget,
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
        // crabs prevented vs no trapping, paired within each posterior sample
        prevented: Number.isFinite(option.prevented_vs_no_trapping) ? option.prevented_vs_no_trapping : null,
        prevented95: Array.isArray(option.prevented_vs_no_trapping_95) ? option.prevented_vs_no_trapping_95 : null,
      })),
    noTrapping: result.no_trapping
      ? { expectedAbundance: result.no_trapping.expected_abundance, abundance95: result.no_trapping.abundance_95 || null }
      : null,
  };
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

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'POST' && pathname === '/api/jobs') return handleCreateJob(req, res);
  const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)(\/result)?$/);
  if (jobMatch) {
    const id = jobMatch[1];
    if (!jobsLib.isJobId(id)) return sendJson(res, 404, { error: 'Unknown run.' });
    if (req.method === 'GET' && jobMatch[2]) return handleJobResult(req, res, id);
    if (req.method === 'GET') return handleJobStatus(req, res, id);
    if (req.method === 'DELETE') return handleCancelJob(req, res, id);
  }
  if (req.method === 'POST' && pathname === '/api/chat') return chat.handleChat(req, res);
  if (req.method === 'GET' && pathname === '/api/chat/config') return chat.handleChatConfig(req, res);
  if (req.method === 'POST' && pathname === '/api/chat/context') return chat.handleChatContext(req, res);
  if (req.method === 'GET') return serveStatic(req, res, pathname);
  res.writeHead(405);
  res.end('Method not allowed');
});

server.listen(PORT, () => {
  console.log(`EGC Decision Support running at http://localhost:${PORT}`);
});
