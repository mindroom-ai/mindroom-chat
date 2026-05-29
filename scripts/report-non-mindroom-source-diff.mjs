#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workTree = process.cwd();
const gitFile = resolve(workTree, '.git');
const env = { ...process.env };

if (existsSync(gitFile)) {
  const gitFileBody = readFileSync(gitFile, 'utf8').trim();
  const gitdirPrefix = 'gitdir: ';
  if (gitFileBody.startsWith(gitdirPrefix)) {
    env.GIT_DIR = gitFileBody.slice(gitdirPrefix.length);
    env.GIT_WORK_TREE = workTree;
  }
}

const [base = 'v4.11.1', target = 'HEAD'] = process.argv.slice(2);
const diffRange = `${base}..${target}`;
const output = execFileSync(
  'git',
  ['diff', '--name-status', '--find-renames', diffRange, '--', 'src'],
  { cwd: workTree, env, encoding: 'utf8' }
);

const rows = output
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const parts = line.split('\t');
    const path = parts[parts.length - 1];
    return { status: parts[0], path };
  })
  .filter(({ path }) => path.startsWith('src/') && !path.startsWith('src/app/mindroom/'));

const groups = new Map();
for (const row of rows) {
  const parts = row.path.split('/');
  const key = parts[1] === 'app' ? `src/app/${parts[2] ?? ''}` : `src/${parts[1] ?? ''}`;
  groups.set(key, (groups.get(key) ?? 0) + 1);
}

console.log(`Non-MindRoom source files changed in ${diffRange}: ${rows.length}`);
for (const [group, count] of [...groups.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(count).padStart(4, ' ')} ${group}`);
}

if (rows.length > 0) {
  console.log('');
  for (const row of rows) {
    console.log(`${row.status}\t${row.path}`);
  }
}
