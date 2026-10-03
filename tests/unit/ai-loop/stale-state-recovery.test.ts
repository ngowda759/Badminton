import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  assertSingleActiveTask,
  isRecoverableNextTaskState,
  loadConfig,
  REPO_ROOT,
} from '../../../.ai/scripts/loop-core.mjs';

/**
 * Stale-state recovery.
 *
 * The loop stalled after AI-001 / PR #19: the task and pull request had already
 * completed, but `.ai/state/loop-state.json` was never advanced to `next-task`.
 * Two things kept it stalled:
 *
 *   1. `assertSingleActiveTask` treated every status except `idle`/`complete`
 *      (note: the real status is `completed`, so even a finished loop counted)
 *      as owning an open automation pull request — `next-task` deliberately does
 *      not, so the guard rejected a legitimate between-tasks state.
 *   2. nothing restarted the loop once the state was already sitting in a
 *      recoverable `next-task` state with no active task or PR.
 *
 * These tests pin both repairs. `assertSingleActiveTask` and
 * `isRecoverableNextTaskState` are pure and tested directly; the recovery path
 * is exercised through its real entry points (a child process, exactly as GitHub
 * Actions invokes them) against a throwaway copy of `.ai/`.
 */

const root = REPO_ROOT;
const config = loadConfig(root);

type Status = string;

function state(status: Status, overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    loopId: config.loopId,
    status,
    round: 0,
    maxReviewRounds: config.maxReviewRounds,
    currentTaskId: null,
    currentPr: null,
    lastVerdict: null,
    lastCiStatus: null,
    reviewedHeadSha: null,
    blockedReason: null,
    completedTasks: ['AI-001'],
    updatedAt: '2026-10-01T00:00:00Z',
    history: [],
    ...overrides,
  };
}

function queue(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    updatedAt: '2026-10-01T00:00:00Z',
    tasks: [
      {
        id: 'AI-001',
        title: 'Establish the autonomous AI development loop',
        phase: 'infrastructure',
        status: 'done',
        summary: 'loop infrastructure',
        acceptanceCriteria: ['validates'],
        outOfScope: [],
        humanApproval: false,
        dependsOn: [],
        createdAt: '2026-09-30T00:00:00Z',
        pr: 19,
        branch: 'automation/ai-development-loop',
      },
    ],
    ...overrides,
  };
}

describe('assertSingleActiveTask and the inactive statuses', () => {
  it('passes next-task with no active task or pull request', () => {
    const guard = assertSingleActiveTask({
      state: state('next-task'),
      queue: queue(),
      openPrs: [],
      config,
    });
    expect(guard.ok).toBe(true);
    expect(guard.errors).toEqual([]);
    expect(guard.activePr).toBeNull();
  });

  it('passes idle, completed and next-task (the intended inactive states)', () => {
    for (const status of ['idle', 'completed', 'next-task']) {
      const guard = assertSingleActiveTask({
        state: state(status),
        queue: queue(),
        openPrs: [],
        config,
      });
      expect(guard.ok, `${status} must be inactive`).toBe(true);
    }
  });

  it('still fails implementing with no active pull request', () => {
    const guard = assertSingleActiveTask({
      state: state('implementing'),
      queue: queue(),
      openPrs: [],
      config,
    });
    expect(guard.ok).toBe(false);
    expect(guard.errors.join('\n')).toContain('no automation pull request is open');
  });

  it('still fails reviewing with no active pull request', () => {
    const guard = assertSingleActiveTask({
      state: state('reviewing'),
      queue: queue(),
      openPrs: [],
      config,
    });
    expect(guard.ok).toBe(false);
    expect(guard.errors.join('\n')).toContain('no automation pull request is open');
  });

  it('still fails every active implementation status with no pull request', () => {
    for (const status of [
      'architecting',
      'implementing',
      'ci-running',
      'reviewing',
      'fixing',
      'ready-to-merge',
      'merging',
    ]) {
      const guard = assertSingleActiveTask({
        state: state(status),
        queue: queue(),
        openPrs: [],
        config,
      });
      expect(guard.ok, `${status} must remain active`).toBe(false);
    }
  });

  it('still refuses two open AI-managed pull requests', () => {
    const guard = assertSingleActiveTask({
      state: state('implementing', {
        currentPr: { number: 1, branch: 'feat/a', headSha: 'a'.repeat(40) },
      }),
      queue: queue(),
      openPrs: [
        { number: 1, branch: 'feat/a', base: 'main', title: '[AI-002] a', isAutomation: true },
        { number: 2, branch: 'feat/b', base: 'main', title: '[AI-002] b', isAutomation: true },
      ],
      config,
    });
    expect(guard.ok).toBe(false);
    expect(guard.errors.join('\n')).toContain('maxConcurrentTasks');
  });
});

