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

export function lineCount(text) {
  if (!text) return 0;
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}
