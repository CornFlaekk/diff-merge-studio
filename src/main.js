import { assemble, buildSections, lineCount, unresolvedCount } from './diff-logic.js';
import './style.css';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const encoder = new TextEncoder();
const state = {
  sections: [], decisions: [], comments: {}, globalComment: '',
  mode: 'split', leftName: 'Versión original', rightName: 'Versión nueva',
  error: '', compared: false,
};

document.querySelector('#app').innerHTML = `
  <header class="topbar">
    <a class="brand" href="#" aria-label="Entre líneas, inicio"><span class="brand-mark" aria-hidden="true">↔</span><span>entre<span class="brand-light">líneas</span></span></a>
    <span class="privacy-pill"><span class="privacy-dot"></span>Privado por diseño</span>
  </header>
  <main>
    <section class="hero">
      <div class="eyebrow"><span class="eyebrow-line"></span>COMPARA · DECIDE · COMBINA</div>
      <h1>Dos versiones.<br /><em>Una decisión clara.</em></h1>
      <p>Compara textos línea a línea, elige qué conservar en cada cambio y crea tu versión final. Todo sucede en este navegador.</p>
    </section>

    <section class="input-grid" aria-label="Textos para comparar">
      <article class="input-card">
        <div class="card-head"><label for="left-text">01 <span>VERSIÓN ORIGINAL</span></label><span class="file-badge" id="left-file-label">Texto pegado</span></div>
        <textarea id="left-text" spellcheck="false" placeholder="Pega aquí el primer texto…" aria-label="Texto de la versión original"></textarea>
        <div class="input-foot"><span id="left-count">0 líneas</span><label class="file-button" for="left-file">＋ Elegir archivo<input id="left-file" type="file" accept=".txt,.md,.csv,.json,.xml,.html,.css,.js,.ts,.py,.yml,.yaml,.log,text/*" /></label></div>
      </article>
      <article class="input-card">
        <div class="card-head"><label for="right-text">02 <span>VERSIÓN NUEVA</span></label><span class="file-badge" id="right-file-label">Texto pegado</span></div>
        <textarea id="right-text" spellcheck="false" placeholder="Pega aquí la segunda versión…" aria-label="Texto de la versión nueva"></textarea>
        <div class="input-foot"><span id="right-count">0 líneas</span><label class="file-button" for="right-file">＋ Elegir archivo<input id="right-file" type="file" accept=".txt,.md,.csv,.json,.xml,.html,.css,.js,.ts,.py,.yml,.yaml,.log,text/*" /></label></div>
      </article>
    </section>

    <div class="action-row"><p class="local-note"><span aria-hidden="true">◉</span> Sin cargas ni cuentas. Tus textos no salen del dispositivo.</p><button class="primary-button" id="compare-button">Comparar versiones <span aria-hidden="true">→</span></button></div>
    <p id="error-message" class="error-message" role="alert" hidden></p>
    <section id="results" hidden aria-live="polite"></section>
    <footer><span>ENTRE LÍNEAS <span class="footer-sep">/</span> UNA HERRAMIENTA LOCAL</span><a href="https://github.com" target="_blank" rel="noreferrer">Hecho para pensar con claridad <span aria-hidden="true">↗</span></a></footer>
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

function classifyHunk(hunk) {
  if (!hunk.left) return 'insert';
  if (!hunk.right) return 'delete';
  return 'change';
}

function renderCode(text, kind, emptyText) {
  const lines = text ? text.split(/(?<=\n)/) : [];
  if (lines.length && lines.at(-1) === '') lines.pop();
  if (!lines.length) return `<div class="code-empty">${escapeHtml(emptyText)}</div>`;
  return `<ol class="code-lines ${kind}">${lines.map((line) => `<li><code>${safeText(line.replace(/\n$/, '')) || '&nbsp;'}</code></li>`).join('')}</ol>`;
}

function renderHunk(section, index) {
  const type = classifyHunk(section);
  const hunkNumber = state.sections.slice(0, index + 1).filter((part) => part.type === 'hunk').length;
  const choice = state.decisions[index];
  const title = type === 'insert' ? 'Solo en la versión nueva' : type === 'delete' ? 'Solo en la versión original' : 'Cambio en ambas versiones';
  const leftLines = lineCount(section.left);
  const rightLines = lineCount(section.right);
  const status = choice ? (choice === 'left' ? 'Conserva original' : 'Conserva nueva') : 'Sin resolver';
  const pane = (side, name, text) => `<div class="compare-pane ${choice === side ? 'chosen' : ''}"><div class="pane-label"><span>${escapeHtml(name)}</span><span>${lineCount(text)} ${lineCount(text) === 1 ? 'línea' : 'líneas'}</span></div>${renderCode(text, side === 'left' ? 'removed' : 'added', side === 'left' ? 'Sin líneas en original' : 'Sin líneas en nueva')}</div>`;
  const content = state.mode === 'split'
    ? `<div class="diff-split">${pane('left', state.leftName, section.left)}${pane('right', state.rightName, section.right)}</div>`
    : `<div class="diff-unified">${section.left ? `<div class="unified-line removed"><span aria-label="Eliminada">−</span>${safeText(section.left)}</div>` : ''}${section.right ? `<div class="unified-line added"><span aria-label="Añadida">＋</span>${safeText(section.right)}</div>` : ''}</div>`;
  return `<article class="hunk ${type}" data-hunk="${index}">
    <header class="hunk-head"><div><span class="hunk-number">CAMBIO ${String(hunkNumber).padStart(2, '0')}</span><strong>${title}</strong></div><span class="hunk-state ${choice ? 'resolved' : ''}">${choice ? '✓ ' : '○ '}${status}</span></header>
    ${content}
    <div class="hunk-controls"><span class="choose-label">CONSERVAR</span><button class="choice-button ${choice === 'left' ? 'selected' : ''}" data-choice="left" aria-pressed="${choice === 'left'}" aria-label="En el cambio ${hunkNumber}: conservar la versión original">← Original <span>${leftLines} ${leftLines === 1 ? 'línea' : 'líneas'}</span></button><button class="choice-button ${choice === 'right' ? 'selected' : ''}" data-choice="right" aria-pressed="${choice === 'right'}" aria-label="En el cambio ${hunkNumber}: conservar la versión nueva">Nueva → <span>${rightLines} ${rightLines === 1 ? 'línea' : 'líneas'}</span></button><button class="clear-choice" data-choice="clear" aria-label="Dejar el cambio ${hunkNumber} sin resolver">Deshacer elección</button></div>
    <label class="comment-label" for="comment-${index}">NOTA PARA ESTE CAMBIO <span>· OPCIONAL</span></label><textarea class="comment-input" id="comment-${index}" data-comment="${index}" rows="2" placeholder="Añade contexto o una pregunta…">${escapeHtml(state.comments[index] || '')}</textarea>
  </article>`;
}

function renderResult() {
  const target = el('results');
  if (!state.compared) { target.hidden = true; return; }
  target.hidden = false;
  const hunks = state.sections.map((section, index) => section.type === 'hunk' ? renderHunk(section, index) : '').join('');
  const changes = state.sections.filter((section) => section.type === 'hunk').length;
  const unresolved = unresolvedCount(state.sections, state.decisions);
  const merged = assemble(state.sections, state.decisions);
  const statusText = changes ? `${changes} ${changes === 1 ? 'cambio' : 'cambios'} · ${unresolved ? `${unresolved} sin resolver` : 'todo resuelto'}` : 'Los textos son idénticos';
  target.innerHTML = `
    <div class="results-heading"><div><div class="eyebrow"><span class="eyebrow-line"></span>REVISIÓN DE CAMBIOS</div><h2>Elige lo que <em>se queda.</em></h2></div><div class="summary-badge ${unresolved ? 'pending' : 'complete'}"><span class="summary-dot"></span>${statusText}</div></div>
    <div class="toolbar"><div class="mode-switch" role="group" aria-label="Modo de visualización"><button data-mode="split" class="${state.mode === 'split' ? 'active' : ''}" aria-pressed="${state.mode === 'split'}">Lado a lado</button><button data-mode="unified" class="${state.mode === 'unified' ? 'active' : ''}" aria-pressed="${state.mode === 'unified'}">Unificado</button></div><span class="toolbar-hint">${unresolved ? 'Resuelve cada cambio para completar la combinación' : 'La combinación está lista'}</span></div>
    ${changes ? `<div class="hunk-list">${hunks}</div>` : '<div class="identical-card"><span>✓</span><div><strong>No hay diferencias</strong><p>Las dos versiones contienen exactamente el mismo texto.</p></div></div>'}
    <section class="merge-card"><div class="merge-heading"><div><span class="eyebrow-line"></span><span class="mini-label">RESULTADO COMBINADO</span><h3>Tu versión final</h3></div><button class="download-button" id="download-button" ${unresolved ? 'disabled title="Resuelve todos los cambios antes de descargar"' : ''}>↓ <span>Descargar .txt</span></button></div>${unresolved ? `<div class="unresolved-note">${unresolved} ${unresolved === 1 ? 'cambio espera' : 'cambios esperan'} tu decisión. El resultado se actualizará aquí.</div>` : ''}<pre class="merged-preview" tabindex="0" aria-label="Vista previa del texto combinado">${merged ? safeText(merged) : '<span class="preview-placeholder">La vista previa aparecerá aquí.</span>'}</pre><div class="merge-foot"><span>${lineCount(merged).toLocaleString('es')} líneas en la combinación</span><span>Solo en este dispositivo</span></div></section>
    <section class="notes-card"><div class="notes-heading"><div><span class="mini-label">CONTEXTO ADICIONAL</span><h3>Notas de revisión</h3></div><button class="export-button" id="export-button">↓ Exportar notas .md</button></div><label class="comment-label" for="global-comment">NOTA GENERAL <span>· OPCIONAL</span></label><textarea class="comment-input global-comment" id="global-comment" rows="3" placeholder="Contexto para toda la revisión…">${escapeHtml(state.globalComment)}</textarea><p class="notes-foot">Las notas se incluyen en la exportación Markdown; no se guardan ni se envían.</p></section>`;

  target.querySelectorAll('[data-choice]').forEach((button) => button.addEventListener('click', () => {
    const index = Number(button.closest('[data-hunk]').dataset.hunk);
    const choice = button.dataset.choice;
    state.decisions[index] = choice === 'clear' || state.decisions[index] === choice ? null : choice;
    renderResult();
    target.querySelector(`[data-hunk="${index}"] .choice-button[data-choice="${choice === 'left' ? 'left' : 'right'}"]`)?.focus();
  }));
  target.querySelectorAll('[data-comment]').forEach((textarea) => textarea.addEventListener('input', () => { state.comments[textarea.dataset.comment] = textarea.value; }));
  target.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => { state.mode = button.dataset.mode; renderResult(); target.querySelector(`[data-mode="${state.mode}"]`).focus(); }));
  el('global-comment').addEventListener('input', (event) => { state.globalComment = event.target.value; });
  el('download-button')?.addEventListener('click', downloadMerge);
  el('export-button').addEventListener('click', exportNotes);
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

function exportNotes() {
  const rows = ['# Notas de revisión', '', `- Original: ${state.leftName}`, `- Nueva: ${state.rightName}`, ''];
  if (state.globalComment.trim()) rows.push('## Nota general', '', state.globalComment.trim(), '');
  let hunkNumber = 0;
  state.sections.forEach((section, index) => {
    if (section.type !== 'hunk') return;
    hunkNumber += 1;
    const comment = state.comments[index]?.trim();
    if (!comment) return;
    rows.push(`## Cambio ${hunkNumber}`, '', `**Decisión:** ${state.decisions[index] === 'left' ? 'Conservar original' : state.decisions[index] === 'right' ? 'Conservar nueva' : 'Sin resolver'}`, '', comment, '');
  });
  if (!state.globalComment.trim() && !Object.values(state.comments).some((comment) => comment.trim())) rows.push('_No se añadieron notas._', '');
  download('notas-de-revision.md', rows.join('\n'), 'text/markdown;charset=utf-8');
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
  state.comments = {};
  state.compared = true;
  renderResult();
  el('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

updateCounts();
