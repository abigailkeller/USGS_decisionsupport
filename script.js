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
      { key: 'date-set', label: 'Date set column', pattern: /date.?set|set.?date/i, dateFormat: true, dateFormatKey: 'date', dateFormatLabel: 'Date format for date set and date retrieved' },
      { key: 'date-retrieved', label: 'Date retrieved column', pattern: /date.?retrieved|retrieved.?date|date.?pull/i, dateFormat: true, dateFormatKey: 'date' },
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
      const dateFormatControl = (kind === 'effort' ? fields.find((field) => field.dateFormat) : null);
      selection.innerHTML = `<p>Select ${kind} columns</p>${fields.map((field) => `<label for="${kind}-${field.key}-column"><span class="column-label">${field.label}${field.help ? `<span class="info-tooltip"><button class="info-tooltip-button" type="button" aria-label="More information about ${field.label}">?</button><span class="info-tooltip-text" role="tooltip">${field.help}</span></span>` : ''}</span><select id="${kind}-${field.key}-column"></select></label>${field.dateFormat && kind !== 'effort' ? `<label for="${kind}-${field.dateFormatKey || field.key}-format">${field.dateFormatLabel || 'Date format'}<select id="${kind}-${field.dateFormatKey || field.key}-format"><option value="">Select a date format</option><option value="MM-DD-YY">MM-DD-YY</option><option value="YYYY-MM-DD">YYYY-MM-DD</option><option value="YYYY/M/D">YYYY/M/D</option><option value="MM/DD/YYYY">MM/DD/YYYY</option><option value="DD-MM-YYYY">DD-MM-YYYY</option></select></label>` : ''}`).join('')}${dateFormatControl ? `<label for="effort-${dateFormatControl.dateFormatKey || 'date'}-format">${dateFormatControl.dateFormatLabel || 'Date format'}<select id="effort-${dateFormatControl.dateFormatKey || 'date'}-format"><option value="">Select a date format</option><option value="MM-DD-YY">MM-DD-YY</option><option value="YYYY-MM-DD">YYYY-MM-DD</option><option value="YYYY/M/D">YYYY/M/D</option><option value="MM/DD/YYYY">MM/DD/YYYY</option><option value="DD-MM-YYYY">DD-MM-YYYY</option></select></label>` : ''}`;
      card.insertBefore(selection, preview);
    }
    selection.hidden = false;
    fields.forEach((field) => {
      const select = selection.querySelector(`#${kind}-${field.key}-column`);
      const previousValue = select.value;
      select.innerHTML = `<option value="">Select a column</option>${headers.map((header, index) => `<option value="${index}">${escapeHtml(header)}</option>`).join('')}`;
      select.value = headers[Number(previousValue)] ? previousValue : '';
      if (field.dateFormat) {
        const formatKey = field.dateFormatKey || field.key;
        const formatSelect = selection.querySelector(`#${kind}-${formatKey}-format`);
        const savedFormat = uploadedData[kind]?.dateFormats?.[formatKey] || formatSelect.value;
        formatSelect.value = savedFormat;
        if (!formatSelect.dataset.bound) {
          formatSelect.addEventListener('change', (event) => {
            if (!uploadedData[kind]) uploadedData[kind] = { file, rows };
            if (!uploadedData[kind].dateFormats) uploadedData[kind].dateFormats = {};
            uploadedData[kind].dateFormats[formatKey] = event.target.value;
          });
          formatSelect.dataset.bound = 'true';
        }
      }
    });
    if (!selection.dataset.bound) {
      selection.addEventListener('change', () => renderPreview(kind, file, rows));
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
  if (uploadedData[kind]) uploadedData[kind].filteredRows = filteredRows;
  const dataRows = filteredRows.map((row) => selectedIndexes.map((index) => row[index] || ''));
  const selectedCount = previewHeaders.filter((header) => header !== '').length;
  summary.innerHTML = `<strong>${escapeHtml(file.name)}</strong><span>${filteredRows.length} rows · ${selectedCount} of ${previewHeaders.length} columns selected</span>`;
  const renderTable = (tableRows) => `<div class="data-preview-scroll"><table><thead><tr>${previewHeaders.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${tableRows.map((row) => `<tr>${selectedIndexes.map((index) => `<td>${escapeHtml(row[index] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const removalMessage = removedTrapRows > 0 ? `<p class="filter-message">${removedTrapRows} rows were removed because they were not a minnow, fukui, or shrimp trap.</p><label class="removed-rows-toggle"><input type="checkbox" id="show-removed-rows"${card.dataset.showRemoved === 'true' ? ' checked' : ''}> Show removed rows</label>` : '';
  const removedPreview = removedTrapRows > 0 && card.dataset.showRemoved === 'true' ? `<p class="removed-rows-heading">Removed rows (${removedRows.length})</p>${renderTable(removedRows)}` : '';
  preview.innerHTML = `${removalMessage}<p>Preview (all ${dataRows.length} rows)</p>${renderTable(filteredRows)}${removedPreview}`;
  const removedToggle = preview.querySelector('#show-removed-rows');
  if (removedToggle) removedToggle.addEventListener('change', (event) => {
    card.dataset.showRemoved = String(event.target.checked);
    renderPreview(kind, file, rows);
  });
}

function handleFile(kind, file) {
  const error = document.querySelector('#upload-error');
  error.hidden = true;
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

document.querySelectorAll('.next-button').forEach((button) => button.addEventListener('click', () => {
  const nextStep = Number(button.dataset.next);
  const error = document.querySelector('#upload-error');
  if (currentStep === 2 && (!uploadedData.catch || !uploadedData.effort || !document.querySelector('#data-confirmed').checked)) return showError(error, 'Upload both files and confirm that their previews look correct before continuing.');
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
