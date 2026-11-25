const totalSteps = 6;
let currentStep = 1;
const uploadedData = { catch: null, effort: null };
let selectedVisualizationYear = 'all';

const stepViews = [...document.querySelectorAll('.step-view')];
const stepLinks = [...document.querySelectorAll('.step-link')];
const progressBar = document.querySelector('#progress-bar');
const progressLabel = document.querySelector('#progress-label');
const progressStatus = document.querySelector('#progress-status');
const stepNames = ['Getting started', 'Upload data', 'Data visualization', 'Regime estimation', 'Objective function', 'Optimization'];

function showError(element, message) {
  element.textContent = message;
  element.hidden = false;
}

function parseCsv(text) {
  const rows = [];
  let row = [], value = '', quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];
    if (character === '"' && quoted && nextCharacter === '"') { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) { row.push(value); value = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && nextCharacter === '\n') index += 1;
      row.push(value); value = '';
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
    } else value += character;
  }
  if (value || row.length) { row.push(value); if (row.some((cell) => cell.trim() !== '')) rows.push(row); }
  return rows;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]);
}

function renderPreview(kind, file, rows) {
  const headers = rows[0] || [];
  const summary = document.querySelector(`#${kind}-summary`);
  const check = document.querySelector(`#${kind}-check`);
  const card = document.querySelector(`[data-kind="${kind}"].drop-zone`).closest('.dataset-card');
  check.textContent = '✓';
  card.classList.add('has-file');
  let preview = card.querySelector('.data-preview');
  if (!preview) { preview = document.createElement('div'); preview.className = 'data-preview'; card.append(preview); }
  let previewHeaders = headers;
  let selectedIndexes = headers.map((_, index) => index);
  const selectionConfig = {
    catch: [
      { key: 'date', label: 'Date column', pattern: /date|time/i, dateFormat: true },
      { key: 'size', label: 'Crab size column', pattern: /size|length|carapace/i },
      { key: 'trap-type', label: 'Trap type column', pattern: /trap.?type|gear.?type|type/i, help: 'Indicate whether the trap used to catch the crab is a minnow, fukui, or shrimp trap. All other trap types will be filtered out of the dataset' },
      { key: 'trap-id', label: 'Trap ID column', pattern: /trap.?id|trap.?number|trap.?no/i, help: 'Unique ID that links the crab to the trap it was caught in' },
    ],
    effort: [
      { key: 'date-checked', label: 'Date checked column', pattern: /date.?check|check.?date|date.?set|date.?retrieved|date.?pull/i, dateFormat: true },
      { key: 'trap-type', label: 'Trap type column', pattern: /trap.?type|gear.?type|type/i, help: 'Indicate whether the trap used to catch the crab is a minnow, fukui, or shrimp trap. All other trap types will be filtered out of the dataset' },
      { key: 'trap-id', label: 'Trap ID column', pattern: /trap.?id|trap.?number|trap.?no/i, help: 'Unique ID that links the crab to the trap it was caught in' },
    ],
  };
  if (selectionConfig[kind]) {
    const fields = selectionConfig[kind];
    let selection = card.querySelector('.column-selection');
    if (!selection) {
      selection = document.createElement('div');
      selection.className = 'column-selection';
      selection.innerHTML = `<p>Select ${kind} columns</p>${fields.map((field) => `<label for="${kind}-${field.key}-column"><span class="column-label">${field.label}${field.help ? `<span class="info-tooltip"><button class="info-tooltip-button" type="button" aria-label="More information about ${field.label}">?</button><span class="info-tooltip-text" role="tooltip">${field.help}</span></span>` : ''}</span><select id="${kind}-${field.key}-column"></select></label>${field.dateFormat ? `<label for="${kind}-${field.key}-format">${field.dateFormatLabel || 'Date format'}<select id="${kind}-${field.key}-format"><option value="">Select a date format</option><option value="MM-DD-YY">MM-DD-YY</option><option value="MM/DD/YY">MM/DD/YY</option><option value="YYYY-MM-DD">YYYY-MM-DD</option><option value="YYYY/M/D">YYYY/M/D</option><option value="MM/DD/YYYY">MM/DD/YYYY</option><option value="DD-MM-YYYY">DD-MM-YYYY</option></select></label>` : ''}`).join('')}`;
      card.insertBefore(selection, preview);
    }
    selection.hidden = false;
    fields.forEach((field) => {
      const select = selection.querySelector(`#${kind}-${field.key}-column`);
      const previousValue = select.value;
      select.innerHTML = `<option value="">Select a column</option>${headers.map((header, index) => `<option value="${index}">${escapeHtml(header)}</option>`).join('')}`;
      select.value = headers[Number(previousValue)] ? previousValue : '';
      if (field.dateFormat) {
        const formatSelect = selection.querySelector(`#${kind}-${field.key}-format`);
        const savedFormat = uploadedData[kind]?.dateFormats?.[field.key] || formatSelect.value;
        formatSelect.value = savedFormat;
        if (!formatSelect.dataset.bound) {
          formatSelect.addEventListener('change', (event) => {
            if (!uploadedData[kind]) uploadedData[kind] = { file, rows };
            if (!uploadedData[kind].dateFormats) uploadedData[kind].dateFormats = {};
            uploadedData[kind].dateFormats[field.key] = event.target.value;
            resetQualityChecks();
          });
          formatSelect.dataset.bound = 'true';
        }
      }
    });
    if (!selection.dataset.bound) {
      // Reads the CURRENT upload from uploadedData rather than closing over
      // this render's `file`/`rows` params, since this listener is bound
      // only once per card and must keep working after the user replaces
      // the file with a different one later.
      selection.addEventListener('change', () => {
        resetQualityChecks();
        renderPreview(kind, uploadedData[kind].file, uploadedData[kind].rows);
      });
      selection.dataset.bound = 'true';
    }
    // Built from the selects' own values (not a header-name lookup) so a
    // blank-named column in the source CSV (e.g. R's write.csv row-index
    // column) can never be mistaken for "no column selected here".
    selectedIndexes = fields.map((field) => {
      const value = selection.querySelector(`#${kind}-${field.key}-column`).value;
      return value === '' ? -1 : Number(value);
    });
    previewHeaders = selectedIndexes.map((index) => (index === -1 ? '' : headers[index]));
  }
  let filteredRows = rows.slice(1);
  let removedRows = [];
  let removedTrapRows = 0;
  const trapTypeField = selectionConfig[kind]?.find((field) => field.key === 'trap-type');
  const trapTypeSelect = trapTypeField ? card.querySelector(`#${kind}-trap-type-column`) : null;
  const trapTypeIndex = trapTypeSelect?.value === '' ? -1 : Number(trapTypeSelect?.value);
  if (trapTypeField && trapTypeIndex >= 0) {
    const allowedTrapTypes = new Set(['minnow', 'fukui', 'shrimp']);
    const normalizedRows = filteredRows
      .map((row) => {
        const normalizedRow = [...row];
        normalizedRow[trapTypeIndex] = (normalizedRow[trapTypeIndex] || '').replace(/\s+/g, '').toLowerCase();
        return normalizedRow;
      });
    filteredRows = normalizedRows.filter((row) => allowedTrapTypes.has(row[trapTypeIndex]));
    removedRows = normalizedRows.filter((row) => !allowedTrapTypes.has(row[trapTypeIndex]));
    removedTrapRows = rows.length - 1 - filteredRows.length;
  }
  let removedDateRows = 0;
  const dateField = selectionConfig[kind]?.find((field) => field.dateFormat);
  const dateSelect = dateField ? card.querySelector(`#${kind}-${dateField.key}-column`) : null;
  const dateIndex = dateSelect?.value === '' ? -1 : Number(dateSelect?.value);
  const dateFormatSelect = dateField ? card.querySelector(`#${kind}-${dateField.key}-format`) : null;
  const dateFormat = dateFormatSelect?.value || '';
  if (dateField && dateIndex >= 0 && dateFormat) {
    const isValidDate = (row) => {
      const rawValue = row[dateIndex];
      if (!String(rawValue ?? '').trim()) return true;
      return Boolean(parseDateWithFormat(rawValue, dateFormat));
    };
    const beforeDateFilter = filteredRows.length;
    removedRows = removedRows.concat(filteredRows.filter((row) => !isValidDate(row)));
    filteredRows = filteredRows.filter(isValidDate);
    removedDateRows = beforeDateFilter - filteredRows.length;
  }
  if (uploadedData[kind]) uploadedData[kind].filteredRows = filteredRows;
  const selectedCount = previewHeaders.filter((header) => header !== '').length;
  summary.innerHTML = `<strong>${escapeHtml(file.name)}</strong><span>${filteredRows.length} rows · ${selectedCount} of ${previewHeaders.length} columns selected</span>`;
  const renderTable = (tableRows) => `<div class="data-preview-scroll"><table><thead><tr>${previewHeaders.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${tableRows.map((row) => `<tr>${selectedIndexes.map((index) => `<td>${escapeHtml(row[index] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const removalReasons = [];
  if (removedTrapRows > 0) removalReasons.push(`${removedTrapRows} rows were removed because they were not a minnow, fukui, or shrimp trap.`);
  if (removedDateRows > 0) removalReasons.push(`${removedDateRows} rows were removed because their date didn't match the selected format.`);
  const removalMessage = removalReasons.length ? `${removalReasons.map((reason) => `<p class="filter-message">${reason}</p>`).join('')}<label class="removed-rows-toggle"><input type="checkbox" id="show-removed-rows"${card.dataset.showRemoved === 'true' ? ' checked' : ''}> Show removed rows</label>` : '';
  const removedPreview = removedRows.length > 0 && card.dataset.showRemoved === 'true' ? `<p class="removed-rows-heading">Removed rows (${removedRows.length})</p>${renderTable(removedRows)}` : '';
  preview.innerHTML = `${removalMessage}<p>Preview (all ${filteredRows.length} rows)</p>${renderTable(filteredRows)}${removedPreview}`;
  const removedToggle = preview.querySelector('#show-removed-rows');
  if (removedToggle) removedToggle.addEventListener('change', (event) => {
    card.dataset.showRemoved = String(event.target.checked);
    renderPreview(kind, file, rows);
  });
  updateQualityCheckGating();
}

function allColumnsSelected() {
  if (!uploadedData.catch || !uploadedData.effort) return false;
  const requiredKeys = { catch: ['date', 'size', 'trap-type', 'trap-id'], effort: ['date-checked', 'trap-type', 'trap-id'] };
  return Object.entries(requiredKeys).every(([kind, keys]) => keys.every((key) => selectedColumnIndex(kind, key) !== -1));
}

function updateQualityCheckGating() {
  const trigger = document.querySelector('#run-quality-checks');
  const confirmBox = document.querySelector('#data-confirmed');
  const continueButton = document.querySelector('.step-view[data-view="2"] .next-button');
  if (trigger) trigger.disabled = !allColumnsSelected();
  if (continueButton) continueButton.disabled = !(trigger?.checked && confirmBox?.checked);
}

function resetQualityChecks() {
  const trigger = document.querySelector('#run-quality-checks');
  const confirmBox = document.querySelector('#data-confirmed');
  const list = document.querySelector('#quality-check-list');
  if (trigger) trigger.checked = false;
  if (list) { list.hidden = true; list.innerHTML = ''; }
  if (confirmBox) { confirmBox.checked = false; confirmBox.disabled = true; }
  updateQualityCheckGating();
}

function resetRegimeEstimation() {
  // stop this user's model fit / analysis and drop the results kept for it
  cancelJob('fit');
  cancelJob('analyze');
  releaseFit();
  userData.fit = null;
  analyzeData = null;
  // saved scenarios belong to the fitted model they were run on
  userData.scenarios = [];
  renderScenarios([]);

  const regimeRing = document.querySelector('#regime-run-ring');
  const regimeButton = document.querySelector('#regime-run-button');
  if (regimeRing) regimeRing.classList.remove('is-done');
  document.querySelector('#regime-run-title').textContent = 'Ready to run';
  document.querySelector('#regime-run-copy').textContent = 'Fits the population model to your uploaded catch and effort data using MCMC.';
  document.querySelector('#regime-run-bar').style.width = '0%';
  document.querySelector('#regime-run-error').hidden = true;
  if (regimeButton) regimeButton.disabled = false;
  document.querySelector('#regime-download-button').hidden = true;

  const analyzeRing = document.querySelector('#analyze-run-ring');
  const analyzeButton = document.querySelector('#analyze-run-button');
  document.querySelector('#analyze-card').hidden = true;
  if (analyzeRing) analyzeRing.classList.remove('is-done');
  document.querySelector('#analyze-run-title').textContent = 'Ready to analyze';
  document.querySelector('#analyze-run-copy').textContent = 'Simulates posterior population dynamics from the fitted model.';
  document.querySelector('#analyze-run-bar').style.width = '0%';
  document.querySelector('#analyze-run-error').hidden = true;
  if (analyzeButton) analyzeButton.disabled = false;
  document.querySelector('#analyze-controls').hidden = true;
  document.querySelector('#analyze-results-panel').hidden = true;

  document.querySelector('#regime-next-button').disabled = true;

  // the optimization depends on the model run, so it's reset too
  resetOptimization();
}

// Resets the optimization step (used when the data or the objective
// changes), stopping any run in progress and discarding its results
function resetOptimization() {
  cancelJob('optimize');
  userData.optimization = null;
  const ring = document.querySelector('#optimize-run-ring');
  const button = document.querySelector('#optimize-run-button');
  if (ring) ring.classList.remove('is-done');
  document.querySelector('#optimize-run-title').textContent = 'Ready to optimize';
  document.querySelector('#optimize-run-copy').textContent = 'Finds the trap schedule that minimizes the estimated abundance at the start of the next trapping season.';
  document.querySelector('#optimize-run-bar').style.width = '0%';
  document.querySelector('#optimize-run-error').hidden = true;
  if (button) button.disabled = false;
  hideOptimizationResults();
}

function selectedColumnIndex(kind, key) {
  const select = document.querySelector(`#${kind}-${key}-column`);
  return select && select.value !== '' ? Number(select.value) : -1;
}

function selectedDateFormat(kind, key) {
  const select = document.querySelector(`#${kind}-${key}-format`);
  return select ? select.value : '';
}

function parseDateWithFormat(value, format) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed || !format) return null;
  const patterns = {
    'MM-DD-YY': { regex: /^(\d{1,2})-(\d{1,2})-(\d{2})$/, order: ['month', 'day', 'year2'] },
    'MM/DD/YY': { regex: /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/, order: ['month', 'day', 'year2'] },
    'YYYY-MM-DD': { regex: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, order: ['year', 'month', 'day'] },
    'YYYY/M/D': { regex: /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, order: ['year', 'month', 'day'] },
    'MM/DD/YYYY': { regex: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, order: ['month', 'day', 'year'] },
    'DD-MM-YYYY': { regex: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, order: ['day', 'month', 'year'] },
  };
  const spec = patterns[format];
  if (!spec) return null;
  const match = trimmed.match(spec.regex);
  if (!match) return null;
  const parts = {};
  spec.order.forEach((name, index) => { parts[name] = Number(match[index + 1]); });
  const year = parts.year ?? (parts.year2 !== undefined ? 2000 + parts.year2 : undefined);
  const { month, day } = parts;
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function runQualityChecks() {
  const results = [];
  if (!uploadedData.catch || !uploadedData.effort) {
    results.push({ status: 'error', message: 'Upload both the catch and effort files before running data quality checks.' });
    return results;
  }
  const catchCols = {
    date: selectedColumnIndex('catch', 'date'),
    size: selectedColumnIndex('catch', 'size'),
    trapType: selectedColumnIndex('catch', 'trap-type'),
    trapId: selectedColumnIndex('catch', 'trap-id'),
  };
  const effortCols = {
    dateChecked: selectedColumnIndex('effort', 'date-checked'),
    trapType: selectedColumnIndex('effort', 'trap-type'),
    trapId: selectedColumnIndex('effort', 'trap-id'),
  };
  const catchLabels = { date: 'catch date', size: 'catch crab size', trapType: 'catch trap type', trapId: 'catch trap ID' };
  const effortLabels = { dateChecked: 'effort date checked', trapType: 'effort trap type', trapId: 'effort trap ID' };
  const missingColumns = [
    ...Object.entries(catchCols).filter(([, index]) => index === -1).map(([key]) => catchLabels[key]),
    ...Object.entries(effortCols).filter(([, index]) => index === -1).map(([key]) => effortLabels[key]),
  ];
  if (missingColumns.length) {
    results.push({ status: 'error', message: `Select all required columns before running checks. Missing: ${missingColumns.join(', ')}.` });
    return results;
  }

  const catchRows = uploadedData.catch.filteredRows || [];
  const effortRows = uploadedData.effort.filteredRows || [];
  if (catchRows.length === 0) {
    results.push({ status: 'error', message: 'No catch rows remain after filtering. Double-check the selected trap type column and date format — if every row was removed, the date format is likely wrong for this file.' });
    return results;
  }
  if (effortRows.length === 0) {
    results.push({ status: 'error', message: 'No effort rows remain after filtering. Double-check the selected trap type column and date format — if every row was removed, the date format is likely wrong for this file.' });
    return results;
  }
  const isBlank = (value) => !String(value ?? '').trim();
  const normalizeTrapId = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');

  const catchMissing = catchRows.filter((row) => [catchCols.date, catchCols.size, catchCols.trapId].some((index) => isBlank(row[index]))).length;
  results.push(catchMissing === 0
    ? { status: 'pass', message: 'No missing values in the required catch columns.' }
    : { status: 'error', message: `${catchMissing} catch row(s) are missing a date, size, or trap ID.` });

  const effortMissing = effortRows.filter((row) => [effortCols.dateChecked, effortCols.trapId].some((index) => isBlank(row[index]))).length;
  results.push(effortMissing === 0
    ? { status: 'pass', message: 'No missing values in the required effort columns.' }
    : { status: 'error', message: `${effortMissing} effort row(s) are missing a date or trap ID.` });

  const catchFormat = selectedDateFormat('catch', 'date');
  if (!catchFormat) {
    results.push({ status: 'error', message: 'Select a date format for the catch date column.' });
  } else {
    const invalidCatchDates = catchRows.filter((row) => !isBlank(row[catchCols.date]) && !parseDateWithFormat(row[catchCols.date], catchFormat)).length;
    results.push(invalidCatchDates === 0
      ? { status: 'pass', message: 'All catch dates match the selected date format.' }
      : { status: 'error', message: `${invalidCatchDates} catch row(s) have a date that does not match the selected format.` });
  }

  const effortFormat = selectedDateFormat('effort', 'date-checked');
  if (!effortFormat) {
    results.push({ status: 'error', message: 'Select a date format for the effort date checked column.' });
  } else {
    const invalidEffortDates = effortRows.filter((row) => !isBlank(row[effortCols.dateChecked]) && !parseDateWithFormat(row[effortCols.dateChecked], effortFormat)).length;
    results.push(invalidEffortDates === 0
      ? { status: 'pass', message: 'All effort dates match the selected date format.' }
      : { status: 'error', message: `${invalidEffortDates} effort row(s) have a date that does not match the selected format.` });
  }

  const dateKey = (date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const effortDeployments = new Set(effortRows.map((row) => {
    const trapId = normalizeTrapId(row[effortCols.trapId]);
    const date = effortFormat && !isBlank(row[effortCols.dateChecked]) ? parseDateWithFormat(row[effortCols.dateChecked], effortFormat) : null;
    return trapId && date ? `${trapId}|${dateKey(date)}` : null;
  }).filter(Boolean));
  const formatDateForDisplay = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const unmatchedRows = catchRows.filter((row) => {
    const trapId = normalizeTrapId(row[catchCols.trapId]);
    const date = catchFormat && !isBlank(row[catchCols.date]) ? parseDateWithFormat(row[catchCols.date], catchFormat) : null;
    if (!trapId || !date) return false;
    return !effortDeployments.has(`${trapId}|${dateKey(date)}`);
  }).map((row) => `${formatDateForDisplay(parseDateWithFormat(row[catchCols.date], catchFormat))} / ${normalizeTrapId(row[catchCols.trapId])}`);
  results.push(unmatchedRows.length === 0
    ? { status: 'pass', message: 'Every catch record\'s date and trap ID match a deployment in the effort data.' }
    : { status: 'warning', message: `${unmatchedRows.length} catch row(s) have a date/trap ID combination that isn't in the effort data: ${unmatchedRows.join(', ')}. These rows will be removed in subsequent analyses.` });

  const seenDeployments = new Set();
  let duplicateDeployments = 0;
  effortRows.forEach((row) => {
    const key = `${normalizeTrapId(row[effortCols.trapId])}|${row[effortCols.dateChecked]}`;
    if (seenDeployments.has(key)) duplicateDeployments += 1;
    else seenDeployments.add(key);
  });
  results.push(duplicateDeployments === 0
    ? { status: 'pass', message: 'No duplicate trap deployments found in the effort data.' }
    : { status: 'warning', message: `${duplicateDeployments} effort row(s) repeat the same trap ID and date checked.` });

  return results;
}

function resetColumnSelection(kind) {
  const card = document.querySelector(`[data-kind="${kind}"].drop-zone`)?.closest('.dataset-card');
  const selection = card?.querySelector('.column-selection');
  if (!selection) return;
  selection.querySelectorAll('select').forEach((select) => { select.value = ''; });
}

function handleFile(kind, file) {
  const error = document.querySelector('#upload-error');
  error.hidden = true;
  resetQualityChecks();
  resetRegimeEstimation();
  resetColumnSelection(kind);
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.csv') && file.type !== 'text/csv') return showError(error, 'Please choose a CSV file for each dataset.');
  if (file.size > 10 * 1024 * 1024) return showError(error, 'Each file must be smaller than 10 MB.');
  const reader = new FileReader();
  reader.onload = () => {
    const rows = parseCsv(reader.result.replace(/^\uFEFF/, ''));
    if (rows.length < 2 || rows[0].length === 0) return showError(error, `${kind} data appears to be empty. Include a header row and at least one data row.`);
    uploadedData[kind] = { file, rows };
    renderPreview(kind, file, rows);
  };
  reader.onerror = () => showError(error, `The ${kind} file could not be read. Please try again.`);
  reader.readAsText(file);
}

function setupDismissableDialog(dialog, closeButton) {
  if (!dialog) return;
  closeButton?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

const homepageLearnMoreDialog = document.querySelector('#homepage-learn-more-dialog');
document.querySelector('#homepage-learn-more-button')?.addEventListener('click', () => {
  homepageLearnMoreDialog.showModal();
});
setupDismissableDialog(homepageLearnMoreDialog, document.querySelector('#homepage-learn-more-close'));

// "Learn more" on the optimization step: Q&A about how the optimization works
const optimizeLearnMoreDialog = document.querySelector('#optimize-learn-more-dialog');
document.querySelector('#optimize-learn-more-button').addEventListener('click', () => optimizeLearnMoreDialog.showModal());
setupDismissableDialog(optimizeLearnMoreDialog, document.querySelector('#optimize-learn-more-close'));

// "Read more" on the upload step: what the catch and effort files should contain
// "Data privacy details" in the footer
const privacyDetailsDialog = document.querySelector('#privacy-details-dialog');
document.querySelector('#privacy-details-button').addEventListener('click', () => privacyDetailsDialog.showModal());
setupDismissableDialog(privacyDetailsDialog, document.querySelector('#privacy-details-close'));

const uploadReadMoreDialog = document.querySelector('#upload-read-more-dialog');
document.querySelector('#upload-read-more-button').addEventListener('click', () => uploadReadMoreDialog.showModal());
setupDismissableDialog(uploadReadMoreDialog, document.querySelector('#upload-read-more-close'));

const dynamicsLearnMoreDialog = document.querySelector('#dynamics-learn-more-dialog');
document.querySelector('#dynamics-learn-more-button')?.addEventListener('click', () => {
  dynamicsLearnMoreDialog.showModal();
});
setupDismissableDialog(dynamicsLearnMoreDialog, document.querySelector('#dynamics-learn-more-close'));

const PROCESS_DETAILS = {
  removal: {
    image: 'figures/harvest_rate.png',
    alt: 'Size-selective removal rate by trap type',
    text: 'The model estimates size selective removal rates for each trap type. The solid line is the model’s average estimate, and the shaded area represents the 95% credibility interval. Parameter uncertainty in these removal rates is incorporated into the model that fits your data.',
  },
  growth: {
    image: 'figures/growth_plot.png',
    alt: 'Probabilistic change in body size over two weeks by month',
    text: 'The model describes EGC growth as a function of body size (carapace width) and time, such that crabs grow in size faster in warmer months and slower in colder months. Each of these figures is showing the probabilistic change in body size over two weeks, with the starting size on the x-axis and the ending size on the y-axis. For example, in July, all crab sizes are most likely to increase in body size over two weeks, but smaller crabs are growing faster than larger crabs.',
  },
  naturalMortality: {
    image: 'figures/natural_survival.png',
    alt: 'Size-dependent natural survival rate from March to November',
    text: 'The model accounts for size-dependent natural mortality, with smaller crabs having lower survival rates than larger crabs. This plot shows the rate of survival from March - November if removal did not occur. Parameter uncertainty in these survival rates is not incorporated into the model that fits your data.',
  },
};

const processDetailDialog = document.querySelector('#process-detail-dialog');
document.querySelectorAll('#dynamics-learn-more-dialog [data-process]').forEach((button) => {
  button.addEventListener('click', () => {
    const detail = PROCESS_DETAILS[button.dataset.process];
    if (!detail) return;
    document.querySelector('#process-detail-text').textContent = detail.text;
    const image = document.querySelector('#process-detail-image');
    image.src = detail.image;
    image.alt = detail.alt;
    processDetailDialog.showModal();
  });
});
setupDismissableDialog(processDetailDialog, document.querySelector('#process-detail-close'));

function canEnterStep(step) {
  if (step <= 2) return true;
  if (!uploadedData.catch || !uploadedData.effort || !document.querySelector('#data-confirmed').checked) return false;
  if (step >= 5 && document.querySelector('#regime-next-button').disabled) return false;
  return true;
}

const BIWEEK_BREAKS = [59, 76, 91, 106, 121, 137, 152, 167, 182, 198, 213, 229, 244, 259, 274, 290, 305, 320, 335];
const TRAP_COLORS = { minnow: '#eb806b', fukui: '#4a9974', shrimp: '#8452c9' };
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function colorForTrapType(trapType) {
  return TRAP_COLORS[trapType] || '#7c8b85';
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function formatDateLong(date) {
  return `${MONTH_ABBR[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function formatTooltipNumber(value) {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function ensureChartTooltip() {
  let tooltip = document.querySelector('#chart-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'chart-tooltip';
    tooltip.className = 'chart-tooltip';
    tooltip.hidden = true;
    document.body.append(tooltip);
  }
  return tooltip;
}

function attachChartInteractions(mount) {
  const tooltip = ensureChartTooltip();
  mount.querySelectorAll('.chart-point').forEach((point) => {
    point.addEventListener('mouseenter', () => {
      tooltip.textContent = point.dataset.tooltip;
      tooltip.hidden = false;
    });
    point.addEventListener('mousemove', (event) => {
      tooltip.style.left = `${event.clientX}px`;
      tooltip.style.top = `${event.clientY}px`;
    });
    point.addEventListener('mouseleave', () => { tooltip.hidden = true; });
  });
}

function downloadChartAsPng(mountId, filename) {
  const svg = document.querySelector(`#${mountId} svg`);
  if (!svg) return;
  const [, , svgWidth, svgHeight] = svg.getAttribute('viewBox').split(' ').map(Number);
  const scale = 2;
  const svgString = new XMLSerializer().serializeToString(svg);
  const svgUrl = URL.createObjectURL(new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' }));
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = svgWidth * scale;
    canvas.height = svgHeight * scale;
    const context = canvas.getContext('2d');
    context.fillStyle = cssVar('--panel') || '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(svgUrl);
    canvas.toBlob((blob) => {
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `${filename}.png`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);
    }, 'image/png');
  };
  image.src = svgUrl;
}

function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - start) / 86400000);
}

