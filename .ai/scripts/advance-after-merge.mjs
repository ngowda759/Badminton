#!/usr/bin/env node
/**
 * Advance the loop after a pull request merge.
 *
 * Runs on `pull_request: closed`. It decides whether the merge completes the
 * loop's active task and, if so, records it: the task becomes `done`, the loop
 * moves through `completed` to `next-task`, and the reviewer's outstanding
 * findings are carried onto the task record so the architect can read them.
 *
 * A pull request that closed *without* merging is a hard stop, not a normal
 * event: the loop must not silently generate the next task when its own pull
 * request was abandoned, and it must not merge anything either.
 *
 * Usage (from a workflow step):
 *   node .ai/scripts/advance-after-merge.mjs
 *
 * Environment:
 *   GH_TOKEN, GITHUB_REPOSITORY, MERGED_PR, MERGED_SHA, MERGED_BRANCH
 *   AI_LOOP_ROOT   overrides the repository root (tests only)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadConfig, REPO_ROOT } from './loop-core.mjs';
import { parseReviewMarkers } from './review-core.mjs';

const root = process.env.AI_LOOP_ROOT ?? REPO_ROOT;
const config = loadConfig(root);
const repo = process.env.GITHUB_REPOSITORY ?? 'ngowda759/Badminton';

function log(message) {
  console.log(message);
}

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function readJson(path, label) {
  if (!existsSync(path)) fail(`missing ${label}: ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function ghJson(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8' });
  if (result.status !== 0) fail(`gh ${args.join(' ')} failed:\n${result.stderr.trim()}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    fail(`gh ${args.join(' ')} returned non-JSON output: ${error.message}`);
  }
}

function runState(args) {
  const result = spawnSync('node', [resolve(root, '.ai/scripts/loop-state.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) fail(`loop-state ${args.join(' ')} failed:\n${result.stderr.trim()}`);
  return result.stdout;
}

function stop(event, note) {
  runState(['stop', '--event', event, '--note', note]);
  console.error(`hard stop recorded: ${event}`);
  process.exit(1);
}

const prNumber = Number.parseInt(process.env.MERGED_PR ?? '', 10);
if (!Number.isInteger(prNumber) || prNumber < 1) fail('MERGED_PR must be a pull request number', 2);

const statePath = resolve(root, config.paths.state);
const queuePath = resolve(root, config.paths.queue);
const state = readJson(statePath, 'loop state');
const queue = readJson(queuePath, 'task queue');

const pr = ghJson([
  'pr',
  'view',
  String(prNumber),
  '--repo',
  repo,
  '--json',
  'number,state,merged,mergedAt,mergeCommit,headRefName,baseRefName,isCrossRepository,labels,comments,title',
]);

if (pr.merged !== true) {
  // The loop's own pull request was closed without merging. That is a human
  // decision the loop cannot interpret, so it stops rather than guessing.
  stop('merge-conflict', `PR #${prNumber} was closed without merging`);
}

// Only the loop's own pull request advances the loop. Anything else is a
// pull request the loop does not own and must not act on.
const recorded = state.currentPr ?? null;
const isRecordedPr = recorded !== null && recorded.number === prNumber;
const looksLikeLoopPr =
  typeof pr.headRefName === 'string' && pr.headRefName.startsWith(config.branchPrefix);
if (!isRecordedPr && !looksLikeLoopPr) {
  log(`PR #${prNumber} is not an AI-loop pull request; nothing to advance.`);
  process.exit(0);
}

const taskId = state.currentTaskId;
if (typeof taskId !== 'string' || taskId.length === 0) {
  // A merged loop pull request with no active task means the state lost track.
  // Do not invent a task; stop for a human.
  stop('state-corruption', `PR #${prNumber} merged but the loop state has no active task`);
}

const task = queue.tasks.find((candidate) => candidate.id === taskId);
if (task === undefined) {
  stop('state-corruption', `active task ${taskId} is not present in the task queue`);
}

// Carry the reviewer's outstanding findings onto the task so the architect can
// read what the review actually found, not just that it approved.
const verdicts = [];
for (const comment of pr.comments ?? []) {
  for (const marker of parseReviewMarkers(comment?.body ?? '')) {
    if (marker.verdict !== null) verdicts.push(marker);
  }
}
const lastVerdict = verdicts.sort((a, b) => a.round - b.round).at(-1);

task.status = 'done';
task.pr = prNumber;
task.branch = pr.headRefName;
task.headSha = pr.mergeCommit?.oid ?? process.env.MERGED_SHA ?? task.headSha ?? null;
task.mergedAt = pr.mergedAt ?? new Date().toISOString();
task.completedAt = new Date().toISOString();
if (lastVerdict !== undefined && lastVerdict.verdict === 'changes-requested') {
  task.reviewFindings = [`round ${lastVerdict.round}: ${lastVerdict.verdict}`];
}
queue.updatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
writeFileSync(queuePath, `${JSON.stringify(queue, null, 2)}\n`);
log(`recorded ${taskId} as done (PR #${prNumber} merged).`);

// completed -> next-task. Both steps are legal transitions and are recorded.
runState(['complete', '--task', taskId, '--note', `PR #${prNumber} merged`]);
runState(['set', '--status', 'next-task', '--note', 'advancing to next-task generation']);
log('the loop is ready to generate the next task.');
