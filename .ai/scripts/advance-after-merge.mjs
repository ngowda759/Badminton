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
 * It also runs on a `push` that changes the loop state files (`EVENT_NAME=push`).
 * In that mode it is a recovery check only: when the state is a legitimate
 * `next-task` state with no active task or pull request it reports
 * `managed=true` so the workflow dispatches the architect, and otherwise reports
 * `managed=false`. It never advances a merge, creates a task or touches a pull
 * request on the push path.
 *
 * Usage (from a workflow step):
 *   node .ai/scripts/advance-after-merge.mjs
 *
 * Environment:
 *   GH_TOKEN, GITHUB_REPOSITORY, MERGED_PR, MERGED_SHA, MERGED_BRANCH
 *   EVENT_NAME     `push` selects the recovery path; anything else is a PR close
 *   AI_LOOP_ROOT   overrides the repository root (tests only)
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  isAiManagedPullRequest,
  isRecoverableNextTaskState,
  loadConfig,
  REPO_ROOT,
} from './loop-core.mjs';
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

/**
 * Write a `managed=` output for the workflow to gate on.
 *
 * The workflow cannot evaluate the loop's identity rules in a GitHub expression,
 * so this script — which runs from the trusted base branch — decides whether the
 * closed pull request is AI-managed and reports it. Anything other than a clear
 * `true` leaves the job skipped.
 */
function emitManaged(value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile !== undefined) {
    try {
      appendFileSync(outputFile, `managed=${value ? 'true' : 'false'}\n`);
    } catch (error) {
      fail(`could not write GITHUB_OUTPUT: ${error.message}`);
    }
  }
}

const statePath = resolve(root, config.paths.state);
const queuePath = resolve(root, config.paths.queue);

// --- push-event recovery ---------------------------------------------------
//
// The workflow also fires on a push that changes the loop state files. When the
// state lands in a legitimate `next-task` state with no active task or pull
// request — a merge whose architect dispatch never ran — the loop must restart
// itself rather than wait for a human. This is a *recovery* path, not a second
// generator: it only reports `managed=true` so the workflow dispatches the
// next-task conversation, exactly as the pull-request-closed path does. It never
// creates a task, never touches a pull request and never advances a merge.
if (process.env.EVENT_NAME === 'push') {
  const state = readJson(statePath, 'loop state');
  if (isRecoverableNextTaskState(state)) {
    emitManaged(true);
    log(
      'the loop is in a recoverable next-task state with no active task or pull request; dispatching the architect.',
    );
    process.exit(0);
  }
  emitManaged(false);
  log('the loop is not in a recoverable next-task state; nothing to recover.');
  process.exit(0);
}

const prNumber = Number.parseInt(process.env.MERGED_PR ?? '', 10);
if (!Number.isInteger(prNumber) || prNumber < 1) fail('MERGED_PR must be a pull request number', 2);

const state = readJson(statePath, 'loop state');
const queue = readJson(queuePath, 'task queue');

const pr = ghJson([
  'pr',
  'view',
  String(prNumber),
  '--repo',
  repo,
  '--json',
  'number,state,mergedAt,mergeCommit,headRefName,baseRefName,isCrossRepository,labels,comments,title',
]);

// Only an AI-managed pull request can affect the loop. The identity is the
// loop's own record — the recorded active PR, the trigger label, a trusted
// review marker, a queued task id — plus the loop's own `automation/*` branch.
// An implementation task on `feat/*` or `fix/*` is just as much the loop's own
// work, so branch naming alone must never be the test. This check runs first so
// that an unrelated pull request closing (with or without a merge) is a no-op
// rather than a hard stop.
const aiManaged = isAiManagedPullRequest({
  pr,
  state,
  queue,
  config,
  mergeCommitSha: pr.mergeCommit?.oid,
});
if (!aiManaged) {
  emitManaged(false);
  log(`PR #${prNumber} is not an AI-managed loop pull request; nothing to advance.`);
  process.exit(0);
}

// `gh pr view` has no `merged` boolean field; a merged pull request is one whose
// `mergedAt` is set. Asking for a non-existent field makes `gh` exit non-zero, so
// the previous field list made every next-task run fail before it advanced.
if (typeof pr.mergedAt !== 'string' || pr.mergedAt.length === 0) {
  // The loop's own pull request was closed without merging. That is a human
  // decision the loop cannot interpret, so it stops rather than guessing.
  stop('merge-conflict', `PR #${prNumber} was closed without merging`);
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

// Idempotency: a duplicate `pull_request: closed` delivery (or an operator
// re-run) must not generate the next task twice. The task's own `status` is the
// discriminator — the implementation stage already records `task.pr` before the
// merge, so the PR number alone cannot tell "about to advance" from "already
// advanced". A task already recorded `done` means the transition happened.
if (task.status === 'done') {
  emitManaged(false);
  log(`task ${taskId} is already recorded as done; nothing to advance.`);
  process.exit(0);
}

emitManaged(true);

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

// ready-to-merge -> merging -> completed -> next-task. The state machine
// requires the `merging` step, so the loop records it explicitly; jumping
// straight to `completed` would be refused as an illegal transition. A state
// that has already reached `merging` (a re-run) is not re-recorded.
const statusBeforeComplete = state.status;
if (statusBeforeComplete === 'ready-to-merge') {
  runState(['set', '--status', 'merging', '--note', `PR #${prNumber} merged`]);
}
runState(['complete', '--task', taskId, '--note', `PR #${prNumber} merged`]);
runState(['set', '--status', 'next-task', '--note', 'advancing to next-task generation']);
log('the loop is ready to generate the next task.');