function biweekBreakFor(date) {
  const jday = dayOfYear(date);
  let index = -1;
  BIWEEK_BREAKS.forEach((brk, i) => { if (jday > brk) index = i; });
  return index === -1 ? null : BIWEEK_BREAKS[index];
}

const AGGREGATE_REFERENCE_YEAR = 2001;

// Calendar date for a Julian day (day of year), read as a non-leap year so a
// given Julian day is always the same date; placed in `year` if given.
function julianDayToDate(jday, year = AGGREGATE_REFERENCE_YEAR) {
  const nonLeap = new Date(AGGREGATE_REFERENCE_YEAR, 0, jday);
  return new Date(year, nonLeap.getMonth(), nonLeap.getDate());
}

function getAvailableYears() {
  const catchCols = { date: selectedColumnIndex('catch', 'date') };
  const effortCols = { dateChecked: selectedColumnIndex('effort', 'date-checked') };
  const catchFormat = selectedDateFormat('catch', 'date');
  const effortFormat = selectedDateFormat('effort', 'date-checked');
  const years = new Set();
  (uploadedData.catch?.filteredRows || []).forEach((row) => {
    const date = catchFormat ? parseDateWithFormat(row[catchCols.date], catchFormat) : null;
    if (date) years.add(date.getFullYear());
  });
  (uploadedData.effort?.filteredRows || []).forEach((row) => {
    const date = effortFormat ? parseDateWithFormat(row[effortCols.dateChecked], effortFormat) : null;
    if (date) years.add(date.getFullYear());
  });
  return [...years].sort((a, b) => a - b);
}