describe('isRecoverableNextTaskState', () => {
  it('accepts next-task with no task and no pull request', () => {
    expect(isRecoverableNextTaskState(state('next-task'))).toBe(true);
  });

  it('refuses an active status', () => {
    expect(isRecoverableNextTaskState(state('implementing'))).toBe(false);
  });

  it('refuses next-task that still names a task or a pull request', () => {
    expect(isRecoverableNextTaskState(state('next-task', { currentTaskId: 'AI-002' }))).toBe(false);
    expect(
      isRecoverableNextTaskState(
        state('next-task', {
          currentPr: { number: 42, branch: 'feat/x', headSha: 'a'.repeat(40) },
        }),
      ),
    ).toBe(false);
  });

  it('accepts next-task only when the queue holds no pending task', () => {
    // The queue is the durable record. A `next-task` state whose queue already
    // holds a task awaiting implementation is not a stall — the architect's
    // dispatch ran and re-dispatching would generate a duplicate next task.
    const done = queue();
    expect(isRecoverableNextTaskState(state('next-task'), done)).toBe(true);

    for (const status of [
      'proposed',
      'queued',
      'approved',
      'in-progress',
      'in-review',
      'ready-to-merge',
    ]) {
      const pending = queue({
        tasks: [
          ...queue().tasks,
          { ...queue().tasks[0], id: 'AI-002', status, pr: null, branch: null },
        ],
      });
      expect(isRecoverableNextTaskState(state('next-task'), pending), status).toBe(false);
    }
  });

  it('still accepts next-task when the only queued task is done', () => {
    const finished = queue({
      tasks: [...queue().tasks, { ...queue().tasks[0], id: 'AI-002', status: 'done', pr: 28 }],
    });
    expect(isRecoverableNextTaskState(state('next-task'), finished)).toBe(true);
  });
});

