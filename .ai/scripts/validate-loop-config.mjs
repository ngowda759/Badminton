#!/usr/bin/env node
/**
 * Validate the AI development loop configuration and state.
 *
 * Checks:
 *   - `.ai/loop.config.json` against `.ai/schemas/loop-config.schema.json`
 *   - `.ai/state/loop-state.json` against `loop-state.schema.json`
 *   - `.ai/state/task-queue.json` against `task-queue.schema.json`
 *   - every `review-log.jsonl` line against `review-report.schema.json`
 *   - cross-file invariants (round bounds, active task, protected-path syntax)
 *
 * Dependency-free and deterministic: it reads the repository only.
 * Exit code 0 when valid, 1 when any check fails.
 *
 * `AI_LOOP_ROOT` overrides the repository root so tests can validate a
 * throwaway copy of `.ai/`; production and CI runs never set it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateAgainstSchema } from './loop-schema.mjs';

const root =
  process.env.AI_LOOP_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const failures = [];

function fail(message) {
  failures.push(message);
}

function readJson(relativePath) {
  const absolute = resolve(root, relativePath);
  if (!existsSync(absolute)) {
    fail(`missing file: ${relativePath}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(absolute, 'utf8'));
  } catch (error) {
    fail(`invalid JSON in ${relativePath}: ${error.message}`);
    return null;
  }
}

function validateFile(relativePath, schemaName, value) {
  const schema = resolve(root, '.ai', 'schemas', schemaName);
  const errors = validateAgainstSchema(value, schema);
  for (const error of errors) fail(`${relativePath}: ${error}`);
  return errors.length === 0;
}

// --- configuration ---------------------------------------------------------
const config = readJson('.ai/loop.config.json');
if (config !== null) validateFile('.ai/loop.config.json', 'loop-config.schema.json', config);

// --- state -----------------------------------------------------------------
const state = readJson('.ai/state/loop-state.json');
if (state !== null) validateFile('.ai/state/loop-state.json', 'loop-state.schema.json', state);

const queue = readJson('.ai/state/task-queue.json');
if (queue !== null) validateFile('.ai/state/task-queue.json', 'task-queue.schema.json', queue);

// --- review log ------------------------------------------------------------
const reviewLogPath = resolve(root, '.ai/state/review-log.jsonl');
if (!existsSync(reviewLogPath)) {
  fail('missing file: .ai/state/review-log.jsonl');
} else {
  const lines = readFileSync(reviewLogPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  lines.forEach((line, index) => {
    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      fail(`.ai/state/review-log.jsonl:${index + 1}: invalid JSON: ${error.message}`);
      return;
    }
    validateFile(`.ai/state/review-log.jsonl:${index + 1}`, 'review-report.schema.json', record);
  });
}

// --- cross-file invariants -------------------------------------------------
if (config !== null && state !== null) {
  if (state.maxReviewRounds !== config.maxReviewRounds) {
    fail(
      `loop-state.maxReviewRounds (${state.maxReviewRounds}) does not match loop.config (${config.maxReviewRounds})`,
    );
  }
  if (state.round > config.maxReviewRounds) {
    fail(`loop-state.round (${state.round}) exceeds maxReviewRounds (${config.maxReviewRounds})`);
  }
  if (state.loopId !== config.loopId) {
    fail(`loop-state.loopId (${state.loopId}) does not match loop.config (${config.loopId})`);
  }

  for (const pattern of config.protectedPaths) {
    if (pattern.startsWith('/') || isAbsolute(pattern) || pattern.includes('..')) {
      fail(`protectedPaths entry is not repository-relative: ${pattern}`);
    }
  }

  for (const configuredPath of Object.values(config.paths)) {
    if (!existsSync(resolve(root, configuredPath))) {
      fail(`loop.config.paths points at a missing file: ${configuredPath}`);
    }
  }

  if (config.review !== undefined && !existsSync(resolve(root, config.review.schema))) {
    fail(`loop.config.review.schema points at a missing file: ${config.review.schema}`);
  }
  if (config.review !== undefined && config.review.endpoint.startsWith('http://')) {
    fail('loop.config.review.endpoint must use https');
  }
}

if (state !== null && queue !== null) {
  const ids = queue.tasks.map((task) => task.id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  for (const duplicate of new Set(duplicates)) fail(`duplicate task id in queue: ${duplicate}`);

  if (state.currentTaskId !== null) {
    const active = queue.tasks.find((task) => task.id === state.currentTaskId);
    if (active === undefined) {
      fail(`loop-state.currentTaskId ${state.currentTaskId} is not present in the task queue`);
    } else if (active.humanApproval !== true) {
      fail(`active task ${state.currentTaskId} has not been approved by a human`);
    }
  }
}

if (failures.length > 0) {
  console.error(`AI loop validation failed with ${failures.length} error(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('AI loop configuration and state are valid.');