function buildVisualizationData() {
  const catchCols = { date: selectedColumnIndex('catch', 'date'), size: selectedColumnIndex('catch', 'size'), trapType: selectedColumnIndex('catch', 'trap-type') };
  const effortCols = { dateChecked: selectedColumnIndex('effort', 'date-checked'), trapType: selectedColumnIndex('effort', 'trap-type') };
  const catchFormat = selectedDateFormat('catch', 'date');
  const effortFormat = selectedDateFormat('effort', 'date-checked');
  const catchRows = uploadedData.catch?.filteredRows || [];
  const effortRows = uploadedData.effort?.filteredRows || [];
  const normalizeTrapType = (value) => String(value ?? '').trim().toLowerCase();
  const isAggregate = selectedVisualizationYear === 'all';

  const catchPoints = catchRows.map((row) => {
    const date = catchFormat ? parseDateWithFormat(row[catchCols.date], catchFormat) : null;
    const size = Number(row[catchCols.size]);
    if (!date || !Number.isFinite(size)) return null;
    return { x: date.getTime(), y: size, series: normalizeTrapType(row[catchCols.trapType]) };
  }).filter(Boolean);

  const catchCounts = new Map();
  catchPoints.forEach((point) => {
    const date = new Date(point.x);
    const jday = biweekBreakFor(date);
    if (jday === null) return;
    const key = `${date.getFullYear()}|${jday}|${point.series}`;
    catchCounts.set(key, (catchCounts.get(key) || 0) + 1);
  });

  const groups = new Map();
  effortRows.forEach((row) => {
    const date = effortFormat ? parseDateWithFormat(row[effortCols.dateChecked], effortFormat) : null;
    if (!date) return;
    const jday = biweekBreakFor(date);
    if (jday === null) return;
    const year = date.getFullYear();
    const trapType = normalizeTrapType(row[effortCols.trapType]);
    const key = `${year}|${jday}|${trapType}`;
    if (!groups.has(key)) groups.set(key, { year, jday, trapType, n: 0 });
    groups.get(key).n += 1;
  });
  let effortSummary = [...groups.values()].map((g) => ({ ...g, totalCatch: catchCounts.get(`${g.year}|${g.jday}|${g.trapType}`) || 0 }));

  if (isAggregate) {
    const aggregated = new Map();
    effortSummary.forEach((g) => {
      const key = `${g.jday}|${g.trapType}`;
      if (!aggregated.has(key)) aggregated.set(key, { jday: g.jday, trapType: g.trapType, n: 0, totalCatch: 0 });
      const a = aggregated.get(key);
      a.n += g.n;
      a.totalCatch += g.totalCatch;
    });
    effortSummary = [...aggregated.values()];
  } else {
    effortSummary = effortSummary.filter((g) => g.year === selectedVisualizationYear);
  }

  const xDateFor = (g) => julianDayToDate(g.jday, isAggregate ? AGGREGATE_REFERENCE_YEAR : g.year).getTime();

  return {
    catchPoints,
    cpuePoints: effortSummary.map((g) => ({ x: xDateFor(g), y: g.n > 0 ? g.totalCatch / g.n : 0, series: g.trapType })),
    effortPoints: effortSummary.map((g) => ({ x: xDateFor(g), y: g.n, series: g.trapType })),
    totalCatchPoints: effortSummary.map((g) => ({ x: xDateFor(g), y: g.totalCatch, series: g.trapType })),
  };
}

function niceAxisTicks(min, max, count) {
  const lo = min === max ? min - 1 : min;
  const hi = min === max ? max + 1 : max;
  const step = (hi - lo) / count;
  return Array.from({ length: count + 1 }, (_, i) => lo + step * i);
}

function formatAxisNumber(value) {
  return Math.abs(value) >= 100 ? String(Math.round(value)) : String(Math.round(value * 10) / 10);
}

function formatSignificant(value, sigFigs) {
  if (value === 0) return '0';
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const factor = 10 ** (sigFigs - 1 - magnitude);
  return String(Math.round(value * factor) / factor);
}

function formatDateShort(date) {
  return `${MONTH_ABBR[date.getMonth()]} ${date.getDate()}`;
}

function formatDateShortWithYear(date) {
  return `${MONTH_ABBR[date.getMonth()]} ${date.getDate()} '${String(date.getFullYear()).slice(-2)}`;
}

function renderSvgChart(mountId, points, opts) {
  const mount = document.querySelector(`#${mountId}`);
  if (!mount) return;
  if (!points.length) { mount.innerHTML = '<p class="chart-empty">No data to display.</p>'; return; }

  const width = 440;
  const plotHeight = 220;
  const legendHeight = 26;
  const height = plotHeight + legendHeight;
  const margin = { top: 12, right: opts.dateAxisFormat === 'withYear' ? 30 : 16, bottom: 32, left: 46 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = plotHeight - margin.top - margin.bottom;
  const lineColor = cssVar('--line');
  const mutedColor = cssVar('--muted');

  const xTicks = niceAxisTicks(Math.min(...points.map((p) => p.x)), Math.max(...points.map((p) => p.x)), 4);
  const yTicks = niceAxisTicks(Math.min(0, ...points.map((p) => p.y)), Math.max(...points.map((p) => p.y)), 4);
  const xScale = (x) => margin.left + ((x - xTicks[0]) / (xTicks[xTicks.length - 1] - xTicks[0] || 1)) * innerWidth;
  const yScale = (y) => margin.top + innerHeight - ((y - yTicks[0]) / (yTicks[yTicks.length - 1] - yTicks[0] || 1)) * innerHeight;

  const seriesMap = new Map();
  points.forEach((point) => {
    if (!seriesMap.has(point.series)) seriesMap.set(point.series, []);
    seriesMap.get(point.series).push(point);
  });

  const gridLines = yTicks.map((tick) => `<line x1="${margin.left}" x2="${width - margin.right}" y1="${yScale(tick)}" y2="${yScale(tick)}" stroke="${lineColor}" stroke-width="1" />`).join('');
  const yAxisLabels = yTicks.map((tick) => `<text x="${margin.left - 8}" y="${yScale(tick) + 3}" text-anchor="end" font-size="9" fill="${mutedColor}">${formatAxisNumber(tick)}</text>`).join('');
  const xAxisLabels = xTicks.map((tick) => `<text x="${xScale(tick)}" y="${plotHeight - margin.bottom + 16}" text-anchor="middle" font-size="9" fill="${mutedColor}">${opts.xIsDate ? (opts.dateAxisFormat === 'withYear' ? formatDateShortWithYear(new Date(tick)) : formatDateShort(new Date(tick))) : formatAxisNumber(tick)}</text>`).join('');

  let seriesMarkup = '';
  [...seriesMap.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([series, rows]) => {
    const color = colorForTrapType(series);
    const sorted = [...rows].sort((a, b) => a.x - b.x);
    if (opts.mode === 'line') {
      seriesMarkup += `<polyline points="${sorted.map((p) => `${xScale(p.x)},${yScale(p.y)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2" />`;
    }
    seriesMarkup += sorted.map((p) => {
      const xDisplay = opts.xIsDate ? (opts.tooltipDateFormat === 'short' ? formatDateShort(new Date(p.x)) : formatDateLong(new Date(p.x))) : formatAxisNumber(p.x);
      const tooltip = `${series}\n${opts.xLabel}: ${xDisplay}\n${opts.yLabel}: ${formatTooltipNumber(p.y)}`;
      return `<circle class="chart-point" cx="${xScale(p.x)}" cy="${yScale(p.y)}" r="4" fill="${color}" data-tooltip="${escapeHtml(tooltip)}"></circle>`;
    }).join('');
  });

  const legendY = plotHeight + legendHeight / 2 + 3;
  let legendX = margin.left;
  let legendMarkup = '';
  [...seriesMap.keys()].sort().forEach((series) => {
    legendMarkup += `<circle cx="${legendX + 4}" cy="${legendY - 3}" r="4" fill="${colorForTrapType(series)}" />`;
    legendMarkup += `<text x="${legendX + 13}" y="${legendY}" font-size="10" fill="${mutedColor}">${escapeHtml(series)}</text>`;
    legendX += 17 + series.length * 5.6 + 16;
  });

  mount.innerHTML = `<svg viewBox="0 0 ${width} ${height}" font-family="'DM Sans', Arial, sans-serif" role="img" aria-label="${escapeHtml(opts.yLabel)} by ${escapeHtml(opts.xLabel)}">
    ${gridLines}
    <line x1="${margin.left}" x2="${margin.left}" y1="${margin.top}" y2="${plotHeight - margin.bottom}" stroke="${lineColor}" />
    <line x1="${margin.left}" x2="${width - margin.right}" y1="${plotHeight - margin.bottom}" y2="${plotHeight - margin.bottom}" stroke="${lineColor}" />
    ${yAxisLabels}
    ${xAxisLabels}
    ${seriesMarkup}
    <text x="${margin.left + innerWidth / 2}" y="${plotHeight - 4}" text-anchor="middle" font-size="10" fill="${mutedColor}">${escapeHtml(opts.xLabel)}</text>
    <text x="12" y="${margin.top + innerHeight / 2}" text-anchor="middle" font-size="10" fill="${mutedColor}" transform="rotate(-90 12 ${margin.top + innerHeight / 2})">${escapeHtml(opts.yLabel)}</text>
    ${legendMarkup}
  </svg>`;

  attachChartInteractions(mount);
}

function renderBarChart(mountId, categories, values, opts) {
  const mount = document.querySelector(`#${mountId}`);
  if (!mount) return;
  const hasData = categories.length > 0 && values.some((v) => v && Number.isFinite(v.value));
  if (!hasData) {
    mount.innerHTML = `<p class="chart-empty">${escapeHtml(opts.emptyMessage || 'No data to display.')}</p>`;
    return;
  }

  const width = 440;
  const height = 240;
  const margin = { top: 12, right: 16, bottom: 32, left: 46 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const lineColor = cssVar('--line');
  const mutedColor = cssVar('--muted');
  const color = opts.color || '#4a9974';

  const maxY = Number.isFinite(opts.maxY)
    ? opts.maxY
    : Math.max(0, ...values.map((v) => (v && Number.isFinite(v.hi ?? v.value)) ? (v.hi ?? v.value) : 0));
  const formatYAxis = opts.yAxisFormatter || formatAxisNumber;
  const yTicks = niceAxisTicks(0, maxY, 4);
  const xTicks = niceAxisTicks(categories[0], categories[categories.length - 1], 4);
  const yScale = (y) => margin.top + innerHeight - ((y - yTicks[0]) / (yTicks[yTicks.length - 1] - yTicks[0] || 1)) * innerHeight;
  const xScale = (x) => margin.left + ((x - categories[0]) / (categories[categories.length - 1] - categories[0] || 1)) * innerWidth;
  const barWidth = Math.max(2, innerWidth / categories.length - 2);

  const gridLines = yTicks.map((tick) => `<line x1="${margin.left}" x2="${width - margin.right}" y1="${yScale(tick)}" y2="${yScale(tick)}" stroke="${lineColor}" stroke-width="1" />`).join('');
  const yAxisLabels = yTicks.map((tick) => `<text x="${margin.left - 8}" y="${yScale(tick) + 3}" text-anchor="end" font-size="9" fill="${mutedColor}">${formatYAxis(tick)}</text>`).join('');
  const xAxisLabels = xTicks.map((tick) => `<text x="${xScale(tick)}" y="${height - margin.bottom + 16}" text-anchor="middle" font-size="9" fill="${mutedColor}">${formatAxisNumber(tick)}</text>`).join('');

  let bars = '';
  categories.forEach((cat, i) => {
    const v = values[i];
    if (!v || !Number.isFinite(v.value)) return;
    const barX = xScale(cat) - barWidth / 2;
    const barY = yScale(v.value);
    const barH = Math.max(0, yScale(0) - barY);
    const tooltip = `${opts.xLabel}: ${formatAxisNumber(cat)}\n${opts.yLabel}: ${formatTooltipNumber(v.value)}`;
    bars += `<rect class="chart-point" x="${barX}" y="${barY}" width="${barWidth}" height="${barH}" fill="${color}" data-tooltip="${escapeHtml(tooltip)}"></rect>`;
    if (Number.isFinite(v.lo) && Number.isFinite(v.hi)) {
      const xCenter = xScale(cat);
      const yLo = yScale(v.lo);
      const yHi = yScale(v.hi);
      bars += `<line x1="${xCenter}" x2="${xCenter}" y1="${yHi}" y2="${yLo}" stroke="#30302e" stroke-width="1.5" /><line x1="${xCenter - 3}" x2="${xCenter + 3}" y1="${yHi}" y2="${yHi}" stroke="#30302e" stroke-width="1.5" /><line x1="${xCenter - 3}" x2="${xCenter + 3}" y1="${yLo}" y2="${yLo}" stroke="#30302e" stroke-width="1.5" />`;
    }
  });

  mount.innerHTML = `<svg viewBox="0 0 ${width} ${height}" font-family="'DM Sans', Arial, sans-serif" role="img" aria-label="${escapeHtml(opts.yLabel)} by ${escapeHtml(opts.xLabel)}">
    ${gridLines}
    <line x1="${margin.left}" x2="${margin.left}" y1="${margin.top}" y2="${height - margin.bottom}" stroke="${lineColor}" />
    <line x1="${margin.left}" x2="${width - margin.right}" y1="${height - margin.bottom}" y2="${height - margin.bottom}" stroke="${lineColor}" />
    ${yAxisLabels}
    ${xAxisLabels}
    ${bars}
    <text x="${margin.left + innerWidth / 2}" y="${height - 4}" text-anchor="middle" font-size="10" fill="${mutedColor}">${escapeHtml(opts.xLabel)}</text>
    <text x="12" y="${margin.top + innerHeight / 2}" text-anchor="middle" font-size="10" fill="${mutedColor}" transform="rotate(-90 12 ${margin.top + innerHeight / 2})">${escapeHtml(opts.yLabel)}</text>
  </svg>`;

  attachChartInteractions(mount);
}

function populateYearSelects() {
  const years = getAvailableYears();
  if (selectedVisualizationYear !== 'all' && !years.includes(selectedVisualizationYear)) selectedVisualizationYear = 'all';
  const optionsMarkup = ['<option value="all">All years</option>', ...years.map((year) => `<option value="${year}">${year}</option>`)].join('');
  document.querySelectorAll('.chart-year-select').forEach((select) => {
    select.innerHTML = optionsMarkup;
    select.value = String(selectedVisualizationYear);
  });
}

function renderVisualizations() {
  populateYearSelects();
  const data = buildVisualizationData();
  const tooltipDateFormat = selectedVisualizationYear === 'all' ? 'short' : 'long';
  renderSvgChart('chart-catch-size', data.catchPoints, { mode: 'scatter', xLabel: 'date', yLabel: 'size (mm)', xIsDate: true, dateAxisFormat: 'withYear' });
  renderSvgChart('chart-cpue', data.cpuePoints, { mode: 'line', xLabel: 'date', yLabel: 'CPUE (crabs/trap)', xIsDate: true, tooltipDateFormat });
  renderSvgChart('chart-effort', data.effortPoints, { mode: 'line', xLabel: 'date', yLabel: 'number of traps', xIsDate: true, tooltipDateFormat });
  renderSvgChart('chart-catch-total', data.totalCatchPoints, { mode: 'line', xLabel: 'date', yLabel: 'crab count', xIsDate: true, tooltipDateFormat });
}

function goToStep(step) {
  if (step > currentStep && !canEnterStep(step)) return;
  currentStep = step;
  stepViews.forEach((view) => view.classList.toggle('is-visible', Number(view.dataset.view) === step));
  stepLinks.forEach((link) => {
    const linkStep = Number(link.dataset.step);
    link.classList.toggle('is-active', linkStep === step);
    link.classList.toggle('is-complete', linkStep < step);
    link.disabled = linkStep > step && !canEnterStep(linkStep);
  });
  progressLabel.textContent = `Step ${step} of ${totalSteps}`;
  progressStatus.textContent = stepNames[step - 1];
  progressBar.style.width = `${(step / totalSteps) * 100}%`;
  window.location.hash = `step-${step}`;
  document.querySelector('.step-content').scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (step === 3) renderVisualizations();
  if (step === 6) loadScenarios();
}

document.querySelector('#run-quality-checks').addEventListener('change', (event) => {
  const list = document.querySelector('#quality-check-list');
  const confirmBox = document.querySelector('#data-confirmed');
  if (!event.target.checked) {
    list.hidden = true;
    list.innerHTML = '';
    confirmBox.checked = false;
    confirmBox.disabled = true;
    updateQualityCheckGating();
    return;
  }
  const results = runQualityChecks();
  const icons = { pass: '✓', warning: '!', error: '✕' };
  list.innerHTML = results.map((result) => `<li class="is-${result.status}"><span class="quality-check-icon" aria-hidden="true">${icons[result.status]}</span>${escapeHtml(result.message)}</li>`).join('');
  list.hidden = false;
  const hasErrors = results.some((result) => result.status === 'error');
  confirmBox.disabled = hasErrors;
  if (hasErrors) confirmBox.checked = false;
  updateQualityCheckGating();
});
document.querySelector('#data-confirmed').addEventListener('change', updateQualityCheckGating);

document.querySelectorAll('.chart-download-button').forEach((button) => button.addEventListener('click', () => {
  downloadChartAsPng(button.dataset.target, button.dataset.filename);
}));

document.querySelectorAll('.chart-year-select').forEach((select) => select.addEventListener('change', (event) => {
  selectedVisualizationYear = event.target.value === 'all' ? 'all' : Number(event.target.value);
  renderVisualizations();
}));

document.querySelectorAll('.next-button').forEach((button) => button.addEventListener('click', () => {
  const nextStep = Number(button.dataset.next);
  const error = document.querySelector('#upload-error');
  if (currentStep === 2 && (!uploadedData.catch || !uploadedData.effort || !document.querySelector('#data-confirmed').checked)) return showError(error, 'Upload both files, run data quality checks, and confirm that their previews look correct before continuing.');
  if (button.classList.contains('gated-next') && !button.closest('.step-view').querySelector('.step-check').checked) return;
  goToStep(nextStep);
}));
document.querySelector('#regime-next-button').addEventListener('click', () => {
  // the fit's kept-alive process is only useful to "Analyze results"; free
  // it now that the user is moving on
  releaseFit();
});
document.querySelectorAll('.back-button-control').forEach((button) => button.addEventListener('click', () => goToStep(Number(button.dataset.back))));
stepLinks.forEach((link) => link.addEventListener('click', () => goToStep(Number(link.dataset.step))));

document.querySelectorAll('.drop-zone').forEach((zone) => {
  const kind = zone.dataset.kind;
  const input = zone.querySelector('.file-input');
  zone.addEventListener('click', (event) => { if (event.target.tagName !== 'BUTTON') input.click(); });
  zone.querySelector('.browse-button').addEventListener('click', (event) => { event.stopPropagation(); input.click(); });
  zone.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.click(); } });
  input.addEventListener('change', () => handleFile(kind, input.files[0]));
  ['dragenter', 'dragover'].forEach((name) => zone.addEventListener(name, (event) => { event.preventDefault(); zone.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((name) => zone.addEventListener(name, (event) => { event.preventDefault(); zone.classList.remove('is-over'); }));
  zone.addEventListener('drop', (event) => handleFile(kind, event.dataTransfer.files[0]));
});

function formatDateForExport(date) {
  return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
}

function buildModelExportRows() {
  const catchCols = { date: selectedColumnIndex('catch', 'date'), size: selectedColumnIndex('catch', 'size'), trapType: selectedColumnIndex('catch', 'trap-type'), trapId: selectedColumnIndex('catch', 'trap-id') };
  const effortCols = { dateChecked: selectedColumnIndex('effort', 'date-checked'), trapType: selectedColumnIndex('effort', 'trap-type'), trapId: selectedColumnIndex('effort', 'trap-id') };
  const catchFormat = selectedDateFormat('catch', 'date');
  const effortFormat = selectedDateFormat('effort', 'date-checked');

  const catchRows = (uploadedData.catch?.filteredRows || []).map((row) => {
    const date = catchFormat ? parseDateWithFormat(row[catchCols.date], catchFormat) : null;
    const size = Number(row[catchCols.size]);
    if (!date || !Number.isFinite(size)) return null;
    return [formatDateForExport(date), row[catchCols.trapType], row[catchCols.trapId], size];
  }).filter(Boolean);

  const effortRows = (uploadedData.effort?.filteredRows || []).map((row) => {
    const date = effortFormat ? parseDateWithFormat(row[effortCols.dateChecked], effortFormat) : null;
    if (!date) return null;
    return [formatDateForExport(date), row[effortCols.trapType], row[effortCols.trapId]];
  }).filter(Boolean);

  return { catchRows, effortRows };
}

async function parseJsonResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error('The server did not return a valid response. Make sure the app is running via "node server.js" (not a plain static file server), since this feature needs its API.');
  }
}

// ---- this user's data, kept in the browser ----
// Model inputs, posterior samples and results live here, in the open page,
// not on the server, so people using the app at the same time can't see or
// overwrite each other's data. Each step sends the server what it needs and
// collects the outputs (see jobs.js); the server deletes them afterwards.
// Reloading or closing the page clears them.
const userData = {
  // { fitId, modelType, modelData, posterior, posteriorSummaryCsv, posteriorSummaryZip }
  fit: null,
  // { result, info, summaryZip, optionsZip }
  optimization: null,
  // saved optimization scenarios (see scenarioFromOptimization)
  scenarios: [],
};

// For the chatbot: the results to send with each question (see chat/chat.js)
function chatResults() {
  return {
    posteriorSummaryCsv: userData.fit?.posteriorSummaryCsv || null,
    analysis: analyzeData,
    optimization: userData.optimization?.result || null,
    scenarios: userData.scenarios,
  };
}

// ---- running steps on the server ----
// One job per step at a time; starting a new one cancels the old.
const activeJobs = { fit: null, analyze: null, optimize: null };
class JobCancelled extends Error {}

// Starts a server job, calls onProgress with its status as it runs (queued,
// then the R script's progress), and resolves with its outputs.
function runJob(kind, payload, onProgress) {
  cancelJob(kind);
  const handle = { id: null, cancelled: false };
  activeJobs[kind] = handle;
  const finish = () => { if (activeJobs[kind] === handle) activeJobs[kind] = null; };
  const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

  return (async () => {
    try {
      const startResponse = await fetch('api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: kind, ...payload }),
      });
      const started = await parseJsonResponse(startResponse);
      if (!startResponse.ok) throw new Error(started.error || 'Could not start the run.');
      handle.id = started.id;
      if (handle.cancelled) { deleteJob(handle.id); throw new JobCancelled(); }

      let failures = 0;
      for (;;) {
        if (handle.cancelled) throw new JobCancelled();
        let status;
        try {
          const response = await fetch(`api/jobs/${handle.id}`);
          status = await parseJsonResponse(response);
          if (!response.ok) throw new Error(status.error || 'Lost track of this run. Please run it again.');
          failures = 0;
        } catch (error) {
          // a brief network hiccup shouldn't end the run; a missing job should
          if (/run it again|interrupted/i.test(error.message) || ++failures > 20) throw error;
          await wait(1500);
          continue;
        }
        if (handle.cancelled) throw new JobCancelled();
        onProgress(status);
        if (status.status === 'failed') throw new Error(status.error || 'The run failed.');
        if (status.status === 'done') break;
        await wait(1500);
      }

      const resultResponse = await fetch(`api/jobs/${handle.id}/result`);
      const result = await parseJsonResponse(resultResponse);
      if (!resultResponse.ok) throw new Error(result.error || 'Could not collect the results.');
      if (handle.cancelled) throw new JobCancelled();
      return result;
    } catch (error) {
      // a failed run's files would otherwise wait on the server for the
      // hourly clean-up
      if (!(error instanceof JobCancelled)) deleteJob(handle.id);
      throw error;
    } finally {
      finish();
    }
  })();
}

