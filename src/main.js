import { assemble, buildAlignedRows, buildSections, lineCount, unresolvedCount } from './diff-logic.js';
import './style.css';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const encoder = new TextEncoder();
const state = {
  sections: [], decisions: [], activeHunk: 0,
  mode: 'split', leftName: 'Versión original', rightName: 'Versión nueva',
  error: '', compared: false,
};

document.querySelector('#app').innerHTML = `
  <header class="topbar">
    <a class="brand" href="#" aria-label="DIFF Studio, inicio"><span class="brand-mark" aria-hidden="true">↔</span><span>DIFF<span class="brand-light"> Studio</span></span></a>
    <span class="privacy-pill"><span class="privacy-dot"></span>Local</span>
  </header>
  <main>
    <section class="hero"><h1>Comparar archivos</h1></section>

    <section class="input-grid" aria-label="Textos para comparar">
      <article class="input-card">
        <div class="card-head"><label for="left-text">ORIGINAL</label><span class="file-badge" id="left-file-label">Pegar texto</span></div>
        <textarea id="left-text" spellcheck="false" placeholder="Pega aquí el texto original…" aria-label="Texto de la versión original"></textarea>
        <div class="input-foot"><span id="left-count">0 líneas</span><label class="file-button" for="left-file">Abrir archivo<input id="left-file" type="file" accept=".txt,.md,.csv,.json,.xml,.html,.css,.js,.ts,.py,.yml,.yaml,.log,text/*" /></label></div>
      </article>
      <article class="input-card">
        <div class="card-head"><label for="right-text">NUEVO</label><span class="file-badge" id="right-file-label">Pegar texto</span></div>
        <textarea id="right-text" spellcheck="false" placeholder="Pega aquí el texto nuevo…" aria-label="Texto de la versión nueva"></textarea>
        <div class="input-foot"><span id="right-count">0 líneas</span><label class="file-button" for="right-file">Abrir archivo<input id="right-file" type="file" accept=".txt,.md,.csv,.json,.xml,.html,.css,.js,.ts,.py,.yml,.yaml,.log,text/*" /></label></div>
      </article>
    </section>

    <div class="action-row"><p class="local-note">Tus textos no salen de este dispositivo.</p><button class="primary-button" id="compare-button">Comparar</button></div>
    <p id="error-message" class="error-message" role="alert" hidden></p>
    <section id="results" hidden aria-live="polite"></section>
    <footer><span>DIFF STUDIO <span class="footer-sep">/</span> UNA HERRAMIENTA LOCAL</span><a href="https://github.com/CornFlaekk/diff-studio" target="_blank" rel="noreferrer">Código en GitHub <span aria-hidden="true">↗</span></a></footer>
  </main>`;

const el = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const leftInput = el('left-text');
const rightInput = el('right-text');

function updateCounts() {
  el('left-count').textContent = `${lineCount(leftInput.value).toLocaleString('es')} líneas`;
  el('right-count').textContent = `${lineCount(rightInput.value).toLocaleString('es')} líneas`;
}
leftInput.addEventListener('input', updateCounts);
rightInput.addEventListener('input', updateCounts);

async function loadFile(side) {
  const input = el(`${side}-file`);
  const file = input.files?.[0];
  if (!file) return;
  setError('');
  if (file.size > MAX_FILE_BYTES) {
    setError(`«${file.name}» supera el límite de 2 MB por archivo.`);
    input.value = '';
    return;
  }
  try {
    const bytes = await file.arrayBuffer();
    if (new Uint8Array(bytes).includes(0)) throw new Error('Parece ser un archivo binario. Solo se admiten archivos de texto.');
    const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const other = side === 'left' ? rightInput.value : leftInput.value;
    if (bytes.byteLength + encoder.encode(other).byteLength > MAX_TOTAL_BYTES) {
      throw new Error('El tamaño combinado supera el límite de 4 MB.');
    }
    (side === 'left' ? leftInput : rightInput).value = content;
    state[`${side}Name`] = file.name;
    el(`${side}-file-label`).textContent = file.name;
    updateCounts();
  } catch (error) {
    setError(error instanceof TypeError ? 'No se pudo leer el archivo como UTF-8 válido.' : error.message);
  }
  input.value = '';
}
el('left-file').addEventListener('change', () => loadFile('left'));
el('right-file').addEventListener('change', () => loadFile('right'));

