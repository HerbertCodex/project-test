import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
const script = join(process.cwd(), 'scripts', 'commit-subjects.mjs');

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function git(root: string, args: string[]) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function write(root: string, path: string, content: string) {
  writeFileSync(join(root, path), content);
}

function fixtureWithMergeCommit() {
  const root = mkdtempSync(join(tmpdir(), 'commit-subjects-'));
  roots.push(root);
  mkdirSync(join(root, 'pipeline', 'store'), { recursive: true });
  write(root, 'pipeline/store/issues.jsonl', '{"id":"i-fixture"}\n');
  write(root, 'README.md', 'base\n');
  git(root, ['init', '--initial-branch=main']);
  git(root, ['config', 'user.email', 'test@example.test']);
  git(root, ['config', 'user.name', 'Pipeline test']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'feat(i-fixture): initialize fixture']);
  git(root, ['switch', '-c', 'feature']);
  write(root, 'feature.txt', 'feature\n');
  git(root, ['add', '.']);
  git(root, [
    'commit',
    '-m',
    'fix: commit subject fixture\n\ndirect: Test of a human-authored direct commit.',
  ]);
  git(root, ['switch', 'main']);
  write(root, 'main.txt', 'main\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'feat(i-fixture): update main']);
  git(root, ['switch', 'feature']);
  git(root, ['merge', 'main', '--no-ff', '-m', 'Merge main into feature']);
  return root;
}

describe('commit subjects', () => {
  it('ignores a synthetic merge commit while checking human commits', () => {
    const root = fixtureWithMergeCommit();

    expect(
      execFileSync(process.execPath, [script], { cwd: root, encoding: 'utf8' }),
    ).toContain('1 commit(s) en avance');
  });
});