function deleteJob(id, keepalive = false) {
  if (id) fetch(`api/jobs/${id}`, { method: 'DELETE', keepalive }).catch(() => {});
}

function cancelJob(kind) {
  const handle = activeJobs[kind];
  if (!handle) return;
  handle.cancelled = true;
  deleteJob(handle.id);
  activeJobs[kind] = null;
}

// frees the fit's kept-alive model process on the server (it only speeds up
// "Analyze results")
function releaseFit(keepalive = false) {
  if (userData.fit) deleteJob(userData.fit.fitId, keepalive);
}

// leaving the page: stop this user's runs so others don't wait behind them
window.addEventListener('pagehide', () => {
  Object.values(activeJobs).forEach((handle) => { if (handle) deleteJob(handle.id, true); });
  releaseFit(true);
});

// progress bar, title and message for a job's status
function showJobProgress(status, els, labels) {
  const percent = status.total > 0 ? Math.round((status.completed / status.total) * 100) : 0;
  els.bar.style.width = `${percent}%`;
  els.title.textContent = status.phase === 'queued' ? 'Waiting in line' : (labels[status.phase] || 'Running');
  els.copy.textContent = status.message || '';
}

// a zip sent by the server (base64) as the target of a download link
function setZipDownload(link, base64, filename) {
  if (link.href.startsWith('blob:')) URL.revokeObjectURL(link.href);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  link.href = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
  link.download = filename;
}

document.querySelector('#regime-run-button').addEventListener('click', (event) => {
  const button = event.currentTarget;
  const ring = document.querySelector('#regime-run-ring');
  const title = document.querySelector('#regime-run-title');
  const copy = document.querySelector('#regime-run-copy');
  const bar = document.querySelector('#regime-run-bar');
  const errorEl = document.querySelector('#regime-run-error');

  errorEl.hidden = true;
  document.querySelector('#regime-download-button').hidden = true;
  document.querySelector('#analyze-card').hidden = true;
  document.querySelector('#analyze-controls').hidden = true;
  document.querySelector('#analyze-results-panel').hidden = true;
  document.querySelector('#regime-next-button').disabled = true;
  // a new fit replaces everything that depended on the old one
  cancelJob('analyze');
  releaseFit();
  userData.fit = null;
  analyzeData = null;
  userData.scenarios = [];
  renderScenarios([]);
  resetOptimization();
  button.disabled = true;
  ring.classList.remove('is-done');
  bar.style.width = '0%';
  title.textContent = 'Preparing data';
  copy.textContent = 'Building model inputs from your catch and effort data...';

  const { catchRows, effortRows } = buildModelExportRows();
  if (!catchRows.length || !effortRows.length) {
    showError(errorEl, 'No valid catch or effort rows are available to run the model.');
    button.disabled = false;
    return;
  }

  const PHASE_LABELS = { preparing: 'Preparing data', compiling: 'Building and compiling the model', sampling: 'Sampling', saving: 'Saving results' };
  runJob('fit', { catchRows, effortRows }, (status) => showJobProgress(status, { bar, title, copy }, PHASE_LABELS))
    .then((result) => {
      userData.fit = result;
      ring.classList.add('is-done');
      title.textContent = 'Model run complete';
      copy.textContent = 'Posterior samples are ready.';
      bar.style.width = '100%';
      const download = document.querySelector('#regime-download-button');
      setZipDownload(download, result.posteriorSummaryZip, 'posterior_summary.zip');
      download.hidden = false;
      document.querySelector('#analyze-card').hidden = false;
    })
    .catch((error) => {
      if (error instanceof JobCancelled) return;
      showError(errorEl, error.message);
      title.textContent = 'Model run failed';
    })
    .finally(() => { button.disabled = false; });
});

let analyzeData = null;

function populateAnalysisControls() {
  const yearSelect = document.querySelector('#analyze-year-select');
  yearSelect.innerHTML = analyzeData.years.map((year, index) => `<option value="${index + 1}">${year}</option>`).join('');
  const timeSlider = document.querySelector('#analyze-time-slider');
  timeSlider.min = '1';
  timeSlider.max = String(analyzeData.nOcc);
  timeSlider.value = '1';
}

function renderAnalysisCharts() {
  if (!analyzeData) return;
  const yearIndex = Number(document.querySelector('#analyze-year-select').value) - 1;
  const timeIndex = Number(document.querySelector('#analyze-time-slider').value) - 1;
  document.querySelector('#analyze-time-label').textContent = formatDateShort(julianDayToDate(analyzeData.biweek[timeIndex]));

  const sizeCategories = analyzeData.x;
  const nMed = analyzeData.N_med[timeIndex][yearIndex];
  const nLo = analyzeData.N_lo[timeIndex][yearIndex];
  const nHi = analyzeData.N_hi[timeIndex][yearIndex];
  const abundanceValues = sizeCategories.map((_, i) => ({ value: nMed[i], lo: nLo[i], hi: nHi[i] }));
  // fixed across time periods (within the selected year) so the axis doesn't
  // rescale as the time slider moves, making magnitudes comparable
  const abundanceMaxY = Math.max(0, ...analyzeData.N_hi.map((occRow) => Math.max(...occRow[yearIndex])));
  renderBarChart('chart-abundance', sizeCategories, abundanceValues, {
    xLabel: 'carapace width (mm)', yLabel: 'estimated abundance', color: '#4a9974', maxY: abundanceMaxY,
  });

  const totalMed = analyzeData.tot_med[timeIndex][yearIndex];
  const totalLo = analyzeData.tot_lo[timeIndex][yearIndex];
  const totalHi = analyzeData.tot_hi[timeIndex][yearIndex];
  document.querySelector('#abundance-total-label').textContent = `Total: ${Math.round(totalMed)} (${Math.round(totalLo)}, ${Math.round(totalHi)} 95% CrI)`;

  const cpueVals = analyzeData.cpue[timeIndex][yearIndex];
  const cpueValues = sizeCategories.map((_, i) => ({ value: cpueVals[i] }));
  const cpueValuesForYear = analyzeData.cpue.flatMap((occRow) => occRow[yearIndex].filter((v) => Number.isFinite(v)));
  const cpueMaxY = cpueValuesForYear.length ? Math.max(...cpueValuesForYear) : 0;
  renderBarChart('chart-cpue-size', sizeCategories, cpueValues, {
    xLabel: 'carapace width (mm)', yLabel: 'captured crabs / trap (CPUE)', color: '#c9932b',
    emptyMessage: 'No observations for this year and time period.',
    maxY: cpueMaxY, yAxisFormatter: (value) => formatSignificant(value, 2),
  });
}

// ---- "What to plot" in Analyze results ----
// Switches between the size-structured abundance charts, overwinter
// survival (only offered when a winter between consecutive years can be
// estimated) and the adults / recruits box plots.
function overwinterAvailable() {
  const ow = analyzeData?.overwinter;
  return Boolean(ow && ow.available && ow.winters && ow.winters.length);
}

