const totalSteps = 7;
let currentStep = 1;
const uploadedData = { catch: null, effort: null };

const stepViews = [...document.querySelectorAll('.step-view')];
const stepLinks = [...document.querySelectorAll('.step-link')];
const progressBar = document.querySelector('#progress-bar');
const progressLabel = document.querySelector('#progress-label');
const progressStatus = document.querySelector('#progress-status');
const stepNames = ['Getting started', 'Upload data', 'Data visualization', 'Regime estimation', 'Objective function', 'Model training', 'Optimization results'];

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
      { key: 'crab-count', label: 'Crab count column', pattern: /crab.?count|count|number.?crab/i },
    ],
  };
  if (selectionConfig[kind]) {
    const fields = selectionConfig[kind];
    let selection = card.querySelector('.column-selection');
    if (!selection) {
      selection = document.createElement('div');
      selection.className = 'column-selection';
      selection.innerHTML = `<p>Select ${kind} columns</p>${fields.map((field) => `<label for="${kind}-${field.key}-column"><span class="column-label">${field.label}${field.help ? `<span class="info-tooltip"><button class="info-tooltip-button" type="button" aria-label="More information about ${field.label}">?</button><span class="info-tooltip-text" role="tooltip">${field.help}</span></span>` : ''}</span><select id="${kind}-${field.key}-column"></select></label>${field.dateFormat ? `<label for="${kind}-${field.key}-format">${field.dateFormatLabel || 'Date format'}<select id="${kind}-${field.key}-format"><option value="">Select a date format</option><option value="MM-DD-YY">MM-DD-YY</option><option value="YYYY-MM-DD">YYYY-MM-DD</option><option value="YYYY/M/D">YYYY/M/D</option><option value="MM/DD/YYYY">MM/DD/YYYY</option><option value="DD-MM-YYYY">DD-MM-YYYY</option></select></label>` : ''}`).join('')}`;
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
      selection.addEventListener('change', () => { resetQualityChecks(); renderPreview(kind, file, rows); });
      selection.dataset.bound = 'true';
    }
    previewHeaders = fields.map((field) => {
      const selectedValue = selection.querySelector(`#${kind}-${field.key}-column`).value;
      return selectedValue === '' ? '' : headers[Number(selectedValue)];
    });
  }
  const selectedIndexes = previewHeaders.map((header) => headers.indexOf(header));
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
  let removedCrabCountRows = 0;
  const crabCountField = selectionConfig[kind]?.find((field) => field.key === 'crab-count');
  const crabCountSelect = crabCountField ? card.querySelector(`#${kind}-crab-count-column`) : null;
  const crabCountIndex = crabCountSelect?.value === '' ? -1 : Number(crabCountSelect?.value);
  if (crabCountField && crabCountIndex >= 0) {
    const isValidCrabCount = (row) => {
      const rawValue = row[crabCountIndex];
      if (!String(rawValue ?? '').trim()) return false;
      const count = Number(rawValue);
      return Number.isFinite(count) && count >= 0;
    };
    const beforeCrabCountFilter = filteredRows.length;
    removedRows = removedRows.concat(filteredRows.filter((row) => !isValidCrabCount(row)));
    filteredRows = filteredRows.filter(isValidCrabCount);
    removedCrabCountRows = beforeCrabCountFilter - filteredRows.length;
  }
  if (uploadedData[kind]) uploadedData[kind].filteredRows = filteredRows;
  const dataRows = filteredRows.map((row) => selectedIndexes.map((index) => row[index] || ''));
  const selectedCount = previewHeaders.filter((header) => header !== '').length;
  summary.innerHTML = `<strong>${escapeHtml(file.name)}</strong><span>${filteredRows.length} rows · ${selectedCount} of ${previewHeaders.length} columns selected</span>`;
  const renderTable = (tableRows) => `<div class="data-preview-scroll"><table><thead><tr>${previewHeaders.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${tableRows.map((row) => `<tr>${selectedIndexes.map((index) => `<td>${escapeHtml(row[index] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const removalReasons = [];
  if (removedTrapRows > 0) removalReasons.push(`${removedTrapRows} rows were removed because they were not a minnow, fukui, or shrimp trap.`);
  if (removedCrabCountRows > 0) removalReasons.push(`${removedCrabCountRows} rows were removed because the crab count was missing, non-numeric, or negative.`);
  const removalMessage = removalReasons.length ? `${removalReasons.map((reason) => `<p class="filter-message">${reason}</p>`).join('')}<label class="removed-rows-toggle"><input type="checkbox" id="show-removed-rows"${card.dataset.showRemoved === 'true' ? ' checked' : ''}> Show removed rows</label>` : '';
  const removedPreview = removedRows.length > 0 && card.dataset.showRemoved === 'true' ? `<p class="removed-rows-heading">Removed rows (${removedRows.length})</p>${renderTable(removedRows)}` : '';
  preview.innerHTML = `${removalMessage}<p>Preview (all ${dataRows.length} rows)</p>${renderTable(filteredRows)}${removedPreview}`;
  const removedToggle = preview.querySelector('#show-removed-rows');
  if (removedToggle) removedToggle.addEventListener('change', (event) => {
    card.dataset.showRemoved = String(event.target.checked);
    renderPreview(kind, file, rows);
  });
  updateQualityCheckGating();
}

function allColumnsSelected() {
  if (!uploadedData.catch || !uploadedData.effort) return false;
  const requiredKeys = { catch: ['date', 'size', 'trap-type', 'trap-id'], effort: ['date-checked', 'trap-type', 'trap-id', 'crab-count'] };
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
    crabCount: selectedColumnIndex('effort', 'crab-count'),
  };
  const catchLabels = { date: 'catch date', size: 'catch crab size', trapType: 'catch trap type', trapId: 'catch trap ID' };
  const effortLabels = { dateChecked: 'effort date checked', trapType: 'effort trap type', trapId: 'effort trap ID', crabCount: 'effort crab count' };
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
  const isBlank = (value) => !String(value ?? '').trim();
  const normalizeTrapId = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');

  const catchMissing = catchRows.filter((row) => [catchCols.date, catchCols.size, catchCols.trapId].some((index) => isBlank(row[index]))).length;
  results.push(catchMissing === 0
    ? { status: 'pass', message: 'No missing values in the required catch columns.' }
    : { status: 'error', message: `${catchMissing} catch row(s) are missing a date, size, or trap ID.` });

  const effortMissing = effortRows.filter((row) => [effortCols.dateChecked, effortCols.trapId, effortCols.crabCount].some((index) => isBlank(row[index]))).length;
  results.push(effortMissing === 0
    ? { status: 'pass', message: 'No missing values in the required effort columns.' }
    : { status: 'error', message: `${effortMissing} effort row(s) are missing a date, trap ID, or crab count.` });

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

  const invalidCrabCounts = effortRows.filter((row) => {
    if (isBlank(row[effortCols.crabCount])) return false;
    const count = Number(row[effortCols.crabCount]);
    return !Number.isFinite(count) || count < 0;
  }).length;
  results.push(invalidCrabCounts === 0
    ? { status: 'pass', message: 'All effort crab counts are valid, non-negative numbers.' }
    : { status: 'error', message: `${invalidCrabCounts} effort row(s) have a crab count that is missing, non-numeric, or negative.` });

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

  const totalCrabCount = effortRows.reduce((sum, row) => {
    const count = Number(row[effortCols.crabCount]);
    return sum + (Number.isFinite(count) && count >= 0 ? count : 0);
  }, 0);
  results.push(totalCrabCount === catchRows.length
    ? { status: 'pass', message: 'The sum of the effort crab counts matches the number of catch rows.' }
    : { status: 'warning', message: `The sum of the effort crab counts (${totalCrabCount}) does not match the number of catch rows (${catchRows.length}).` });

  return results;
}

function handleFile(kind, file) {
  const error = document.querySelector('#upload-error');
  error.hidden = true;
  resetQualityChecks();
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

function canEnterStep(step) {
  if (step <= 2) return true;
  if (!uploadedData.catch || !uploadedData.effort || !document.querySelector('#data-confirmed').checked) return false;
  if (step >= 4 && !document.querySelector('[data-view="3"] .step-check').checked) return false;
  if (step >= 5 && !document.querySelector('[data-view="4"] .step-check').checked) return false;
  if (step >= 7 && document.querySelector('#training-next').disabled) return false;
  return true;
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

document.querySelectorAll('.next-button').forEach((button) => button.addEventListener('click', () => {
  const nextStep = Number(button.dataset.next);
  const error = document.querySelector('#upload-error');
  if (currentStep === 2 && (!uploadedData.catch || !uploadedData.effort || !document.querySelector('#data-confirmed').checked)) return showError(error, 'Upload both files, run data quality checks, and confirm that their previews look correct before continuing.');
  if (button.classList.contains('gated-next') && !button.closest('.step-view').querySelector('.step-check').checked) return;
  goToStep(nextStep);
}));
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

document.querySelector('#train-button').addEventListener('click', (event) => {
  const button = event.currentTarget;
  const bar = document.querySelector('#training-bar');
  const title = document.querySelector('#training-title');
  const copy = document.querySelector('#training-copy');
  button.disabled = true;
  title.textContent = 'Training in progress';
  copy.textContent = 'Learning from your selected objective...';
  let progress = 0;
  const timer = setInterval(() => {
    progress += 20;
    bar.style.width = `${progress}%`;
    if (progress === 100) { clearInterval(timer); title.textContent = 'Training complete'; copy.textContent = 'The model is ready to review.'; document.querySelector('#training-ring').classList.add('is-done'); document.querySelector('#training-next').disabled = false; }
  }, 180);
});
document.querySelectorAll('input[name="objective"]').forEach((input) => input.addEventListener('change', (event) => { document.querySelector('#training-copy').textContent = `Objective: ${event.target.parentElement.querySelector('strong').textContent}`; }));
document.querySelector('[data-restart]').addEventListener('click', () => window.location.reload());

const initialStep = Number(window.location.hash.replace('#step-', ''));
goToStep(initialStep >= 1 && initialStep <= totalSteps && canEnterStep(initialStep) ? initialStep : 1);
