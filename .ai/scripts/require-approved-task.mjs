#!/usr/bin/env node
/**
 * Guard: a task may only be implemented once a human has approved it.
 *
 * The implementation stage must never start from a brief the architect wrote but
 * a human has not signed off on. This script is the single place that check
 * lives, so the workflow and the dispatch path cannot drift apart.
 *
 * Usage:
 *   node .ai/scripts/require-approved-task.mjs AI-002-T1
 *
 * Exit code 0 when the task exists and `humanApproval` is `true`, 2 when the id
 * is missing, 1 when the task is unapproved. `AI_LOOP_ROOT` overrides the
 * repository root for tests.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root =
  process.env.AI_LOOP_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const config = JSON.parse(readFileSync(resolve(root, '.ai/loop.config.json'), 'utf8'));
const queue = JSON.parse(readFileSync(resolve(root, config.paths.queue), 'utf8'));

const taskId = process.argv[2];
if (typeof taskId !== 'string' || taskId.length === 0) {
  console.error('usage: require-approved-task.mjs <task-id>');
  process.exit(2);
}

const task = queue.tasks.find((candidate) => candidate.id === taskId);
if (task === undefined) {
  console.error(`task ${taskId} is not present in ${config.paths.queue}`);
  process.exit(2);
}
if (task.humanApproval !== true) {
  console.error(`task ${taskId} is not approved by a human; refusing to implement it`);
  process.exit(1);
}

console.log(`task ${task.id} approved: ${task.title}`);
