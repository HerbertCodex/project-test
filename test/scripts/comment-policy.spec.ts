import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findingsOf } from '../../scripts/comment-policy.mjs';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function findings(source: string) {
  const root = mkdtempSync(join(tmpdir(), 'comment-policy-'));
  roots.push(root);
  const path = join(root, 'sample.ts');
  writeFileSync(path, source);
  return findingsOf(path);
}

describe('comment policy lexical scanning', () => {
  it('does not read comment delimiters inside a regular-expression literal', () => {
    expect(findings("const cleaned = input.replace(/\\/\\*[\\s\\S]*?\\*\\//g, ' ');\n")).toEqual([]);
  });

  it('evaluates consecutive line comments as one explanation', () => {
    expect(findings([
      '// The base reference comes from several candidates',
      '// because CI uses a shallow checkout.',
      'const base = resolveBase();',
      '',
    ].join('\n'))).toEqual([]);
  });

  it('still refuses a short narrative line', () => {
    expect(findings('// Increment the counter\ncounter += 1;\n')).toEqual([
      { line: 1, kind: 'narration', text: 'Increment the counter' },
    ]);
  });
});
