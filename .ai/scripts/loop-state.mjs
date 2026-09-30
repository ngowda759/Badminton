#!/usr/bin/env node
/**
 * Read and update the AI development loop state.
 *
 * Stages of the loop must use this helper instead of editing the JSON files by
 * hand, so every write is validated and every transition is recorded in the
 * history and the append-only review log.
 *
 * Usage:
 *   node .ai/scripts/loop-state.mjs status
 *   node .ai/scripts/loop-state.mjs set --status implementing --task AI-002-T1 --note "..."
 *   node .ai/scripts/loop-state.mjs set --status ci-running --pr 42 --branch automation/x --head <sha>
 *   node .ai/scripts/loop-state.mjs set --status reviewing --force --note "recovering"
 *   node .ai/scripts/loop-state.mjs next-round --note "round 2 review requested changes"
 *   node .ai/scripts/loop-state.mjs log --task AI-002-T1 --pr 42 --round 1 \
 *       --verdict changes-requested --ci failure [--findings findings.json]
 *   node .ai/scripts/loop-state.mjs reset --note "task merged"
 *
 * `set --status` is checked against the loop's state machine (see TRANSITIONS
 * below). An illegal step is refused unless `--force` is passed, and a forced
 * step is recorded in the history exactly like a legal one.
 *
 * Every mutation re-validates the state against the schemas and exits non-zero
 * on an invalid result. It never touches the network and never prints secrets.
 *
 * `AI_LOOP_ROOT` overrides the repository root. It exists so tests can drive the
 * real state machine against a throwaway copy of `.ai/` instead of the committed
 * state; production and CI runs never set it.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateAgainstSchema } from './loop-schema.mjs';

const root =
  process.env.AI_LOOP_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const configPath = resolve(root, '.ai/loop.config.json');
const statePath = resolve(root, '.ai/state/loop-state.json');
const reviewLogPath = resolve(root, '.ai/state/review-log.jsonl');
const schemasDir = resolve(root, '.ai/schemas');

const config = JSON.parse(readFileSync(configPath, 'utf8'));

/**
 * The explicit state machine of the loop.
 *
 * Each key is a status and each value is the set of statuses it may move to.
 * `blocked` is reachable from anywhere: a stage that cannot proceed must always
 * be allowed to stop for a human. `--force` exists for recovery, and every
 * forced transition is recorded in the history like any other.
 */
const TRANSITIONS = {
  idle: ['task-selected', 'implementing'],
  'task-selected': ['implementing'],
  implementing: ['ci-running'],
  'ci-running': ['reviewing', 'fixing'],
  reviewing: ['fixing', 'ready', 'human-merge'],
  fixing: ['ci-running', 'reviewing'],
  ready: ['human-merge', 'complete'],
  'merge-gate': ['ready', 'human-merge', 'complete'],
  'human-merge': ['complete'],
  blocked: ['idle', 'implementing', 'reviewing', 'fixing', 'human-merge'],
  complete: ['idle'],
};

function isTransitionAllowed(from, to) {
  if (from === to) return true;
  if (to === 'blocked') return true;
  return (TRANSITIONS[from] ?? []).includes(to);
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function readState() {
  return JSON.parse(readFileSync(statePath, 'utf8'));
}

function validateState(state) {
  const errors = validateAgainstSchema(state, resolve(schemasDir, 'loop-state.schema.json'));
  if (errors.length > 0) {
    console.error('Refusing to write an invalid loop state:');
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
}

function writeState(state, note) {
  state.maxReviewRounds = config.maxReviewRounds;
  state.updatedAt = nowIso();
  if (note !== undefined) {
    state.history.push({ at: state.updatedAt, status: state.status, note });
  }
  validateState(state);
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function requireString(args, key) {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) {
    console.error(`missing required option --${key}`);
    process.exit(2);
  }
  return value;
}

function toInteger(value, label) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    console.error(`--${label} must be a non-negative integer`);
    process.exit(2);
  }
  return parsed;
}

function commandStatus() {
  const state = readState();
  console.log(`loop      ${state.loopId}`);
  console.log(`status    ${state.status}`);
  console.log(`round     ${state.round}/${state.maxReviewRounds}`);
  console.log(`task      ${state.currentTaskId ?? '-'}`);
  console.log(
    `pr        ${state.currentPr === null ? '-' : `#${state.currentPr.number} (${state.currentPr.branch} @ ${state.currentPr.headSha.slice(0, 7)})`}`,
  );
  console.log(`updated   ${state.updatedAt}`);
  const last = state.history.at(-1);
  if (last !== undefined) console.log(`last note ${last.note}`);
}

