import { diffLines } from 'diff';

/** Convert jsdiff line segments into unchanged regions and independently resolvable hunks. */
export function buildSections(left, right) {
  const segments = diffLines(left, right, { newlineIsToken: false });
  const sections = [];
  let pending = null;

  const flush = () => {
    if (!pending) return;
    sections.push({ type: 'hunk', left: pending.left, right: pending.right });
    pending = null;
  };

  for (const segment of segments) {
    if (segment.added || segment.removed) {
      pending ??= { left: '', right: '' };
      if (segment.removed) pending.left += segment.value;
      if (segment.added) pending.right += segment.value;
    } else {
      flush();
      sections.push({ type: 'equal', value: segment.value });
    }
  }
  flush();
  return sections;
}

export function assemble(sections, decisions = []) {
  return sections.map((section, index) => {
    if (section.type === 'equal') return section.value;
    if (decisions[index] === 'left') return section.left;
    if (decisions[index] === 'right') return section.right;
    return '';
  }).join('');
}

export function unresolvedCount(sections, decisions) {
  return sections.reduce((count, section, index) =>
    count + (section.type === 'hunk' && !decisions[index] ? 1 : 0), 0);
}

/** Line-aligned split rows with stable hunk IDs and per-side line numbers. */
export function buildAlignedRows(left, right) {
  const segments = diffLines(left, right, { newlineIsToken: false });
  const rows = [];
  let pending = null;
  let hunkId = 0;
  const splitLines = (text) => text ? text.split(/(?<=\n)/) : [];
  const flush = () => {
    if (!pending) return;
    const removed = splitLines(pending.left);
    const added = splitLines(pending.right);
    for (let i = 0, n = Math.max(removed.length, added.length); i < n; i += 1) {
      const oldLine = removed[i] ?? null;
      const newLine = added[i] ?? null;
      rows.push({ type: oldLine === null ? 'add' : newLine === null ? 'delete' : 'change', left: oldLine, right: newLine, hunkId });
    }
    hunkId += 1;
    pending = null;
  };
  for (const segment of segments) {
    if (segment.added || segment.removed) {
      pending ??= { left: '', right: '' };
      if (segment.removed) pending.left += segment.value;
      if (segment.added) pending.right += segment.value;
    } else {
      flush();
      for (const line of splitLines(segment.value)) rows.push({ type: 'equal', left: line, right: line, hunkId: null });
    }
  }
  flush();
  let leftNo = 1, rightNo = 1;
  return rows.map((row) => {
    const numbered = { ...row, leftNo: row.left === null ? null : leftNo, rightNo: row.right === null ? null : rightNo };
    if (row.left !== null) leftNo += 1;
    if (row.right !== null) rightNo += 1;
    return numbered;
  });
}

export function lineCount(text) {
  if (!text) return 0;
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}