function setupAnalysisViews() {
  const select = document.querySelector('#analysis-view-select');
  const overwinterOption = select.querySelector('option[value="overwinter"]');
  const available = overwinterAvailable();
  overwinterOption.hidden = !available;
  overwinterOption.disabled = !available;
  if (!available && select.value === 'overwinter') select.value = 'size';
  showAnalysisView(select.value);
}

function showAnalysisView(view) {
  document.querySelectorAll('[data-analysis-view]').forEach((el) => { el.hidden = el.dataset.analysisView !== view; });
  if (view === 'population') renderPopulationCharts();
}

document.querySelector('#analysis-view-select').addEventListener('change', (event) => showAnalysisView(event.target.value));

const BOX_NOTE = 'Boxes show the middle 50% of posterior samples, the line inside each box the median, and the whiskers the 95% credible interval.';

// Box-and-whisker chart of posterior summaries ({ lo, q1, median, q3, hi }).
// `groups` are x-axis categories, each with one or more boxes
// ({ name, stats, color }); boxes with the same name share a colour and a
// legend entry.
function renderBoxChart(mountId, groups, { yLabel, format = formatCount, yMax = null, tooltipFormat = format } = {}) {
  const mount = document.querySelector(`#${mountId}`);
  const names = [...new Set(groups.flatMap((g) => g.boxes.map((b) => b.name)))];
  const showLegend = names.length > 1;
  // sized to the results column so the text isn't shrunk
  const width = 440;
  const plotHeight = 210;
  const legendHeight = showLegend ? 22 : 0;
  const margin = { top: 14 + legendHeight, right: 10, bottom: 34, left: 64 };
  const height = margin.top + plotHeight + margin.bottom;
  const innerWidth = width - margin.left - margin.right;
  const top = yMax ?? Math.max(...groups.flatMap((g) => g.boxes.map((b) => b.stats.hi)));
  const ticks = yMax !== null ? [0, 0.25, 0.5, 0.75, 1].map((t) => t * yMax) : roundTicks(0, top, 4);
  const max = ticks[ticks.length - 1] || 1;
  const yScale = (value) => margin.top + plotHeight - (value / max) * plotHeight;
  const slot = innerWidth / groups.length;
  const perGroup = Math.max(...groups.map((g) => g.boxes.length));
  const boxWidth = Math.min(46, (slot * 0.7) / perGroup);
  const lineColor = cssVar('--line');
  const mutedColor = cssVar('--muted');
  const inkColor = cssVar('--ink');
  const axisY = margin.top + plotHeight;

  let legend = '';
  if (showLegend) {
    let lx = margin.left;
    names.forEach((name) => {
      const color = groups.flatMap((g) => g.boxes).find((b) => b.name === name).color;
      legend += `<rect x="${lx}" y="4" width="11" height="11" rx="2" fill="${color}" fill-opacity="0.35" stroke="${color}" /><text x="${lx + 16}" y="13" font-size="11" fill="${mutedColor}">${escapeHtml(name)}</text>`;
      lx += 22 + name.length * 6.5;
    });
  }
  const grid = ticks.map((t) => `<line x1="${margin.left}" x2="${width - margin.right}" y1="${yScale(t)}" y2="${yScale(t)}" stroke="${lineColor}" />`
    + `<text x="${margin.left - 8}" y="${yScale(t) + 4}" text-anchor="end" font-size="11" fill="${mutedColor}">${format(t)}</text>`).join('');
  const marks = groups.map((group, g) => {
    const center = margin.left + slot * (g + 0.5);
    const boxes = group.boxes.map((box, k) => {
      const x = center - (group.boxes.length * boxWidth) / 2 + k * boxWidth + boxWidth / 2;
      const half = boxWidth * 0.4;
      const st = box.stats;
      const tooltip = `${group.label}${box.name ? ` · ${box.name}` : ''}\nmedian: ${tooltipFormat(st.median)}\nmiddle 50%: ${tooltipFormat(st.q1)} to ${tooltipFormat(st.q3)}\n95% CrI: ${tooltipFormat(st.lo)} to ${tooltipFormat(st.hi)}`;
      return `<line x1="${x}" x2="${x}" y1="${yScale(st.hi)}" y2="${yScale(st.q3)}" stroke="${box.color}" stroke-width="1.5" />`
        + `<line x1="${x}" x2="${x}" y1="${yScale(st.q1)}" y2="${yScale(st.lo)}" stroke="${box.color}" stroke-width="1.5" />`
        + `<line x1="${x - half / 2}" x2="${x + half / 2}" y1="${yScale(st.hi)}" y2="${yScale(st.hi)}" stroke="${box.color}" stroke-width="1.5" />`
        + `<line x1="${x - half / 2}" x2="${x + half / 2}" y1="${yScale(st.lo)}" y2="${yScale(st.lo)}" stroke="${box.color}" stroke-width="1.5" />`
        + `<rect class="chart-point" x="${x - half}" y="${yScale(st.q3)}" width="${half * 2}" height="${Math.max(1, yScale(st.q1) - yScale(st.q3))}" fill="${box.color}" fill-opacity="0.3" stroke="${box.color}" stroke-width="1.5" data-tooltip="${escapeHtml(tooltip)}"></rect>`
        + `<line x1="${x - half}" x2="${x + half}" y1="${yScale(st.median)}" y2="${yScale(st.median)}" stroke="${box.color}" stroke-width="2.5" />`;
    }).join('');
    return boxes + `<text x="${center}" y="${axisY + 18}" text-anchor="middle" font-size="11" fill="${inkColor}">${escapeHtml(group.label)}</text>`;
  }).join('');
  const plotMid = margin.top + plotHeight / 2;
  mount.innerHTML = `<svg viewBox="0 0 ${width} ${height}" font-family="'DM Sans', Arial, sans-serif" role="img" aria-label="${escapeHtml(yLabel)}">
    <rect x="0" y="0" width="${width}" height="${height}" fill="white" />
    ${legend}
    ${grid}
    <line x1="${margin.left}" x2="${width - margin.right}" y1="${axisY}" y2="${axisY}" stroke="${mutedColor}" stroke-opacity="0.5" />
    ${marks}
    <text x="14" y="${plotMid}" text-anchor="middle" font-size="12" fill="${mutedColor}" transform="rotate(-90 14 ${plotMid})">${escapeHtml(yLabel)}</text>
  </svg>`;
  attachChartInteractions(mount);
}

function renderPopulationCharts() {
  const pop = analyzeData?.population;
  const note = document.querySelector('#population-note');
  const panels = ['#recruits-panel', '#adults-panel', '#pulses-panel'].map((id) => document.querySelector(id));
  if (!pop) {
    // results from before this view existed don't include these summaries
    note.textContent = 'These charts need the latest analysis. Click "Analyze results" again to see them.';
    note.hidden = false;
    panels.forEach((panel) => { panel.hidden = true; });
    return;
  }
  note.hidden = true;
  panels.forEach((panel) => { panel.hidden = false; });

  const recruitColor = '#3e4989';
  const adultColor = '#4a9974';
  renderBoxChart('chart-recruits', pop.recruits.map((r) => ({ label: String(r.year), boxes: [{ stats: r, color: recruitColor }] })),
    { yLabel: 'recruits' });
  renderBoxChart('chart-adults', pop.adults.map((a) => ({ label: String(a.year), boxes: [{ stats: a, color: adultColor }] })),
    { yLabel: 'adults' });

  const [day1, day2] = pop.pulse_days.map((day) => formatDateShort(julianDayToDate(day)));
  const firstColor = '#31688e';
  const secondColor = '#6ece58';
  const percent = (value) => `${Math.round(value * 100)}%`;
  const percentDetailed = (value) => `${(value * 100).toFixed(1)}%`;
  const groups = pop.pulses_by_year
    ? pop.pulses.map((p) => ({ label: String(p.year), boxes: [
      { name: `${day1} pulse`, stats: p.first, color: firstColor },
      { name: `${day2} pulse`, stats: p.second, color: secondColor }] }))
    : [{ label: `${day1} pulse`, boxes: [{ stats: pop.pulses[0].first, color: firstColor }] },
      { label: `${day2} pulse`, boxes: [{ stats: pop.pulses[0].second, color: secondColor }] }];
  renderBoxChart('chart-pulses', groups, { yLabel: 'proportion of recruits', yMax: 1, format: percent, tooltipFormat: percentDetailed });
  document.querySelector('#pulses-note').textContent = `The proportion of each year's recruits that enter the population in each of the model's two recruitment pulses, on ${day1} and ${day2}. The two proportions add up to 100%.`
    + (pop.pulses_by_year ? ' Each year has its own split.' : ' The model estimates one split that applies to every year.')
    + ` ${BOX_NOTE}`;
}

// viridis colour scale (stopping short of the pale yellow end, which is hard
// to see on white), sampled at t in [0, 1]
const VIRIDIS_STOPS = ['#440154', '#482878', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b'];
function viridisColor(t) {
  const pos = Math.min(1, Math.max(0, t)) * (VIRIDIS_STOPS.length - 1);
  const i = Math.min(VIRIDIS_STOPS.length - 2, Math.floor(pos));
  const f = pos - i;
  const rgb = (hex) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
  const a = rgb(VIRIDIS_STOPS[i]);
  const b = rgb(VIRIDIS_STOPS[i + 1]);
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',')})`;
}

// "Explore overwinter survival": posterior median and 95% credible band of
// overwinter survival by size, one line per winter that the data can inform
// (a winter followed by the next calendar year's data). Only shown when
// multiple years were uploaded.
function renderOverwinterChart() {
  const panel = document.querySelector('#overwinter-panel');
  const note = document.querySelector('#overwinter-note');
  const mount = document.querySelector('#chart-overwinter');
  const ow = analyzeData?.overwinter;
  panel.hidden = !ow;
  if (!ow) return;

  const years = ow.years;
  // winters before a gap in the uploaded years can't be estimated
  const gapWinters = years.slice(0, -1).filter((year, i) => years[i + 1] !== year + 1).map((year) => `${year} to ${year + 1}`);
  if (!ow.available || !ow.winters.length) {
    note.textContent = `None of the uploaded years (${years.join(', ')}) are consecutive, so overwinter survival can't be estimated from these data.`;
    mount.innerHTML = '';
    return;
  }
  note.textContent = 'Lines show the posterior median and shaded bands the 95% credible interval of the probability that a crab of a given size survives the winter.'
    + (gapWinters.length ? ` Winters before a gap in the uploaded years (${gapWinters.join(', ')}) can't be estimated and are not shown.` : '');

  const width = 440;
  const plotHeight = 240;
  const legendRowHeight = 18;
  const legendPerRow = 3;
  const legendHeight = 10 + Math.ceil(ow.winters.length / legendPerRow) * legendRowHeight;
  const height = plotHeight + legendHeight;
  const margin = { top: 12, right: 16, bottom: 32, left: 46 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = plotHeight - margin.top - margin.bottom;
  const lineColor = cssVar('--line');
  const mutedColor = cssVar('--muted');
  const sizes = ow.x;

  // x axis spans the full size range (bin midpoints +/- half a bin), with
  // ticks every 20 mm
  const halfBin = (sizes[1] - sizes[0]) / 2 || 0;
  const xMin = sizes[0] - halfBin;
  const xMax = sizes[sizes.length - 1] + halfBin;
  const xTicks = [];
  for (let t = Math.ceil(xMin / 20) * 20; t <= xMax; t += 20) xTicks.push(t);
  const yTicks = [0, 0.2, 0.4, 0.6, 0.8, 1];
  const xScale = (x) => margin.left + ((x - xMin) / (xMax - xMin || 1)) * innerWidth;
  const yScale = (y) => margin.top + innerHeight - y * innerHeight;

  const gridLines = yTicks.map((tick) => `<line x1="${margin.left}" x2="${width - margin.right}" y1="${yScale(tick)}" y2="${yScale(tick)}" stroke="${lineColor}" stroke-width="1" />`).join('');
  const yAxisLabels = yTicks.map((tick) => `<text x="${margin.left - 8}" y="${yScale(tick) + 3}" text-anchor="end" font-size="9" fill="${mutedColor}">${tick.toFixed(1)}</text>`).join('');
  const xAxisLabels = xTicks.map((tick) => `<text x="${xScale(tick)}" y="${plotHeight - margin.bottom + 16}" text-anchor="middle" font-size="9" fill="${mutedColor}">${tick}</text>`).join('');

  const colorFor = (i) => viridisColor(ow.winters.length === 1 ? 0.5 : i / (ow.winters.length - 1));
  let bands = '';
  let lines = '';
  let points = '';
  let legend = '';
  ow.winters.forEach((winter, i) => {
    const color = colorFor(i);
    const upper = sizes.map((x, k) => `${xScale(x)},${yScale(winter.hi[k])}`);
    const lower = sizes.map((x, k) => `${xScale(x)},${yScale(winter.lo[k])}`).reverse();
    bands += `<polygon points="${[...upper, ...lower].join(' ')}" fill="${color}" fill-opacity="0.2" stroke="none" />`;
    lines += `<polyline points="${sizes.map((x, k) => `${xScale(x)},${yScale(winter.median[k])}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2" />`;
    points += sizes.map((x, k) => {
      const tooltip = `${winter.label}\nsize: ${formatAxisNumber(x)} mm\nsurvival: ${winter.median[k].toFixed(2)} (${winter.lo[k].toFixed(2)}, ${winter.hi[k].toFixed(2)} 95% CrI)`;
      return `<circle class="chart-point" cx="${xScale(x)}" cy="${yScale(winter.median[k])}" r="2.5" fill="${color}" data-tooltip="${escapeHtml(tooltip)}"></circle>`;
    }).join('');
    const lx = margin.left + (i % legendPerRow) * 120;
    const ly = plotHeight + 14 + Math.floor(i / legendPerRow) * legendRowHeight;
    legend += `<line x1="${lx}" x2="${lx + 16}" y1="${ly - 3}" y2="${ly - 3}" stroke="${color}" stroke-width="3" /><text x="${lx + 22}" y="${ly}" font-size="10" fill="${mutedColor}">${escapeHtml(winter.label)}</text>`;
  });

  mount.innerHTML = `<svg viewBox="0 0 ${width} ${height}" font-family="'DM Sans', Arial, sans-serif" role="img" aria-label="overwinter survival by size">
    ${gridLines}
    <line x1="${margin.left}" x2="${margin.left}" y1="${margin.top}" y2="${plotHeight - margin.bottom}" stroke="${lineColor}" />
    <line x1="${margin.left}" x2="${width - margin.right}" y1="${plotHeight - margin.bottom}" y2="${plotHeight - margin.bottom}" stroke="${lineColor}" />
    ${yAxisLabels}
    ${xAxisLabels}
    ${bands}
    ${lines}
    ${points}
    <text x="${margin.left + innerWidth / 2}" y="${plotHeight - 4}" text-anchor="middle" font-size="10" fill="${mutedColor}">carapace width (mm)</text>
    <text x="12" y="${margin.top + innerHeight / 2}" text-anchor="middle" font-size="10" fill="${mutedColor}" transform="rotate(-90 12 ${margin.top + innerHeight / 2})">overwinter survival</text>
    ${legend}
  </svg>`;
  attachChartInteractions(mount);
}