function setError(message) {
  const target = el('error-message');
  target.textContent = message;
  target.hidden = !message;
}

function safeText(text) {
  return escapeHtml(text).replace(/\n/g, '<span class="line-break" aria-hidden="true">↵</span>\n');
}

function renderHunkChoice(sectionIndex, hunkNumber) {
  const choice = state.decisions[sectionIndex];
  const status = choice ? (choice === 'left' ? 'Original elegido' : 'Nuevo elegido') : 'Elige una versión';
  return `<div class="diff-hunk-marker" data-hunk="${sectionIndex}">
    <div class="diff-hunk-title"><strong>Cambio ${String(hunkNumber).padStart(2, '0')}</strong><span class="hunk-state ${choice ? 'resolved' : ''}">${choice ? '✓ ' : '○ '}${status}</span></div>
    <div class="diff-hunk-options"><button class="choice-button ${choice === 'left' ? 'selected' : ''}" data-choice="left" aria-pressed="${choice === 'left'}" aria-label="En el cambio ${hunkNumber}: conservar la versión original">← Original</button><button class="choice-button ${choice === 'right' ? 'selected' : ''}" data-choice="right" aria-pressed="${choice === 'right'}" aria-label="En el cambio ${hunkNumber}: conservar la versión nueva">Nueva →</button>${choice ? `<button class="clear-choice" data-choice="clear" aria-label="Quitar la elección del cambio ${hunkNumber}">Deshacer</button>` : ''}</div>
  </div>`;
}

function renderAlignedDiff() {
  const hunkSectionIndices = state.sections.flatMap((section, index) => section.type === 'hunk' ? [index] : []);
  const rows = buildAlignedRows(leftInput.value, rightInput.value);
  const rendered = rows.map((row, rowIndex) => {
    const hunk = row.hunkId === null ? '' : ` data-hunk-id="${row.hunkId}"`;
    const decision = row.hunkId === null ? null : state.decisions[hunkSectionIndices[row.hunkId]];
    const rowClass = `diff-row ${row.type}${decision ? ` chosen choice-${decision}` : ''}`;
    const cell = (side, text, number) => `<div class="diff-cell ${side} ${row.type === 'equal' ? '' : row.type === 'change' ? (side === 'left' ? 'removed' : 'added') : row.type === (side === 'left' ? 'delete' : 'add') ? (side === 'left' ? 'removed' : 'added') : ''}"><span class="line-number">${number ?? ''}</span><code>${text === null ? '' : safeText(text.replace(/\n$/, '')) || '&nbsp;'}</code></div>`;
    const nextRow = rows[rowIndex + 1];
    const choice = row.hunkId !== null && nextRow?.hunkId !== row.hunkId
      ? renderHunkChoice(hunkSectionIndices[row.hunkId], row.hunkId + 1)
      : '';
    return `<div class="${rowClass}"${hunk}>${cell('left', row.left, row.leftNo)}${cell('right', row.right, row.rightNo)}</div>${choice}`;
  }).join('');
  const markers = hunkSectionIndices.map((index, hunkIndex) => `<button class="diff-overview-marker ${state.decisions[index] ? 'resolved' : 'pending'}" data-nav-hunk="${index}" aria-label="Ir al cambio ${hunkIndex + 1}" title="Cambio ${hunkIndex + 1}"></button>`).join('');
  return `<div class="file-diff"><div class="diff-file-head"><div>${escapeHtml(state.leftName)} <span>ORIGINAL</span></div><div>${escapeHtml(state.rightName)} <span>NUEVA</span></div></div><div class="diff-viewport"><div class="diff-file-body">${rendered || '<div class="diff-no-lines">No hay líneas para mostrar.</div>'}</div><div class="diff-overview" aria-label="Ubicación de los cambios en el fichero">${markers}</div></div></div>`;
}

