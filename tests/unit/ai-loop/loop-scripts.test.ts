import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * The AI development loop's own tooling.
 *
 * These scripts are the contract the loop's workflows rely on, so they are
 * exercised through their real entry points (a child process, the same way
 * GitHub Actions invokes them) rather than by importing their internals. The
 * suite is read-only: it never mutates `.ai/state/`.
 */

const root = resolve(import.meta.dirname, '..', '..', '..');

function run(script: string, args: string[] = []): { status: number; stdout: string } {
  const result = spawnSync('node', [resolve(root, '.ai/scripts', script), ...args], {
    cwd: root,
    encoding: 'utf8',
  });
  return { status: result.status ?? -1, stdout: result.stdout };
}

describe('AI loop scripts', () => {
  it('accepts the committed loop configuration, schemas and state', () => {
    const { status, stdout } = run('validate-loop-config.mjs');
    expect(status).toBe(0);
    expect(stdout).toContain('valid');
  });

  it('accepts every workflow file, including the loop workflows', () => {
    const { status, stdout } = run('validate-workflows.mjs');
    expect(status).toBe(0);
    expect(stdout).toContain('ai-loop-validate.yml');
    expect(stdout).toContain('ci.yml');
  });

  it('proves the trusted review workflows never execute pull-request code', () => {
    const { status, stdout } = run('assert-trusted-review.mjs');
    expect(status).toBe(0);
    expect(stdout).toContain('security check passed');
  });

  it('reports the loop state without mutating it', () => {
    const { status, stdout } = run('loop-state.mjs', ['status']);
    expect(status).toBe(0);
    expect(stdout).toMatch(/^loop {6}AI-001$/m);
    expect(stdout).toMatch(/^round {5}0\/3$/m);
  });

  it('classifies changed areas and flags protected paths', () => {
    const { status, stdout } = run('detect-changed-areas.mjs', [
      '--json',
      '.ai/loop.config.json',
      'apps/api/src/app.ts',
      'prisma/migrations/20260101000000_x/migration.sql',
    ]);
    expect(status).toBe(0);

    const report = JSON.parse(stdout) as {
      changedFiles: number;
      areas: Record<string, number>;
      protectedPaths: string[];
      exceedsFileLimit: boolean;
    };
    expect(report.changedFiles).toBe(3);
    expect(report.areas).toMatchObject({ 'ai-loop': 1, api: 1, database: 1 });
    expect(report.protectedPaths).toEqual(['prisma/migrations/20260101000000_x/migration.sql']);
    expect(report.exceedsFileLimit).toBe(false);
  });

  it('fails the run when a change exceeds the configured file limit', () => {
    const paths = Array.from({ length: 61 }, (_, index) => `apps/web/src/file-${index}.ts`);
    const { status, stdout } = run('detect-changed-areas.mjs', ['--json', ...paths]);
    expect(status).toBe(1);
    expect(JSON.parse(stdout)).toMatchObject({ exceedsFileLimit: true });
  });
});