document.querySelector('#analyze-year-select').addEventListener('change', renderAnalysisCharts);
document.querySelector('#analyze-time-slider').addEventListener('input', renderAnalysisCharts);

document.querySelector('#analyze-run-button').addEventListener('click', (event) => {
  const button = event.currentTarget;
  const ring = document.querySelector('#analyze-run-ring');
  const title = document.querySelector('#analyze-run-title');
  const copy = document.querySelector('#analyze-run-copy');
  const bar = document.querySelector('#analyze-run-bar');
  const errorEl = document.querySelector('#analyze-run-error');
  const panel = document.querySelector('#analyze-results-panel');

  errorEl.hidden = true;
  if (!userData.fit) {
    showError(errorEl, 'Run the population model first.');
    return;
  }
  panel.hidden = true;
  button.disabled = true;
  ring.classList.remove('is-done');
  bar.style.width = '0%';
  title.textContent = 'Starting analysis';
  copy.textContent = 'Sending your model results to the server...';

  const PHASE_LABELS = { preparing: 'Preparing data', compiling: 'Building and compiling the model', simulating: 'Simulating', saving: 'Saving results' };
  const { fitId, modelData, posterior } = userData.fit;
  runJob('analyze', { fitId, modelData, posterior }, (status) => showJobProgress(status, { bar, title, copy }, PHASE_LABELS))
    .then((result) => {
      analyzeData = result.analysis;
      ring.classList.add('is-done');
      title.textContent = 'Analysis complete';
      copy.textContent = 'Use "What to plot" to explore the results.';
      bar.style.width = '100%';
      populateAnalysisControls();
      document.querySelector('#analyze-controls').hidden = false;
      panel.hidden = false;
      renderAnalysisCharts();
      renderOverwinterChart();
      setupAnalysisViews();
      document.querySelector('#regime-next-button').disabled = false;
    })
    .catch((error) => {
      if (error instanceof JobCancelled) return;
      showError(errorEl, error.message);
      title.textContent = 'Analysis failed';
    })
    .finally(() => { button.disabled = false; });
});

// Trapping effort is counted in Fukui traps' worth: the Fukui trap is the
// reference (fixed at 1) and every other trap's effort is a whole-number
// multiple of it, so 1 is the floor for every input.
const pluralTraps = (n, type) => `${n} ${type} trap${n === 1 ? '' : 's'}`;

// trap types the user has marked available in "Set your constraints"
const availableTrapTypes = () => [...document.querySelectorAll('.objective-trap-type:checked')].map((box) => box.value);
// trapping occasions (biweeks) in the planning season
const N_BIWEEKS = BIWEEK_BREAKS.length - 1;

// "With this effort you could set, for example: ..." under the inputs, so
// the trade-off between trap types is concrete; only uses available types
function updateEffortExample() {
  const budget = Math.floor(Number(document.querySelector('#objective-budget').value));
  const shrimp = Number(document.querySelector('#objective-cost-shrimp').value);
  const minnow = Number(document.querySelector('#objective-cost-minnow').value);
  const el = document.querySelector('#effort-example');
  if (!(budget >= 1 && shrimp >= 1 && minnow >= 1)) { el.hidden = true; return; }
  const available = availableTrapTypes();
  const hasF = available.includes('fukui'), hasM = available.includes('minnow'), hasS = available.includes('shrimp');
  const examples = [];
  if (hasF && hasM && minnow === 1) {
    examples.push(`${budget} Fukui and minnow traps in any mix`);
  } else {
    if (hasF) examples.push(pluralTraps(budget, 'Fukui'));
    if (hasM && Math.floor(budget / minnow) >= 1) examples.push(pluralTraps(Math.floor(budget / minnow), 'minnow'));
  }
  if (hasS && Math.floor(budget / shrimp) >= 1) examples.push(pluralTraps(Math.floor(budget / shrimp), 'shrimp'));
  // roughly half the effort on each of Fukui and shrimp traps
  const halfShrimp = Math.floor(budget / (2 * shrimp));
  if (hasF && hasS && halfShrimp >= 1 && budget - halfShrimp * shrimp >= 1) {
    examples.push(`${budget - halfShrimp * shrimp} Fukui + ${pluralTraps(halfShrimp, 'shrimp')}`);
  }
  el.innerHTML = examples.length
    ? `With this effort you could set, for example: ${examples.map((text) => `<strong>${text}</strong>`).join(', or ')}. The optimizer chooses the mix and timing that leaves the fewest crabs.`
    : 'This effort isn’t enough to set one trap of the available types. Increase your effort or make more trap types available.';
  el.hidden = false;
}

// "Maximum traps per biweek" slider, in Fukui traps' worth: from the budget
// spread evenly over every biweek up to the whole budget (no limit). Keeps
// "no limit" when the budget changes if it was already at no limit.
function updateMaxBiweekSlider() {
  const slider = document.querySelector('#objective-max-biweek');
  const budget = Math.max(1, Math.floor(Number(document.querySelector('#objective-budget').value)) || 1);
  const wasNoLimit = Number(slider.value) >= Number(slider.max);
  const min = Math.max(1, Math.ceil(budget / N_BIWEEKS));
  slider.min = String(min);
  slider.max = String(budget);
  if (wasNoLimit) slider.value = String(budget);
  else slider.value = String(Math.min(budget, Math.max(min, Number(slider.value))));
  updateMaxBiweekLabels();
}

function updateMaxBiweekLabels() {
  const slider = document.querySelector('#objective-max-biweek');
  const value = Number(slider.value);
  const worth = (n) => `${n} Fukui trap${n === 1 ? '' : 's'}' worth`;
  document.querySelector('#objective-max-biweek-value').textContent =
    value >= Number(slider.max) ? `No limit (${worth(value)})` : worth(value);
  document.querySelector('#objective-max-biweek-min').textContent = `${slider.min} (spread evenly)`;
  document.querySelector('#objective-max-biweek-max').textContent = `${slider.max} (no limit)`;
  // example using the current value and shrimp effort
  const shrimp = Number(document.querySelector('#objective-cost-shrimp').value) || 1;
  const shrimpTraps = Math.floor(value / shrimp);
  document.querySelector('#objective-max-biweek-example').textContent =
    `For example, a maximum of ${value} allows up to ${pluralTraps(value, 'Fukui')}` +
    (shrimp > 1 ? `, or ${pluralTraps(shrimpTraps, 'shrimp')} (at ${shrimp} each),` : '') +
    ' in one biweek.';
}

document.querySelectorAll('#objective-cost-shrimp, #objective-cost-minnow, #objective-budget').forEach((input) => {
  input.addEventListener('input', () => {
    updateEffortExample();
    if (input.id === 'objective-budget') updateMaxBiweekSlider(); else updateMaxBiweekLabels();
  });
  input.addEventListener('change', () => {
    const value = Number(input.value);
    if (!Number.isFinite(value) || value < 1) input.value = '1';
    else if (!Number.isInteger(value)) input.value = String(Math.round(value));
    updateEffortExample();
    updateMaxBiweekSlider();
    // a changed objective makes any previous optimization out of date
    resetOptimization();
  });
});

document.querySelector('#objective-max-biweek').addEventListener('input', updateMaxBiweekLabels);
document.querySelector('#objective-max-biweek').addEventListener('change', () => resetOptimization());

// at least one trap type must stay available; an unavailable type's effort
// input is disabled since it isn't used
document.querySelectorAll('.objective-trap-type').forEach((box) => {
  box.addEventListener('change', () => {
    const errorEl = document.querySelector('#trap-type-error');
    if (!availableTrapTypes().length) {
      box.checked = true;
      showError(errorEl, 'At least one trap type must be selected.');
      return;
    }
    errorEl.hidden = true;
    const costInput = document.querySelector(`#objective-cost-${box.value}`);
    if (box.value !== 'fukui') costInput.disabled = !box.checked;
    updateEffortExample();
    resetOptimization();
  });
});

updateEffortExample();
updateMaxBiweekSlider();

document.querySelector('#optimize-run-button').addEventListener('click', (event) => {
  const button = event.currentTarget;
  const ring = document.querySelector('#optimize-run-ring');
  const title = document.querySelector('#optimize-run-title');
  const copy = document.querySelector('#optimize-run-copy');
  const bar = document.querySelector('#optimize-run-bar');
  const errorEl = document.querySelector('#optimize-run-error');

  errorEl.hidden = true;
  if (!userData.fit) {
    showError(errorEl, 'Run the population model first.');
    return;
  }
  hideOptimizationResults();
  userData.optimization = null;
  button.disabled = true;
  ring.classList.remove('is-done');
  bar.style.width = '0%';
  title.textContent = 'Preparing data';
  copy.textContent = 'Sending your model results to the server...';

  const settings = {
    budget: Number(document.querySelector('#objective-budget').value),
    costFukui: Number(document.querySelector('#objective-cost-fukui').value),
    costShrimp: Number(document.querySelector('#objective-cost-shrimp').value),
    costMinnow: Number(document.querySelector('#objective-cost-minnow').value),
    allowedTypes: availableTrapTypes(),
    maxPerBiweek: Number(document.querySelector('#objective-max-biweek').value),
  };
  const PHASE_LABELS = { preparing: 'Preparing data', optimizing: 'Optimizing trap allocation', polishing: 'Refining trap schedule', scoring: 'Comparing trap schedules', saving: 'Saving results' };
  const { modelData, posterior } = userData.fit;
  runJob('optimize', { modelData, posterior, settings }, (status) => showJobProgress(status, { bar, title, copy }, PHASE_LABELS))
    .then((result) => {
      userData.optimization = result;
      ring.classList.add('is-done');
      title.textContent = 'Optimization complete';
      copy.textContent = 'Trap schedule saved.';
      bar.style.width = '100%';
      optimizationVersion = Date.now();
      loadOptimizationResults();
    })
    .catch((error) => {
      if (error instanceof JobCancelled) return;
      showError(errorEl, error.message);
      title.textContent = 'Optimization failed';
    })
    .finally(() => { button.disabled = false; });
});

// ---- Optimization results (shown on step 6 once a run completes) ----
// R computes the results (optimize_traps.R); the charts are drawn here, in
// the same style as the other charts. `optimizationVersion` changes with each
// completed optimization so the results are fetched again.
let optimizationVersion = 0;
let loadedResultsVersion = null;
let optimizationInfo = null;

const TRAP_ORDER = ['fukui', 'minnow', 'shrimp'];
const trapLabel = (type) => (type === 'fukui' ? 'Fukui' : type[0].toUpperCase() + type.slice(1));
const optionLabel = (index) => (index === 0 ? 'Optimal' : `Option ${index + 1}`);

// Number of traps of each type on each date, as grouped bars. One panel per
// entry in `panels` ({ label, schedule }), stacked with a shared y axis. With
// `usedDatesOnly`, only dates where some panel sets traps are shown.
function renderScheduleChart(mountId, occasions, panels, { usedDatesOnly = false } = {}) {
  const mount = document.querySelector(`#${mountId}`);
  let dateIndexes = occasions.map((_, i) => i);
  if (usedDatesOnly) {
    const used = dateIndexes.filter((i) => panels.some((panel) => TRAP_ORDER.some((type) => (panel.schedule[type] || [])[i] > 0)));
    if (used.length) dateIndexes = used;
  }
  const maxCount = Math.max(1, ...panels.flatMap((panel) => TRAP_ORDER.flatMap((type) => dateIndexes.map((i) => (panel.schedule[type] || [])[i] || 0))));
  const ticks = roundTicks(0, maxCount, 4).filter((t) => Number.isInteger(t));
  const yMax = ticks[ticks.length - 1];

  const width = 520;
  const multi = panels.length > 1;
  const panelHeight = multi ? 120 : 250;
  const panelGap = multi ? 28 : 0;
  const legendHeight = 22;
  const margin = { top: legendHeight + (multi ? 20 : 10), right: 10, bottom: 66, left: 50 };
  const innerWidth = width - margin.left - margin.right;
  const height = margin.top + panels.length * panelHeight + (panels.length - 1) * panelGap + margin.bottom;
  const slot = innerWidth / dateIndexes.length;
  const barWidth = Math.min(16, (slot * 0.84) / 3);
  const lineColor = cssVar('--line');
  const mutedColor = cssVar('--muted');
  const inkColor = cssVar('--ink');

  // legend across the top
  let legend = '';
  let lx = margin.left;
  TRAP_ORDER.forEach((type) => {
    legend += `<rect x="${lx}" y="3" width="11" height="11" rx="2" fill="${TRAP_COLORS[type]}" /><text x="${lx + 16}" y="13" font-size="12" fill="${mutedColor}">${trapLabel(type)}</text>`;
    lx += 78;
  });

  let body = '';
  panels.forEach((panel, p) => {
    const top = margin.top + p * (panelHeight + panelGap);
    const bottom = top + panelHeight;
    const yScale = (value) => bottom - (value / yMax) * panelHeight;
    if (multi) body += `<text x="${margin.left}" y="${top - 6}" font-size="13" font-weight="600" fill="${inkColor}">${escapeHtml(panel.label)}</text>`;
    body += ticks.map((t) => `<line x1="${margin.left}" x2="${width - margin.right}" y1="${yScale(t)}" y2="${yScale(t)}" stroke="${lineColor}" />`
      + `<text x="${margin.left - 8}" y="${yScale(t) + 4}" text-anchor="end" font-size="11" fill="${mutedColor}">${t}</text>`).join('');
    dateIndexes.forEach((i, k) => {
      const present = TRAP_ORDER.filter((type) => (panel.schedule[type] || [])[i] > 0);
      const center = margin.left + slot * (k + 0.5);
      present.forEach((type, j) => {
        const count = panel.schedule[type][i];
        const x = center - (present.length * barWidth) / 2 + j * barWidth;
        const tooltip = `${multi ? `${panel.label}\n` : ''}${occasions[i]}\n${trapLabel(type)}: ${count} trap${count === 1 ? '' : 's'}`;
        body += `<rect class="chart-point" x="${x}" y="${yScale(count)}" width="${Math.max(1, barWidth - 1)}" height="${bottom - yScale(count)}" fill="${TRAP_COLORS[type]}" data-tooltip="${escapeHtml(tooltip)}"></rect>`;
      });
    });
    body += `<line x1="${margin.left}" x2="${width - margin.right}" y1="${bottom}" y2="${bottom}" stroke="${mutedColor}" stroke-opacity="0.5" />`;
  });

  const axisY = margin.top + panels.length * panelHeight + (panels.length - 1) * panelGap;
  const xLabels = dateIndexes.map((i, k) => {
    const x = margin.left + slot * (k + 0.5);
    return `<text x="${x}" y="${axisY + 14}" text-anchor="end" font-size="11" fill="${mutedColor}" transform="rotate(-45 ${x} ${axisY + 14})">${occasions[i]}</text>`;
  }).join('');
  const plotMid = margin.top + (axisY - margin.top) / 2;

  mount.innerHTML = `<svg viewBox="0 0 ${width} ${height}" font-family="'DM Sans', Arial, sans-serif" role="img" aria-label="number of traps of each type set on each date">
    <rect x="0" y="0" width="${width}" height="${height}" fill="white" />
    ${legend}
    ${body}
    ${xLabels}
    <text x="${margin.left + innerWidth / 2}" y="${height - 4}" text-anchor="middle" font-size="12" fill="${mutedColor}">date</text>
    <text x="13" y="${plotMid}" text-anchor="middle" font-size="12" fill="${mutedColor}" transform="rotate(-90 13 ${plotMid})">number of traps</text>
  </svg>`;
  attachChartInteractions(mount);
}