describe('stale-state recovery (loop-state.mjs recover)', () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'badminton-recover-'));
    cpSync(resolve(root, '.ai'), join(scratch, '.ai'), { recursive: true });
    // Pin the queue to a fixed one-task baseline: the live queue gains AI-002,
    // AI-003, … as the loop runs, and these tests assert recovery never appends.
    writeFileSync(
      join(scratch, '.ai/state/task-queue.json'),
      `${JSON.stringify(queue(), null, 2)}\n`,
    );
    mkdirSync(join(scratch, 'bin'), { recursive: true });
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  function writeState(loopState: Record<string, unknown>) {
    writeFileSync(
      join(scratch, '.ai/state/loop-state.json'),
      `${JSON.stringify(loopState, null, 2)}\n`,
    );
  }

  function readState(): Record<string, unknown> {
    return JSON.parse(readFileSync(join(scratch, '.ai/state/loop-state.json'), 'utf8')) as Record<
      string,
      unknown
    >;
  }

  function recover(args: string[] = []) {
    const result = spawnSync(
      'node',
      [resolve(root, '.ai/scripts/loop-state.mjs'), 'recover', ...args],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, AI_LOOP_ROOT: scratch },
      },
    );
    return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
  }

  it('repairs a stale completed -> next-task state and stays schema-valid', () => {
    // The exact state the loop was stuck in: AI-001 completed, PR #19 recorded,
    // never advanced.
    writeState(
      state('completed', {
        currentTaskId: 'AI-001',
        currentPr: {
          number: 19,
          branch: 'automation/ai-development-loop',
          headSha: '0'.repeat(40),
        },
        lastVerdict: 'approved',
        lastCiStatus: 'success',
        reviewedHeadSha: '0'.repeat(40),
      }),
    );

    const { status } = recover();
    expect(status).toBe(0);

    const repaired = readState();
    expect(repaired.status).toBe('next-task');
    expect(repaired.currentTaskId).toBeNull();
    expect(repaired.currentPr).toBeNull();
    expect(repaired.lastVerdict).toBeNull();
    expect(repaired.lastCiStatus).toBeNull();
    expect(repaired.reviewedHeadSha).toBeNull();
    expect(repaired.blockedReason).toBeNull();
    expect(repaired.completedTasks).toEqual(['AI-001']);

    // The repair must remain schema-valid and preserve the history with a clear
    // recovery entry.
    const validation = spawnSync('node', [resolve(root, '.ai/scripts/validate-loop-config.mjs')], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, AI_LOOP_ROOT: scratch },
    });
    expect(validation.status).toBe(0);
    const history = repaired.history as { status: string; note: string }[];
    expect(history.at(-1)?.status).toBe('next-task');
    expect(history.at(-1)?.note).toMatch(/recovery/i);
  });

  it('does not create a task itself', () => {
    writeState(state('completed', { currentTaskId: 'AI-001' }));
    const before = readFileSync(join(scratch, '.ai/state/task-queue.json'), 'utf8');

    expect(recover().status).toBe(0);

    expect(readFileSync(join(scratch, '.ai/state/task-queue.json'), 'utf8')).toBe(before);
    const tasks = (JSON.parse(before) as { tasks: { id: string }[] }).tasks;
    expect(tasks.map((task) => task.id)).toEqual(['AI-001']);
  });

  it('refuses to recover from an active status', () => {
    writeState(
      state('implementing', {
        currentTaskId: 'AI-002',
        currentPr: { number: 42, branch: 'feat/x', headSha: 'a'.repeat(40) },
      }),
    );

    const { status, stderr } = recover();
    expect(status).toBe(1);
    expect(stderr).toContain('refusing to recover');
    expect(readState().status).toBe('implementing');
  });
});

describe('push-event recovery (advance-after-merge.mjs)', () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'badminton-push-recovery-'));
    cpSync(resolve(root, '.ai'), join(scratch, '.ai'), { recursive: true });
    writeFileSync(
      join(scratch, '.ai/state/task-queue.json'),
      `${JSON.stringify(queue(), null, 2)}\n`,
    );
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  function runPush(loopState: Record<string, unknown>) {
    writeFileSync(
      join(scratch, '.ai/state/loop-state.json'),
      `${JSON.stringify(loopState, null, 2)}\n`,
    );
    const outputFile = join(scratch, 'github-output.txt');
    writeFileSync(outputFile, '');
    const result = spawnSync('node', [resolve(root, '.ai/scripts/advance-after-merge.mjs')], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        AI_LOOP_ROOT: scratch,
        GITHUB_OUTPUT: outputFile,
        EVENT_NAME: 'push',
      },
    });
    const managed =
      /^managed=(true|false)$/m.exec(readFileSync(outputFile, 'utf8'))?.[1] === 'true';
    return { status: result.status ?? -1, managed, stdout: result.stdout };
  }

  it('dispatches the architect for a recoverable next-task state', () => {
    const result = runPush(state('next-task'));
    expect(result.status).toBe(0);
    expect(result.managed).toBe(true);
  });

  it('does nothing for an active state', () => {
    const result = runPush(
      state('implementing', {
        currentTaskId: 'AI-002',
        currentPr: { number: 42, branch: 'feat/x', headSha: 'a'.repeat(40) },
      }),
    );
    expect(result.status).toBe(0);
    expect(result.managed).toBe(false);
  });

  it('does nothing for a completed state that still names a task (state/queue mismatch)', () => {
    const result = runPush(state('completed', { currentTaskId: 'AI-002' }));
    expect(result.managed).toBe(false);
  });

  it('does not re-dispatch the architect when the queue already holds the next task', () => {
    // A `next-task` state whose queue already holds an approved/in-flight task
    // is not a stall: dispatching the architect again would generate a duplicate
    // next task. This is the post-reconciliation shape on `main` (state
    // `next-task`, queue holding AI-003 as `approved`).
    writeFileSync(
      join(scratch, '.ai/state/task-queue.json'),
      `${JSON.stringify(
        queue({
          tasks: [
            queue().tasks[0],
            { ...queue().tasks[0], id: 'AI-002', status: 'done', pr: 28 },
            { ...queue().tasks[0], id: 'AI-003', status: 'approved', pr: null, branch: null },
          ],
        }),
        null,
        2,
      )}\n`,
    );
    const result = runPush(state('next-task'));
    expect(result.status).toBe(0);
    expect(result.managed).toBe(false);
  });
});