function renderUnifiedDiff() {
  let hunkNumber = 0;
  return `<div class="unified-file-diff">${state.sections.map((section, index) => {
    if (section.type === 'equal') return `<div class="unified-line"> ${safeText(section.value)}</div>`;
    hunkNumber += 1;
    return `${section.left ? `<div class="unified-line removed">− ${safeText(section.left)}</div>` : ''}${section.right ? `<div class="unified-line added">＋ ${safeText(section.right)}</div>` : ''}${renderHunkChoice(index, hunkNumber)}`;
  }).join('')}</div>`;
}

function renderResult() {
  const target = el('results');
  if (!state.compared) { target.hidden = true; return; }
  target.hidden = false;
  const hunkSectionIndices = state.sections.flatMap((section, index) => section.type === 'hunk' ? [index] : []);
  const changes = hunkSectionIndices.length;
  const unresolved = unresolvedCount(state.sections, state.decisions);
  const merged = assemble(state.sections, state.decisions);
  const statusText = changes ? `${unresolved} pendientes de ${changes} cambios` : 'Los textos son idénticos';
  target.innerHTML = `
    <div class="results-heading"><h2>Resultado</h2><div class="summary-badge ${unresolved ? 'pending' : 'complete'}"><span class="summary-dot"></span>${statusText}</div></div>
    <div class="toolbar"><div class="mode-switch" role="group" aria-label="Modo de visualización"><button data-mode="split" class="${state.mode === 'split' ? 'active' : ''}" aria-pressed="${state.mode === 'split'}">Lado a lado</button><button data-mode="unified" class="${state.mode === 'unified' ? 'active' : ''}" aria-pressed="${state.mode === 'unified'}">Unificado</button></div>${changes ? `<div class="change-navigation"><button id="previous-change" aria-label="Cambio anterior" ${state.activeHunk <= 0 ? 'disabled' : ''}>↑ Anterior</button><span id="change-position">Cambio ${Math.min(state.activeHunk + 1, changes)} de ${changes}</span><button id="next-change" aria-label="Siguiente cambio" ${state.activeHunk >= changes - 1 ? 'disabled' : ''}>Siguiente ↓</button></div>` : ''}<span class="toolbar-hint">${unresolved ? `${unresolved} pendientes · resuélvelos para completar la combinación` : 'La combinación está lista'}</span></div>
    ${changes ? state.mode === 'split' ? renderAlignedDiff() : renderUnifiedDiff() : '<div class="identical-card"><span>✓</span><div><strong>No hay diferencias</strong><p>Las dos versiones contienen exactamente el mismo texto.</p></div></div>'}
    <section class="merge-card"><div class="merge-heading"><div><span class="eyebrow-line"></span><span class="mini-label">RESULTADO COMBINADO</span><h3>Tu versión final</h3></div><div class="merge-actions"><button class="copy-button" id="copy-button" ${unresolved ? 'disabled title="Resuelve todos los cambios antes de copiar"' : ''}>▣ <span>Copiar texto</span></button><button class="download-button" id="download-button" ${unresolved ? 'disabled title="Resuelve todos los cambios antes de descargar"' : ''}>↓ <span>Descargar .txt</span></button></div></div>${unresolved ? `<div class="unresolved-note">${unresolved} ${unresolved === 1 ? 'cambio espera' : 'cambios esperan'} tu decisión. El resultado se actualizará aquí.</div>` : ''}<pre class="merged-preview" tabindex="0" aria-label="Vista previa del texto combinado">${merged ? safeText(merged) : '<span class="preview-placeholder">La vista previa aparecerá aquí.</span>'}</pre><div class="merge-foot"><span>${lineCount(merged).toLocaleString('es')} líneas en la combinación</span><span id="copy-status" aria-live="polite">Solo en este dispositivo</span></div></section>`;

  target.querySelectorAll('[data-choice]').forEach((button) => button.addEventListener('click', () => {
    const index = Number(button.closest('[data-hunk]').dataset.hunk);
    const choice = button.dataset.choice;
    state.decisions[index] = choice === 'clear' || state.decisions[index] === choice ? null : choice;
    const scrollTop = target.querySelector('.diff-file-body')?.scrollTop;
    renderResult();
    const refreshedBody = target.querySelector('.diff-file-body');
    if (refreshedBody && scrollTop !== undefined) refreshedBody.scrollTop = scrollTop;
    target.querySelector(`[data-hunk="${index}"] .choice-button[data-choice="${choice === 'left' ? 'left' : 'right'}"]`)?.focus();
  }));
  target.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => { state.mode = button.dataset.mode; renderResult(); target.querySelector(`[data-mode="${state.mode}"]`).focus(); }));
  target.querySelectorAll('[data-nav-hunk]').forEach((button) => button.addEventListener('click', () => goToHunk(Number(button.dataset.navHunk))));
  el('previous-change')?.addEventListener('click', () => goToHunk(state.activeHunk - 1));
  el('next-change')?.addEventListener('click', () => goToHunk(state.activeHunk + 1));
  el('download-button')?.addEventListener('click', downloadMerge);
  el('copy-button')?.addEventListener('click', copyMerge);
  updateOverviewMarkers();
}