// Expected abundance at the start of next season (dot) and its 95% credible
// interval (error bar) for each option and for no trapping, labelled with
// the value and interval, and each option's reduction vs no trapping.
function renderAbundanceChart(mountId, rows) {
  const mount = document.querySelector(`#${mountId}`);
  // wide left margin so the y-axis title clears the tick labels
  const margin = { top: 40, right: 8, bottom: 52, left: 72 };
  // narrower columns when comparing several options
  const columnWidth = rows.length > 2 ? 76 : 96;
  const width = margin.left + margin.right + rows.length * columnWidth;
  const plotHeight = 230;
  const height = margin.top + plotHeight + margin.bottom;
  const ticks = roundTicks(0, Math.max(...rows.map((row) => row.hi)), 4);
  const yMax = ticks[ticks.length - 1];
  const yScale = (value) => margin.top + plotHeight - (value / yMax) * plotHeight;
  const lineColor = cssVar('--line');
  const mutedColor = cssVar('--muted');
  const inkColor = cssVar('--ink');
  const axisY = margin.top + plotHeight;

  const grid = ticks.map((t) => `<line x1="${margin.left}" x2="${width - margin.right}" y1="${yScale(t)}" y2="${yScale(t)}" stroke="${lineColor}" />`
    + `<text x="${margin.left - 8}" y="${yScale(t) + 4}" text-anchor="end" font-size="11" fill="${mutedColor}">${formatCount(t)}</text>`).join('');
  const marks = rows.map((row, i) => {
    const x = margin.left + columnWidth * (i + 0.5);
    const color = row.reference ? mutedColor : inkColor;
    const tooltip = `${row.label}\nexpected abundance: ${formatCount(row.mean)}`
      + (row.hasInterval ? `\n95% CrI ${formatCount(row.lo)} to ${formatCount(row.hi)}` : '')
      + (row.reduction !== null ? `\n${(100 * row.reduction).toFixed(1)}% reduction vs no trapping` : '');
    return (row.hasInterval
      ? `<line x1="${x}" x2="${x}" y1="${yScale(row.lo)}" y2="${yScale(row.hi)}" stroke="${color}" stroke-width="1.5" />`
        + `<line x1="${x - 7}" x2="${x + 7}" y1="${yScale(row.lo)}" y2="${yScale(row.lo)}" stroke="${color}" stroke-width="1.5" />`
        + `<line x1="${x - 7}" x2="${x + 7}" y1="${yScale(row.hi)}" y2="${yScale(row.hi)}" stroke="${color}" stroke-width="1.5" />`
      : '')
      + `<circle class="chart-point" cx="${x}" cy="${yScale(row.mean)}" r="5" fill="${color}" stroke="white" stroke-width="1.5" data-tooltip="${escapeHtml(tooltip)}"></circle>`
      + `<text x="${x}" y="${yScale(row.hi) - 20}" text-anchor="middle" font-size="12" font-weight="600" fill="${color}">${formatCount(row.mean)}</text>`
      + (row.hasInterval ? `<text x="${x}" y="${yScale(row.hi) - 7}" text-anchor="middle" font-size="11" fill="${mutedColor}">(${formatCount(row.lo)}–${formatCount(row.hi)})</text>` : '')
      + `<text x="${x}" y="${axisY + 17}" text-anchor="middle" font-size="12" fill="${color}">${escapeHtml(row.label)}</text>`
      + (row.reduction !== null ? `<text x="${x}" y="${axisY + 32}" text-anchor="middle" font-size="11" fill="${mutedColor}">−${(100 * row.reduction).toFixed(1)}%</text>` : '');
  }).join('');
  const plotMid = margin.top + plotHeight / 2;

  mount.innerHTML = `<svg viewBox="0 0 ${width} ${height}" font-family="'DM Sans', Arial, sans-serif" role="img" aria-label="expected abundance at the start of next season with and without trapping">
    <rect x="0" y="0" width="${width}" height="${height}" fill="white" />
    ${grid}
    <line x1="${margin.left}" x2="${width - margin.right}" y1="${axisY}" y2="${axisY}" stroke="${mutedColor}" stroke-opacity="0.5" />
    ${marks}
    <text x="14" y="${plotMid}" text-anchor="middle" font-size="12" fill="${mutedColor}" transform="rotate(-90 14 ${plotMid})">expected abundance</text>
  </svg>`;
  attachChartInteractions(mount);
}

// abundance rows for the chart: the given options, then no trapping
function abundanceRows(info, optionIndexes) {
  const rows = optionIndexes.map((index) => {
    const option = info.options[index];
    return {
      label: optionLabel(index),
      mean: option.expectedAbundance,
      lo: option.abundance95 ? option.abundance95[0] : option.expectedAbundance,
      hi: option.abundance95 ? option.abundance95[1] : option.expectedAbundance,
      hasInterval: Boolean(option.abundance95),
      reduction: option.reduction,
    };
  });
  if (info.noTrapping) {
    const nt = info.noTrapping;
    rows.push({
      label: 'No trapping',
      mean: nt.expectedAbundance,
      lo: nt.abundance95 ? nt.abundance95[0] : nt.expectedAbundance,
      hi: nt.abundance95 ? nt.abundance95[1] : nt.expectedAbundance,
      hasInterval: Boolean(nt.abundance95),
      reduction: null,
      reference: true,
    });
  }
  return rows;
}

function hideOptimizationResults() {
  document.querySelector('#optimization-result-panel').hidden = true;
  document.querySelector('#scenario-save-panel').hidden = true;
}

// text under "Optimization results" describing the two charts
function showEffortSummary() {
  const el = document.querySelector('#optimization-effort-summary');
  el.textContent = 'The chart on the left shows the optimal allocation of traps over time. '
    + 'The chart on the right compares the expected crab abundance at the start of next season under this optimal trapping schedule with the expected abundance if no traps were set.';
  el.hidden = false;
}

function loadOptimizationResults() {
  document.querySelector('#optimization-result-panel').hidden = false;
  document.querySelector('#scenario-save-panel').hidden = false;
  if (loadedResultsVersion === optimizationVersion) return;
  loadedResultsVersion = optimizationVersion;
  optimizationInfo = null;
  const exploreButton = document.querySelector('#explore-alternatives-button');
  const status = document.querySelector('#optimization-plot-status');
  const charts = document.querySelector('#optimization-charts');
  exploreButton.hidden = true;
  document.querySelector('#optimization-effort-summary').hidden = true;
  charts.hidden = true;
  status.textContent = 'Loading the optimal trap schedule...';
  status.hidden = false;
  Promise.resolve().then(() => {
    const info = userData.optimization?.info;
    if (!info) throw new Error('No optimization results yet. Run the optimization first.');
    // downloads built by the server when the optimization finished
    setZipDownload(document.querySelector('#optimize-download-button'), userData.optimization.summaryZip, 'optimization_summary.zip');
    if (userData.optimization.optionsZip) {
      setZipDownload(document.querySelector('#options-download-button'), userData.optimization.optionsZip, 'optimization_options.zip');
    }
    return info;
  }).then((info) => {
    optimizationInfo = info;
    renderScheduleChart('chart-optimal-schedule', info.occasions, [{ label: 'Optimal', schedule: info.options[0].schedule }]);
    renderAbundanceChart('chart-optimal-abundance', abundanceRows(info, [0]));
    status.hidden = true;
    charts.hidden = false;
    // only offer alternatives when the search found more than one schedule
    exploreButton.hidden = !(info.nOptions > 1);
    showEffortSummary(info);
    prepareScenarioSave(info);
  }).catch((error) => {
    status.textContent = error.message || 'Could not load the optimization results.';
  });
}

// ---- Saved scenarios ----
// Each completed run can be saved as a scenario; saved scenarios (kept in
// the browser with the rest of this user's data, for the current fitted
// model only) are compared in a table and a chart.
const TRAP_LABELS = { fukui: 'Fukui', minnow: 'minnow', shrimp: 'shrimp' };
const formatCount = (value) => Math.round(value).toLocaleString('en-US');
let savedScenarioForVersion = null;

function describeTrapTypes(types) {
  if (!types || types.length === 3) return 'all trap types';
  const labels = types.map((type) => TRAP_LABELS[type] || type);
  return `${labels.join(' + ')} only`;
}

function describeBiweekLimit(maxPerBiweek, budget) {
  return maxPerBiweek >= budget ? 'no biweek limit' : `max ${maxPerBiweek}/biweek`;
}

// e.g. "500 effort · shrimp only · max 40/biweek"
function scenarioAutoName(info) {
  return `${info.budget} effort · ${describeTrapTypes(info.allowedTypes)} · ${describeBiweekLimit(info.maxPerBiweek, info.budget)}`;
}

function prepareScenarioSave(info) {
  const button = document.querySelector('#save-scenario-button');
  const status = document.querySelector('#scenario-save-status');
  if (savedScenarioForVersion === optimizationVersion) return;
  const savedAs = userData.scenarios.find((sc) => sc.version === optimizationVersion)?.name;
  document.querySelector('#scenario-name').value = savedAs || scenarioAutoName(info);
  button.disabled = Boolean(savedAs);
  button.textContent = savedAs ? 'Saved' : 'Save scenario';
  status.textContent = savedAs ? `Saved as "${savedAs}". Change the settings and run again to add another scenario.` : '';
  status.classList.remove('is-error');
  status.hidden = !savedAs;
}

// what the comparison table and chart need from an optimization run
function scenarioFromOptimization(info, name) {
  const best = info.options[0];
  return {
    id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    version: optimizationVersion,
    name,
    budget: info.budget,
    cost: info.cost,
    allowedTypes: info.allowedTypes,
    maxPerBiweek: info.maxPerBiweek,
    traps: info.traps,
    effortUsed: info.effortUsed,
    occasions: info.occasions,
    schedule: best.schedule,
    expectedAbundance: best.expectedAbundance,
    abundance95: best.abundance95,
    reduction: best.reduction,
    prevented: best.prevented,
    prevented95: best.prevented95,
    noTrapping: info.noTrapping
      ? { expected_abundance: info.noTrapping.expectedAbundance, abundance_95: info.noTrapping.abundance95 }
      : null,
  };
}

document.querySelector('#save-scenario-button').addEventListener('click', (event) => {
  const button = event.currentTarget;
  const status = document.querySelector('#scenario-save-status');
  const info = userData.optimization?.info;
  if (!info) return;
  // the same run saved twice would just duplicate a row
  const duplicate = userData.scenarios.find((sc) => sc.version === optimizationVersion);
  if (duplicate) {
    status.textContent = `These results are already saved as "${duplicate.name}".`;
    status.classList.add('is-error');
    status.hidden = false;
    button.disabled = true;
    return;
  }
  const name = document.querySelector('#scenario-name').value.trim().slice(0, 80) || `Scenario ${userData.scenarios.length + 1}`;
  userData.scenarios.push(scenarioFromOptimization(info, name));
  savedScenarioForVersion = optimizationVersion;
  button.disabled = true;
  button.textContent = 'Saved';
  status.textContent = `Saved as "${name}". Change the settings and run again to add another scenario.`;
  status.classList.remove('is-error');
  status.hidden = false;
  loadScenarios();
});

document.querySelector('#change-settings-button').addEventListener('click', () => goToStep(5));

function loadScenarios() {
  renderScenarios(userData.scenarios);
}

function renderScenarios(scenarios) {
  const panel = document.querySelector('#scenarios-panel');
  panel.hidden = scenarios.length === 0;
  if (!scenarios.length) return;

  const header = '<thead><tr><th scope="col">Scenario</th><th scope="col">Optimal trap schedule</th>'
    + '<th scope="col">Expected abundance next season</th><th scope="col">Reduction vs no trapping</th><th scope="col"><span class="visually-hidden">Remove</span></th></tr></thead>';
  const rows = scenarios.map((sc) => {
    const schedule = scheduleByType(sc);
    const scheduleHtml = schedule.length
      ? schedule.map((line) => `<span class="scenario-schedule-line"><span class="scenario-trap-swatch" style="background:${TRAP_COLORS[line.type]}"></span><span><strong>${line.label}:</strong> ${escapeHtml(line.placements)}</span></span>`).join('')
      : 'no traps';
    // the suggested name already lists the settings; a custom name doesn't
    const customName = sc.name !== scenarioAutoName(sc);
    const settings = customName
      ? `${sc.budget} effort · ${describeTrapTypes(sc.allowedTypes)} · ${describeBiweekLimit(sc.maxPerBiweek, sc.budget)}`
      : '';
    const abundance = `${formatCount(sc.expectedAbundance)}${sc.abundance95 ? `<small>95% CrI ${formatCount(sc.abundance95[0])}–${formatCount(sc.abundance95[1])}</small>` : ''}`;
    const prevented = scenarioPrevented(sc);
    const reduction = sc.reduction === null ? '—'
      : `${(100 * sc.reduction).toFixed(1)}%${prevented !== null ? `<small>${formatCount(prevented)} fewer crabs</small>` : ''}`;
    return `<tr><th scope="row">${escapeHtml(sc.name)}${settings ? `<small>${escapeHtml(settings)}</small>` : ''}</th>`
      + `<td class="scenario-schedule">${scheduleHtml}</td><td>${abundance}</td><td>${reduction}</td>`
      + `<td><button class="scenario-remove" type="button" data-scenario="${sc.id}" aria-label="Remove ${escapeHtml(sc.name)}">×</button></td></tr>`;
  }).join('');
  const noTrap = scenarios.find((sc) => sc.noTrapping)?.noTrapping;
  const noTrapRow = noTrap
    ? `<tr class="scenario-reference"><th scope="row">No trapping<small>for reference</small></th><td>no traps</td>`
      + `<td>${formatCount(noTrap.expected_abundance)}${noTrap.abundance_95 ? `<small>95% CrI ${formatCount(noTrap.abundance_95[0])}–${formatCount(noTrap.abundance_95[1])}</small>` : ''}</td><td>—</td><td></td></tr>`
    : '';
  document.querySelector('#scenario-table').innerHTML = `${header}<tbody>${rows}${noTrapRow}</tbody>`;
  document.querySelectorAll('.scenario-remove').forEach((button) => {
    button.addEventListener('click', () => removeScenario(button.dataset.scenario));
  });
  renderScenarioChart(scenarios);
  lastScenarios = scenarios;
}

// "Fukui: 3 on Sep 1, 24 on Oct 1" per trap type, in date order
function scheduleByType(sc) {
  return ['fukui', 'minnow', 'shrimp']
    .filter((type) => sc.schedule[type] && sc.schedule[type].some((count) => count > 0))
    .map((type) => ({
      type,
      label: type === 'fukui' ? 'Fukui' : type[0].toUpperCase() + type.slice(1),
      placements: sc.schedule[type]
        .map((count, index) => [count, sc.occasions[index]])
        .filter(([count]) => count > 0)
        .map(([count, date]) => `${count} on ${date}`)
        .join(', '),
    }));
}