describe('architect / next-task stage owns AI-002 generation', () => {
  it('the next-task prompt still instructs the architect to append exactly one task', () => {
    const prompt = readFileSync(resolve(root, '.ai/prompts/next-task.md'), 'utf8');
    expect(prompt).toMatch(/append/i);
    expect(prompt).toMatch(/loop-tasks\.mjs append/);
    expect(prompt).toMatch(/next id in sequence/i);
  });

  it('the recovery path never appends a task itself', () => {
    // The push recovery only reports `managed=true`; appending is the architect
    // conversation's job. A recovery that created a task would make the loop
    // invent work instead of asking the architect for it.
    const script = readFileSync(resolve(root, '.ai/scripts/advance-after-merge.mjs'), 'utf8');
    const pushBranch = script.slice(
      script.indexOf("EVENT_NAME === 'push'"),
      script.indexOf('const prNumber'),
    );
    expect(pushBranch).not.toMatch(/loop-tasks\.mjs/);
    expect(pushBranch).not.toMatch(/\bappend\b/);
  });
});

describe('dispatch-conversation host resolution', () => {
  function dryRun(env: Record<string, string | undefined>): { host: string; url: string } {
    const result = spawnSync(
      'node',
      [resolve(root, '.ai/scripts/dispatch-conversation.mjs'), '--stage', 'next-task', '--dry-run'],
      { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } },
    );
    expect(result.status, result.stderr).toBe(0);
    const start = result.stdout.indexOf('{');
    return JSON.parse(result.stdout.slice(start)) as { host: string; url: string };
  }

  it('falls back to the default host when OPENHANDS_HOST is unset', () => {
    const payload = dryRun({ OPENHANDS_HOST: undefined });
    expect(payload.host).toBe('https://app.all-hands.dev');
    expect(payload.url).toBe('https://app.all-hands.dev/api/v1/app-conversations');
  });

  it('falls back to the default host when OPENHANDS_HOST is an empty string', () => {
    // `${{ vars.OPENHANDS_HOST }}` is injected as an empty string when the
    // repository variable is unset; a bare `?? default` would keep the empty
    // value and produce an invalid URL (ERR_INVALID_URL) — the exact failure
    // that broke the first recovery dispatch.
    const payload = dryRun({ OPENHANDS_HOST: '' });
    expect(payload.host).toBe('https://app.all-hands.dev');
    expect(payload.url).toBe('https://app.all-hands.dev/api/v1/app-conversations');
  });

  it('honours a configured host and strips a trailing slash', () => {
    const payload = dryRun({ OPENHANDS_HOST: 'https://example.test/' });
    expect(payload.host).toBe('https://example.test');
    expect(payload.url).toBe('https://example.test/api/v1/app-conversations');
  });
});
