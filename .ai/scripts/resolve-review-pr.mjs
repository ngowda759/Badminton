#!/usr/bin/env node
/**
 * Resolve which pull request a trusted `workflow_run` job should act on.
 *
 * A `workflow_run` event does not always carry the pull request number — for a
 * fork it is empty, and for a branch push there is no pull request at all. This
 * script resolves the number from the event, the branch name or an explicit
 * input, verifies the pull request is an AI-loop pull request from this
 * repository, and writes `number` to `$GITHUB_OUTPUT`.
 *
 * It writes an empty `number` (and exits 0) when there is nothing to review, so
 * the calling job can skip rather than fail on an unrelated CI run.
 *
 * Usage (from a workflow step):
 *   node .ai/scripts/resolve-review-pr.mjs
 *
 * Environment:
 *   GH_TOKEN, GITHUB_REPOSITORY, HEAD_BRANCH, HEAD_SHA, EVENT_PR, INPUT_PR
 *   GITHUB_OUTPUT   the file to append the `number=` output to
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

import { loadConfig, REPO_ROOT } from './loop-core.mjs';

const config = loadConfig(REPO_ROOT);
const repo = process.env.GITHUB_REPOSITORY ?? 'ngowda759/Badminton';
const outputFile = process.env.GITHUB_OUTPUT;

function emit(number) {
  if (outputFile !== undefined) appendFileSync(outputFile, `number=${number}\n`);
  console.log(`review target: ${number === '' ? '(none)' : `PR #${number}`}`);
}

function gh(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8' });
  return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function ghJson(args) {
  const result = gh(args);
  if (!result.ok) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function isLoopPullRequest(pr) {
  if (pr === null || typeof pr !== 'object') return false;
  if (pr.isCrossRepository === true) return false;
  if (pr.baseRefName !== config.baseBranch) return false;
  const branch = typeof pr.headRefName === 'string' ? pr.headRefName : '';
  const labelled = (pr.labels ?? []).some(
    (label) => label?.name === config.automation.triggerLabel,
  );
  return branch.startsWith(config.branchPrefix) || labelled;
}

const candidates = [];
if (typeof process.env.INPUT_PR === 'string' && process.env.INPUT_PR.length > 0) {
  candidates.push(Number.parseInt(process.env.INPUT_PR, 10));
}
if (typeof process.env.EVENT_PR === 'string' && process.env.EVENT_PR.length > 0) {
  candidates.push(Number.parseInt(process.env.EVENT_PR, 10));
}

const branch = process.env.HEAD_BRANCH ?? '';
if (branch.startsWith(config.branchPrefix)) {
  const list = ghJson([
    'pr',
    'list',
    '--repo',
    repo,
    '--head',
    branch,
    '--state',
    'open',
    '--json',
    'number,headRefName,baseRefName,isCrossRepository,labels,title',
    '--limit',
    '10',
  ]);
  for (const pr of Array.isArray(list) ? list : []) {
    if (isLoopPullRequest(pr)) candidates.push(pr.number);
  }
}

for (const number of candidates.filter((value) => Number.isInteger(value) && value > 0)) {
  const pr = ghJson([
    'pr',
    'view',
    String(number),
    '--repo',
    repo,
    '--json',
    'number,headRefName,baseRefName,isCrossRepository,labels,title,state',
  ]);
  if (isLoopPullRequest(pr) && pr.state === 'OPEN') {
    emit(number);
    process.exit(0);
  }
}

// Nothing to review: an unrelated CI run, a closed PR, or a fork. Not an error.
emit('');
process.exit(0);
