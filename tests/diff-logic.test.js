import test from 'node:test';
import assert from 'node:assert/strict';
import { assemble, buildSections, lineCount, unresolvedCount } from '../src/diff-logic.js';

test('identical text is a single unchanged section', () => {
  const sections = buildSections('one\ntwo\n', 'one\ntwo\n');
  assert.deepEqual(sections, [{ type: 'equal', value: 'one\ntwo\n' }]);
  assert.equal(assemble(sections), 'one\ntwo\n');
});

test('isolates edits and merges each selected side with equal context', () => {
  const sections = buildSections('keep\nold\nend\n', 'keep\nnew\nend\n');
  const hunkIndex = sections.findIndex((section) => section.type === 'hunk');
  assert.equal(sections[hunkIndex].left, 'old\n');
  assert.equal(sections[hunkIndex].right, 'new\n');
  assert.equal(assemble(sections, { [hunkIndex]: 'left' }), 'keep\nold\nend\n');
  assert.equal(assemble(sections, { [hunkIndex]: 'right' }), 'keep\nnew\nend\n');
});

test('represents insertions and deletions, leaving unresolved changes out', () => {
  const sections = buildSections('stay\nremove\n', 'stay\nadd\n');
  const hunks = sections.filter((section) => section.type === 'hunk');
  assert.equal(hunks.length, 1);
  assert.equal(unresolvedCount(sections, []), 1);
  assert.equal(assemble(sections, []), 'stay\n');
  assert.equal(assemble(sections, { [sections.indexOf(hunks[0])]: 'right' }), 'stay\nadd\n');
});

test('handles empty strings and final lines without a newline', () => {
  assert.deepEqual(buildSections('', 'new'), [{ type: 'hunk', left: '', right: 'new' }]);
  assert.deepEqual(buildSections('last', ''), [{ type: 'hunk', left: 'last', right: '' }]);
  assert.equal(lineCount('a\nb\n'), 2);
  assert.equal(lineCount('a\nb'), 2);
  assert.equal(lineCount(''), 0);
});
