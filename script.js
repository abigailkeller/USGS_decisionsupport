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
  const dataRows = rows.slice(1).slice(0, 4).map((row) => headers.map((_, index) => row[index] || ''));
  const summary = document.querySelector(`#${kind}-summary`);
  const check = document.querySelector(`#${kind}-check`);
  const card = document.querySelector(`[data-kind="${kind}"].drop-zone`).closest('.dataset-card');
  summary.innerHTML = `<strong>${escapeHtml(file.name)}</strong><span>${rows.length - 1} rows · ${headers.length} columns</span>`;
  check.textContent = '✓';
  card.classList.add('has-file');
  let preview = card.querySelector('.data-preview');
  if (!preview) { preview = document.createElement('div'); preview.className = 'data-preview'; card.append(preview); }
  preview.innerHTML = `<p>Preview</p><table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${dataRows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
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