describe('AI loop state machine', () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'badminton-loop-'));
    cpSync(resolve(root, '.ai'), join(scratch, '.ai'), { recursive: true });
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  function runState(args: string[]): { status: number; stdout: string; stderr: string } {
    const result = spawnSync('node', [resolve(root, '.ai/scripts/loop-state.mjs'), ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, AI_LOOP_ROOT: scratch },
    });
    return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
  }

  function readScratchState(): {
    status: string;
    round: number;
    currentTaskId: string | null;
    history: { note: string }[];
  } {
    return JSON.parse(readFileSync(join(scratch, '.ai/state/loop-state.json'), 'utf8')) as {
      status: string;
      round: number;
      currentTaskId: string | null;
      history: { note: string }[];
    };
  }

  it('never mutates the committed state when reading', () => {
    const before = readFileSync(resolve(root, '.ai/state/loop-state.json'), 'utf8');
    runState(['status']);
    expect(readFileSync(resolve(root, '.ai/state/loop-state.json'), 'utf8')).toBe(before);
  });

  it('increments the round and records the transition in history', () => {
    const { status } = runState(['next-round', '--note', 'round 1 review']);
    expect(status).toBe(0);

    const state = readScratchState();
    expect(state.round).toBe(1);
    expect(state.status).toBe('reviewing');
    expect(state.history.at(-1)?.note).toBe('round 1 review');
  });

  it('blocks the loop when the review round limit is reached', () => {
    expect(runState(['set', '--round', '3']).status).toBe(0);
    const { status } = runState(['next-round']);
    expect(status).toBe(1);

    const state = readScratchState();
    expect(state.round).toBe(3);
    expect(state.status).toBe('blocked');
  });

  it('activates the next task without a human approval gate', () => {
    // The autonomous loop picks a task up on its own: the brief is the
    // implementation contract, and there is no `humanApproval: true` to flip.
    const queuePath = join(scratch, '.ai/state/task-queue.json');
    const queue = JSON.parse(readFileSync(queuePath, 'utf8')) as {
      tasks: { id: string; status: string; humanApproval: boolean }[];
    };
    const task = queue.tasks[0];
    if (task === undefined) throw new Error('expected a seeded task in the queue');
    task.status = 'approved';
    task.humanApproval = false;
    writeFileSync(queuePath, `${JSON.stringify(queue, null, 2)}\n`);

    const { status } = runState(['set', '--task', task.id, '--status', 'implementing', '--force']);
    expect(status).toBe(0);
    expect(readScratchState().currentTaskId).toBe(task.id);

    // Validation no longer demands a human sign-off, so the state is accepted.
    const validation = spawnSync('node', [resolve(root, '.ai/scripts/validate-loop-config.mjs')], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, AI_LOOP_ROOT: scratch },
    });
    expect(validation.status).toBe(0);
  });

  it('starts a queued task and refuses a second concurrent task', () => {
    const queuePath = join(scratch, '.ai/state/task-queue.json');
    const queue = JSON.parse(readFileSync(queuePath, 'utf8')) as {
      tasks: Record<string, unknown>[];
    };
    const first = queue.tasks[0];
    if (first === undefined) throw new Error('expected a seeded task in the queue');
    first.status = 'approved';
    queue.tasks.push({
      ...first,
      id: 'AI-002',
      title: 'second task',
      status: 'approved',
      dependsOn: ['AI-001'],
      pr: null,
      branch: null,
      headSha: null,
    });
    writeFileSync(queuePath, `${JSON.stringify(queue, null, 2)}\n`);

    const runTasks = (args: string[]) => {
      const result = spawnSync('node', [resolve(root, '.ai/scripts/loop-tasks.mjs'), ...args], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, AI_LOOP_ROOT: scratch },
      });
      return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
    };

    expect(runTasks(['start', '--task', 'AI-001']).status).toBe(0);

    // A second implementation while the first is in flight must be refused.
    const second = runTasks(['start', '--task', 'AI-002']);
    expect(second.status).toBe(1);
    expect(second.stderr).toContain('maxConcurrentTasks');
  });

  it('refuses a queue that holds two tasks waiting to be implemented', () => {
    const queuePath = join(scratch, '.ai/state/task-queue.json');
    const queue = JSON.parse(readFileSync(queuePath, 'utf8')) as {
      tasks: Record<string, unknown>[];
    };
    const first = queue.tasks[0];
    if (first === undefined) throw new Error('expected a seeded task in the queue');
    queue.tasks.push(
      { ...first, id: 'AI-002', title: 'second task', status: 'approved', dependsOn: ['AI-001'] },
      { ...first, id: 'AI-003', title: 'third task', status: 'approved', dependsOn: ['AI-002'] },
    );
    writeFileSync(queuePath, `${JSON.stringify(queue, null, 2)}\n`);

    const validation = spawnSync('node', [resolve(root, '.ai/scripts/validate-loop-config.mjs')], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, AI_LOOP_ROOT: scratch },
    });
    expect(validation.status).toBe(1);
    expect(validation.stderr).toContain('waiting to be implemented');
  });

  it('refuses to append an out-of-sequence task or a second queued task', () => {
    const brief = join(scratch, 'brief.json');
    const write = (id: string) => {
      writeFileSync(
        brief,
        JSON.stringify({
          id,
          title: 'a generated task',
          phase: 'phase-9',
          status: 'proposed',
          summary: 'something real',
          acceptanceCriteria: ['`npm test` passes'],
          outOfScope: ['mobile'],
          humanApproval: false,
          createdAt: '2026-09-30T00:00:00Z',
        }),
      );
    };

    const runTasks = (args: string[]) => {
      const result = spawnSync('node', [resolve(root, '.ai/scripts/loop-tasks.mjs'), ...args], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, AI_LOOP_ROOT: scratch },
      });
      return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
    };

    // AI-001 is done, so the next id in sequence is AI-002.
    write('AI-004');
    const outOfSequence = runTasks(['append', '--file', brief]);
    expect(outOfSequence.status).toBe(1);
    expect(outOfSequence.stderr).toContain('out of sequence');

    write('AI-002');
    expect(runTasks(['append', '--file', brief]).status).toBe(0);

    // A second task beyond the active one would build a speculative backlog.
    write('AI-003');
    const second = runTasks(['append', '--file', brief]);
    expect(second.status).toBe(1);
    expect(second.stderr).toMatch(/still active|beyond the active one/);
  });

  it('appends a schema-valid review record and rejects an invalid verdict', () => {
    const accepted = runState([
      'log',
      '--task',
      'AI-001',
      '--pr',
      '42',
      '--round',
      '1',
      '--verdict',
      'changes-requested',
      '--ci',
      'failure',
    ]);
    expect(accepted.status).toBe(0);

    const log = readFileSync(join(scratch, '.ai/state/review-log.jsonl'), 'utf8').trim();
    expect(JSON.parse(log)).toMatchObject({
      taskId: 'AI-001',
      pr: 42,
      round: 1,
      verdict: 'changes-requested',
      ciStatus: 'failure',
    });

    const rejected = runState([
      'log',
      '--task',
      'AI-001',
      '--pr',
      '42',
      '--round',
      '2',
      '--verdict',
      'looks-fine',
    ]);
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain('Refusing to append');
  });
});