function goToHunk(index) {
  const hunkIndices = state.sections.flatMap((section, sectionIndex) => section.type === 'hunk' ? [sectionIndex] : []);
  if (index < 0 || index >= hunkIndices.length) return;
  state.activeHunk = index;
  const marker = el('results').querySelector(`.diff-hunk-marker[data-hunk="${hunkIndices[index]}"]`);
  marker?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el('change-position').textContent = `Cambio ${index + 1} de ${hunkIndices.length}`;
  el('previous-change').disabled = index === 0;
  el('next-change').disabled = index === hunkIndices.length - 1;
}

function updateOverviewMarkers() {
  const body = el('results').querySelector('.diff-file-body');
  const track = el('results').querySelector('.diff-overview');
  if (!body || !track) return;
  const markers = [...track.querySelectorAll('[data-nav-hunk]')];
  const place = () => {
    const scale = body.scrollHeight ? 100 / body.scrollHeight : 0;
    markers.forEach((button) => {
      const marker = body.querySelector(`.diff-hunk-marker[data-hunk="${button.dataset.navHunk}"]`);
      if (marker) button.style.top = `${marker.offsetTop * scale}%`;
    });
  };
  place();
  body.addEventListener('scroll', () => {
    place();
    const hunkIndices = state.sections.flatMap((section, index) => section.type === 'hunk' ? [index] : []);
    let visible = 0;
    hunkIndices.forEach((index, ordinal) => {
      const marker = body.querySelector(`.diff-hunk-marker[data-hunk="${index}"]`);
      if (marker && marker.offsetTop <= body.scrollTop + body.clientHeight * 0.45) visible = ordinal;
    });
    state.activeHunk = visible;
    const position = el('change-position');
    if (position) position.textContent = `Cambio ${visible + 1} de ${hunkIndices.length}`;
    const previous = el('previous-change'), next = el('next-change');
    if (previous && next) { previous.disabled = visible === 0; next.disabled = visible === hunkIndices.length - 1; }
  }, { passive: true });
}

function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadMerge() {
  if (unresolvedCount(state.sections, state.decisions)) return;
  download('texto-combinado.txt', assemble(state.sections, state.decisions), 'text/plain;charset=utf-8');
}

async function copyMerge() {
  if (unresolvedCount(state.sections, state.decisions)) return;
  const content = assemble(state.sections, state.decisions);
  try {
    await navigator.clipboard.writeText(content);
    el('copy-status').textContent = 'Texto copiado al portapapeles';
  } catch {
    const temporary = document.createElement('textarea');
    temporary.value = content;
    temporary.style.position = 'fixed'; temporary.style.opacity = '0';
    document.body.append(temporary); temporary.select();
    const copied = document.execCommand('copy'); temporary.remove();
    el('copy-status').textContent = copied ? 'Texto copiado al portapapeles' : 'No se pudo copiar el texto';
  }
}

el('compare-button').addEventListener('click', () => {
  setError('');
  const left = leftInput.value;
  const right = rightInput.value;
  if (encoder.encode(left).byteLength + encoder.encode(right).byteLength > MAX_TOTAL_BYTES) {
    setError('El texto combinado supera el límite de 4 MB. Reduce el contenido e inténtalo de nuevo.');
    return;
  }
  state.sections = buildSections(left, right);
  state.decisions = [];
  state.activeHunk = 0;
  state.compared = true;
  renderResult();
  el('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

updateCounts();