// the comparison table as a CSV, built from the scenarios on screen
let lastScenarios = [];
document.querySelector('#scenario-table-download').addEventListener('click', () => {
  const field = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = [['Scenario', 'Trapping effort (Fukui traps worth)', 'Effort used', 'Trap types available',
    'Maximum per biweek (Fukui traps worth)', 'Optimal trap schedule',
    'Expected abundance at start of next season', 'Abundance 95% CrI lower', 'Abundance 95% CrI upper',
    'Reduction vs no trapping (%)', 'Fewer crabs than no trapping']];
  lastScenarios.forEach((sc) => {
    const prevented = scenarioPrevented(sc);
    rows.push([
      sc.name, sc.budget, sc.effortUsed,
      (sc.allowedTypes || []).map((type) => TRAP_LABELS[type] || type).join('; '),
      sc.maxPerBiweek >= sc.budget ? 'no limit' : sc.maxPerBiweek,
      scheduleByType(sc).map((line) => `${line.label}: ${line.placements}`).join('; ') || 'no traps',
      sc.expectedAbundance.toFixed(1),
      sc.abundance95 ? sc.abundance95[0].toFixed(1) : '', sc.abundance95 ? sc.abundance95[1].toFixed(1) : '',
      sc.reduction === null ? '' : (100 * sc.reduction).toFixed(1),
      prevented === null ? '' : prevented.toFixed(1),
    ]);
  });
  const noTrap = lastScenarios.find((sc) => sc.noTrapping)?.noTrapping;
  if (noTrap) {
    rows.push(['No trapping', 0, 0, '', '', 'no traps', noTrap.expected_abundance.toFixed(1),
      noTrap.abundance_95 ? noTrap.abundance_95[0].toFixed(1) : '', noTrap.abundance_95 ? noTrap.abundance_95[1].toFixed(1) : '', '', '']);
  }
  const csv = `${rows.map((row) => row.map(field).join(',')).join('\n')}\n`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'scenario_comparison.csv';
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});

// crabs prevented compared with no trapping: paired within each posterior
// sample when the results include it, otherwise the difference in means
function scenarioPrevented(sc) {
  if (sc.prevented !== null && sc.prevented !== undefined) return sc.prevented;
  if (sc.noTrapping) return sc.noTrapping.expected_abundance - sc.expectedAbundance;
  return null;
}

function removeScenario(id) {
  const removed = userData.scenarios.find((sc) => sc.id === id);
  userData.scenarios = userData.scenarios.filter((sc) => sc.id !== id);
  // the current run can be saved again once its scenario is removed
  if (removed && removed.version === optimizationVersion) {
    savedScenarioForVersion = null;
    const button = document.querySelector('#save-scenario-button');
    button.disabled = false;
    button.textContent = 'Save scenario';
    document.querySelector('#scenario-save-status').hidden = true;
  }
  loadScenarios();
}

// round axis ticks (1, 2 or 5 times a power of ten) covering [min, max]
function roundTicks(min, max, target = 5) {
  const span = max - min || 1;
  const raw = span / target;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((value) => value >= raw);
  const ticks = [];
  for (let t = Math.floor(min / step) * step; t <= max + step * 1e-9; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

// expected abundance at the start of next season (dot) and its 95% credible
// interval (line) for each scenario and for no trapping, with each
// scenario's reduction compared with no trapping at the right
function renderScenarioChart(scenarios) {
  const mount = document.querySelector('#chart-scenarios');
  const rows = scenarios.map((sc) => ({
    name: sc.name,
    mean: sc.expectedAbundance,
    lo: sc.abundance95 ? sc.abundance95[0] : sc.expectedAbundance,
    hi: sc.abundance95 ? sc.abundance95[1] : sc.expectedAbundance,
    hasInterval: Boolean(sc.abundance95),
    reduction: sc.reduction,
  }));
  const noTrap = scenarios.find((sc) => sc.noTrapping)?.noTrapping;
  if (noTrap) {
    rows.push({
      name: 'No trapping',
      mean: noTrap.expected_abundance,
      lo: noTrap.abundance_95 ? noTrap.abundance_95[0] : noTrap.expected_abundance,
      hi: noTrap.abundance_95 ? noTrap.abundance_95[1] : noTrap.expected_abundance,
      hasInterval: Boolean(noTrap.abundance_95),
      reduction: null,
      reference: true,
    });
  }
  if (!rows.length) { mount.innerHTML = ''; return; }

  const width = 640;
  const rowHeight = 42;
  const margin = { top: 12, right: 64, bottom: 40, left: 210 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = rows.length * rowHeight;
  const height = margin.top + innerHeight + margin.bottom;
  const ticks = roundTicks(0, Math.max(...rows.map((r) => r.hi)));
  const xMax = ticks[ticks.length - 1];
  const xScale = (value) => margin.left + (value / (xMax || 1)) * innerWidth;
  const lineColor = cssVar('--line');
  const mutedColor = cssVar('--muted');
  const inkColor = cssVar('--ink');
  const scenarioColor = cssVar('--mint-deep');
  const axisY = margin.top + innerHeight;
  // scenario names wrap onto up to two lines (the second cut short if needed)
  const wrapName = (text, n = 32) => {
    const lines = [''];
    for (const word of text.split(' ')) {
      const line = lines[lines.length - 1];
      if (line && (line + ' ' + word).length > n) lines.push(word);
      else lines[lines.length - 1] = line ? `${line} ${word}` : word;
    }
    if (lines.length > 2) lines.splice(2, lines.length, `${lines[1]} …`.slice(0, n));
    if (lines.length === 2 && lines[1].length > n) lines[1] = `${lines[1].slice(0, n - 1)}…`;
    return lines;
  };

  const grid = ticks.map((t) => `<line x1="${xScale(t)}" x2="${xScale(t)}" y1="${margin.top}" y2="${axisY}" stroke="${lineColor}" />`
    + `<text x="${xScale(t)}" y="${axisY + 14}" text-anchor="middle" font-size="10" fill="${mutedColor}">${formatCount(t)}</text>`).join('');
  const marks = rows.map((row, i) => {
    const y = margin.top + i * rowHeight + rowHeight / 2;
    const color = row.reference ? mutedColor : scenarioColor;
    const tooltip = `${row.name}\nexpected abundance: ${formatCount(row.mean)}`
      + (row.hasInterval ? ` (95% CrI ${formatCount(row.lo)} to ${formatCount(row.hi)})` : '')
      + (row.reduction !== null ? `\n${(100 * row.reduction).toFixed(1)}% reduction vs no trapping` : '');
    const nameLines = wrapName(row.name);
    const firstY = y + 4 - (nameLines.length - 1) * 6.5;
    const separator = row.reference ? `<line x1="${margin.left}" x2="${width - margin.right}" y1="${y - rowHeight / 2}" y2="${y - rowHeight / 2}" stroke="${mutedColor}" stroke-dasharray="3 3" />` : '';
    return separator
      + `<text x="${margin.left - 12}" y="${firstY}" text-anchor="end" font-size="11" fill="${row.reference ? mutedColor : inkColor}">${nameLines.map((line, k) => `<tspan x="${margin.left - 12}" dy="${k ? 13 : 0}">${escapeHtml(line)}</tspan>`).join('')}</text>`
      + `<line x1="${xScale(row.lo)}" x2="${xScale(row.hi)}" y1="${y}" y2="${y}" stroke="${color}" stroke-width="2" />`
      + `<line x1="${xScale(row.lo)}" x2="${xScale(row.lo)}" y1="${y - 5}" y2="${y + 5}" stroke="${color}" stroke-width="2" />`
      + `<line x1="${xScale(row.hi)}" x2="${xScale(row.hi)}" y1="${y - 5}" y2="${y + 5}" stroke="${color}" stroke-width="2" />`
      + `<circle class="chart-point" cx="${xScale(row.mean)}" cy="${y}" r="5.5" fill="${color}" stroke="white" stroke-width="1.5" data-tooltip="${escapeHtml(tooltip)}"></circle>`
      + (row.reduction !== null ? `<text x="${width - margin.right + 10}" y="${y + 4}" font-size="11" fill="${mutedColor}">−${(100 * row.reduction).toFixed(1)}%</text>` : '');
  }).join('');

  mount.innerHTML = `<svg viewBox="0 0 ${width} ${height}" font-family="'DM Sans', Arial, sans-serif" role="img" aria-label="expected abundance at the start of next season for each saved scenario and for no trapping">
    <rect x="0" y="0" width="${width}" height="${height}" fill="white" />
    ${grid}
    ${marks}
    <text x="${margin.left + innerWidth / 2}" y="${height - 6}" text-anchor="middle" font-size="10" fill="${mutedColor}">expected abundance at the start of next season</text>
  </svg>`;
  attachChartInteractions(mount);
}

const alternativesDialog = document.querySelector('#alternatives-dialog');
document.querySelector('#explore-alternatives-button').addEventListener('click', () => {
  if (!optimizationInfo) return;
  const info = optimizationInfo;
  const indexes = info.options.map((_, i) => i);
  renderScheduleChart('chart-options-schedule', info.occasions,
    indexes.map((i) => ({ label: optionLabel(i), schedule: info.options[i].schedule })), { usedDatesOnly: true });
  renderAbundanceChart('chart-options-abundance', abundanceRows(info, indexes));
  alternativesDialog.showModal();
});
setupDismissableDialog(alternativesDialog, document.querySelector('#alternatives-close'));


const initialStep = Number(window.location.hash.replace('#step-', ''));
goToStep(initialStep >= 1 && initialStep <= totalSteps && canEnterStep(initialStep) ? initialStep : 1);

// ---- "Ask for help" chat assistant ----
// Sends the conversation and this page's results (chatResults) to
// api/chat, which streams the answer back. The launcher only appears when
// the server has a chat service set up (see chat/chat.js).
const chat = {
  launcher: document.querySelector('#chat-launcher'),
  panel: document.querySelector('#chat-panel'),
  messagesEl: document.querySelector('#chat-messages'),
  form: document.querySelector('#chat-form'),
  input: document.querySelector('#chat-input'),
  send: document.querySelector('#chat-send'),
  history: [], // { role: 'user' | 'assistant', content }
  busy: false,
};

fetch('api/chat/config').then((response) => response.json()).then((config) => {
  if (!config.enabled) return;
  document.querySelector('#chat-privacy').textContent = config.privacyNote || '';
  // the chat sentence in the "Data privacy details" pop-up
  const privacyChatNote = document.querySelector('#privacy-chat-note');
  if (privacyChatNote && config.privacyNote) {
    privacyChatNote.textContent = config.privacyNote.replace(/^Your questions/, 'Chat questions');
    privacyChatNote.hidden = false;
  }
  chat.launcher.hidden = false;
  // room below the footer so the floating button doesn't cover it
  document.body.classList.add('has-chat');
}).catch(() => {});

function openChat(open) {
  chat.panel.hidden = !open;
  chat.launcher.hidden = open;
  chat.launcher.setAttribute('aria-expanded', String(open));
  if (open) {
    if (!chat.messagesEl.children.length) {
      addChatBubble('assistant', 'Hi! Ask me about your results or how the app works, for example what the estimated recruitment means, or why the optimization chose this schedule. I can only see the results produced on this page.');
    }
    chat.input.focus();
  } else {
    chat.launcher.focus();
  }
}
chat.launcher.addEventListener('click', () => openChat(true));
document.querySelector('#chat-close').addEventListener('click', () => openChat(false));
chat.panel.addEventListener('keydown', (event) => { if (event.key === 'Escape') openChat(false); });

document.querySelector('#chat-new').addEventListener('click', () => {
  if (chat.busy) return;
  chat.history = [];
  chat.messagesEl.innerHTML = '';
  openChat(true);
});

// Enter sends; Shift+Enter starts a new line
chat.input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); chat.form.requestSubmit(); }
});

// light formatting for answers: paragraphs, **bold**, bullet and numbered
// lists. The text is escaped first, so nothing in an answer can inject HTML.
function formatChatText(text) {
  const blocks = escapeHtml(text.trim()).split(/\n{2,}/);
  return blocks.map((block) => {
    const lines = block.split('\n');
    const bold = (line) => line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/^#{1,6}\s+(.*)$/, '<strong>$1</strong>');
    if (lines.every((line) => /^\s*[-*•]\s+/.test(line))) {
      return `<ul>${lines.map((line) => `<li>${bold(line.replace(/^\s*[-*•]\s+/, ''))}</li>`).join('')}</ul>`;
    }
    if (lines.every((line) => /^\s*\d+[.)]\s+/.test(line))) {
      return `<ol>${lines.map((line) => `<li>${bold(line.replace(/^\s*\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`;
    }
    return `<p>${lines.map(bold).join('<br>')}</p>`;
  }).join('');
}

function addChatBubble(role, text, { error = false } = {}) {
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble chat-${role}${error ? ' is-error' : ''}`;
  bubble.innerHTML = role === 'user' ? `<p>${escapeHtml(text).replace(/\n/g, '<br>')}</p>` : formatChatText(text);
  chat.messagesEl.append(bubble);
  chat.messagesEl.scrollTop = chat.messagesEl.scrollHeight;
  return bubble;
}

chat.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const question = chat.input.value.trim();
  if (!question || chat.busy) return;
  chat.busy = true;
  chat.send.disabled = true;
  chat.input.value = '';
  addChatBubble('user', question);
  chat.history.push({ role: 'user', content: question });
  const bubble = addChatBubble('assistant', '…');
  bubble.classList.add('is-pending');

  // a failed question is taken back out of the conversation and put back
  // in the box, so it can simply be sent again
  const fail = (message) => {
    bubble.classList.remove('is-pending');
    bubble.classList.add('is-error');
    bubble.innerHTML = formatChatText(message);
    chat.history.pop();
    if (!chat.input.value) chat.input.value = question;
  };

  try {
    const response = await fetch('api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: chat.history, results: chatResults() }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      fail(body.error || 'Something went wrong answering this question.');
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let answer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      answer += decoder.decode(value, { stream: true });
      bubble.classList.remove('is-pending');
      bubble.innerHTML = formatChatText(answer);
      chat.messagesEl.scrollTop = chat.messagesEl.scrollHeight;
    }
    answer += decoder.decode();
    // an error partway through arrives at the end of the text
    const errorMatch = answer.match(/\n*\[Error: ([^\]]*)\]\s*$/);
    if (!answer.trim()) {
      fail('No answer came back. Please try again.');
    } else if (errorMatch && !answer.slice(0, errorMatch.index).trim()) {
      fail(errorMatch[1]);
    } else {
      bubble.innerHTML = formatChatText(answer);
      chat.history.push({ role: 'assistant', content: errorMatch ? answer.slice(0, errorMatch.index) : answer });
      if (errorMatch) bubble.classList.add('is-error');
    }
  } catch (error) {
    fail('Could not reach the server. Check your connection and try again.');
  } finally {
    chat.busy = false;
    chat.send.disabled = false;
  }
});