function commandSet(args) {
  const state = readState();
  const previousStatus = state.status;

  if (args.status !== undefined) {
    const next = requireString(args, 'status');
    if (!isTransitionAllowed(previousStatus, next)) {
      if (args.force !== true) {
        console.error(
          `refusing the transition ${previousStatus} -> ${next}: not a legal step of the loop state machine`,
        );
        console.error(
          `  legal next states from ${previousStatus}: ${(TRANSITIONS[previousStatus] ?? []).join(', ') || '(none)'}, blocked`,
        );
        console.error(
          '  pass --force to record the transition anyway (it is logged in the history)',
        );
        process.exit(1);
      }
      console.error(`forcing the transition ${previousStatus} -> ${next}`);
    }
    state.status = next;
  }

  if (args.round !== undefined) state.round = toInteger(args.round, 'round');
  if (args.task !== undefined) state.currentTaskId = args.task === 'none' ? null : args.task;
  if (args.pr !== undefined) {
    const number = toInteger(args.pr, 'pr');
    state.currentPr = {
      number,
      branch: requireString(args, 'branch'),
      headSha: requireString(args, 'head'),
    };
  }
  if (args['clear-pr'] === true) state.currentPr = null;
  writeState(state, typeof args.note === 'string' ? args.note : undefined);
  commandStatus();
}

function commandNextRound(args) {
  const state = readState();
  if (state.round >= config.maxReviewRounds) {
    // Record the truth before failing: the loop stops here for a human.
    state.status = 'blocked';
    writeState(
      state,
      typeof args.note === 'string'
        ? args.note
        : `review round limit reached (${state.round}/${config.maxReviewRounds}); blocked for a human`,
    );
    console.error(
      `round limit reached (${state.round}/${config.maxReviewRounds}); the loop is now blocked and needs a human`,
    );
    process.exit(1);
  }
  state.round += 1;
  if (state.status !== 'blocked') state.status = 'reviewing';
  writeState(state, typeof args.note === 'string' ? args.note : `review round ${state.round}`);
  commandStatus();
}

function commandReset(args) {
  const state = readState();
  state.status = 'idle';
  state.round = 0;
  state.currentTaskId = null;
  state.currentPr = null;
  writeState(state, typeof args.note === 'string' ? args.note : 'loop reset for the next task');
  commandStatus();
}

function commandLog(args) {
  const record = {
    taskId: requireString(args, 'task'),
    pr: toInteger(requireString(args, 'pr'), 'pr'),
    round: toInteger(requireString(args, 'round'), 'round'),
    verdict: requireString(args, 'verdict'),
    ciStatus: typeof args.ci === 'string' ? args.ci : 'unknown',
    findings: [],
    reviewedAt: nowIso(),
  };
  if (typeof args.head === 'string') record.headSha = args.head;
  if (typeof args.findings === 'string') {
    if (!existsSync(args.findings)) {
      console.error(`--findings file not found: ${args.findings}`);
      process.exit(2);
    }
    const parsed = JSON.parse(readFileSync(args.findings, 'utf8'));
    if (!Array.isArray(parsed)) {
      console.error('--findings must contain a JSON array of findings');
      process.exit(2);
    }
    record.findings = parsed;
  }
  const errors = validateAgainstSchema(record, resolve(schemasDir, 'review-report.schema.json'));
  if (errors.length > 0) {
    console.error('Refusing to append an invalid review record:');
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  appendFileSync(reviewLogPath, `${JSON.stringify(record)}\n`);
  console.log(`appended review round ${record.round} for ${record.taskId} (${record.verdict})`);
}

const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

switch (command) {
  case 'status':
    commandStatus();
    break;
  case 'set':
    commandSet(args);
    break;
  case 'next-round':
    commandNextRound(args);
    break;
  case 'log':
    commandLog(args);
    break;
  case 'reset':
    commandReset(args);
    break;
  default:
    console.error('usage: loop-state.mjs <status|set|next-round|log|reset> [--key value ...]');
    process.exit(2);
}
