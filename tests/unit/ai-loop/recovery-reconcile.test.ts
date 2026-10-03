import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  classifyMergedLoopPr,
  loadConfig,
  REPO_ROOT,
  selectMergedTaskPr,
} from '../../../.ai/scripts/loop-core.mjs';

/**
 * Manual (`workflow_dispatch`) recovery reconciliation.
 *
 * AI-003 / PR #30 merged, but the loop's own records still showed AI-003 as
 * `approved` and the loop as `next-task`, so the next-task architect received
 * contradictory context ("the previous task merged" while the queue still held
 * an approved task) and correctly refused to generate AI-004. The recovery path
 * must reconcile an already-merged AI task through the *same* merge-transition
 * logic as the normal `pull_request: closed` path — never a second
 * implementation, never a hard-coded task id, and never a duplicate.
 *
 * `selectMergedTaskPr` is pure and tested directly; the recovery path is
 * exercised through its real entry point (a child process with a stubbed `gh`),
 * exactly as GitHub Actions invokes it.
 */

const root = REPO_ROOT;
const config = loadConfig(root);

type Pr = NonNullable<Parameters<typeof selectMergedTaskPr>[0]['mergedPrs']>[number];

function mergedPr(overrides: Partial<Pr> = {}): Pr {
  return {
    number: 30,
    state: 'MERGED',
    mergedAt: '2026-10-03T04:08:39Z',
    mergeCommit: { oid: 'b'.repeat(40) },
    baseRefName: config.baseBranch,
    headRefName: 'automation/ai-003-knockout-correction',
    headRefOid: 'a'.repeat(40),
    isCrossRepository: false,
    labels: [],
    comments: [],
    title: '[AI-003] Knockout result correction with bracket re-derivation (TASK-9, parity gap G6)',
    ...overrides,
  };
}

/** The stale state on `main`: the loop is `next-task` with no active task/PR. */
function state(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    loopId: config.loopId,
    status: 'next-task',
    round: 0,
    maxReviewRounds: config.maxReviewRounds,
    currentTaskId: null,
    currentPr: null,
    lastVerdict: null,
    lastCiStatus: null,
    reviewedHeadSha: null,
    blockedReason: null,
    completedTasks: ['AI-001', 'AI-002'],
    updatedAt: '2026-10-03T00:00:00Z',
    history: [],
    ...overrides,
  };
}

/** The stale queue: AI-003 is still `approved` although its PR #30 merged. */
function queue(overrides: Record<string, unknown> = {}) {
  const base = {
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
  };
  return {
    version: 1,
    updatedAt: '2026-10-03T00:00:00Z',
    tasks: [
      base,
      { ...base, id: 'AI-002', status: 'done', pr: 28, branch: 'feat/match-result-correction' },
      { ...base, id: 'AI-003', status: 'approved', pr: null, branch: null, dependsOn: ['AI-002'] },
    ],
    ...overrides,
  };
}

describe('selectMergedTaskPr', () => {
  it('matches a merged AI pull request to its still-open queued task', () => {
    const selected = selectMergedTaskPr({
      mergedPrs: [mergedPr()],
      state: state(),
      queue: queue(),
      config,
    });
    expect(selected?.taskId).toBe('AI-003');
    expect(selected?.pr.number).toBe(30);
  });

  it('never attributes an [AI-INFRA] merge to a task', () => {
    const selected = selectMergedTaskPr({
      mergedPrs: [
        mergedPr({
          number: 35,
          headRefName: 'fix/ai-loop-infra-reconcile',
          title: '[AI-INFRA] Reconcile an infrastructure merge instead of hard-stopping the loop',
        }),
      ],
      state: state(),
      queue: queue(),
      config,
    });
    expect(selected).toBeNull();
  });

  it('never matches an unrelated merged pull request', () => {
    const selected = selectMergedTaskPr({
      mergedPrs: [mergedPr({ number: 99, headRefName: 'feature/readme', title: 'Fix the readme' })],
      state: state(),
      queue: queue(),
      config,
    });
    expect(selected).toBeNull();
  });

  it('never re-completes a task already recorded done', () => {
    const selected = selectMergedTaskPr({
      mergedPrs: [mergedPr()],
      state: state({ completedTasks: ['AI-001', 'AI-002', 'AI-003'] }),
      queue: queue({
        tasks: [...queue().tasks.slice(0, 2), { ...queue().tasks[2], status: 'done', pr: 30 }],
      }),
      config,
    });
    expect(selected).toBeNull();
  });

  it('matches a task still in review whose merge the loop missed', () => {
    const selected = selectMergedTaskPr({
      mergedPrs: [mergedPr()],
      state: state(),
      queue: queue({
        tasks: [...queue().tasks.slice(0, 2), { ...queue().tasks[2], status: 'in-review', pr: 30 }],
      }),
      config,
    });
    expect(selected?.taskId).toBe('AI-003');
  });

  it('ignores a pull request that did not merge', () => {
    const selected = selectMergedTaskPr({
      mergedPrs: [mergedPr({ mergedAt: null })],
      state: state(),
      queue: queue(),
      config,
    });
    expect(selected).toBeNull();
  });
});

describe('workflow_dispatch recovery (advance-after-merge.mjs)', () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'badminton-recovery-'));
    cpSync(resolve(root, '.ai'), join(scratch, '.ai'), { recursive: true });
    mkdirSync(join(scratch, 'bin'), { recursive: true });
    // Stub `gh`: the dispatch recovery only calls `gh pr list --state merged`.
    const gh = join(scratch, 'bin', 'gh');
    writeFileSync(
      gh,
      [
        '#!/usr/bin/env bash',
        'set -u',
        'case "$1 $2" in',
        '  "pr list") printf \'%s\' "${GH_PR_LIST:-[]}" ;;',
        '  "pr view") cat "$GH_PR_FIXTURE" ;;',
        '  *) printf \'%s\' "" ;;',
        'esac',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  function seed(loopState = state(), taskQueue = queue()) {
    writeFileSync(join(scratch, '.ai/state/loop-state.json'), JSON.stringify(loopState, null, 2));
    writeFileSync(join(scratch, '.ai/state/task-queue.json'), JSON.stringify(taskQueue, null, 2));
  }

  function readQueue(): { tasks: { id: string; status: string; pr?: number | null }[] } {
    return JSON.parse(readFileSync(join(scratch, '.ai/state/task-queue.json'), 'utf8')) as {
      tasks: { id: string; status: string; pr?: number | null }[];
    };
  }

  function readState(): {
    status: string;
    completedTasks?: string[];
    blockedReason?: string | null;
  } {
    return JSON.parse(readFileSync(join(scratch, '.ai/state/loop-state.json'), 'utf8')) as {
      status: string;
      completedTasks?: string[];
      blockedReason?: string | null;
    };
  }

  function run(mergedPrs: Pr[]) {
    const outputFile = join(scratch, 'github-output.txt');
    writeFileSync(outputFile, '');
    const result = spawnSync('node', [resolve(root, '.ai/scripts/advance-after-merge.mjs')], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${join(scratch, 'bin')}:${process.env.PATH ?? ''}`,
        AI_LOOP_ROOT: scratch,
        GITHUB_OUTPUT: outputFile,
        GH_PR_LIST: JSON.stringify(mergedPrs),
        EVENT_NAME: 'workflow_dispatch',
      },
    });
    const managed =
      /^managed=(true|false)$/m.exec(readFileSync(outputFile, 'utf8'))?.[1] === 'true';
    return { status: result.status ?? -1, managed, stdout: result.stdout, stderr: result.stderr };
  }

  it('(1) detects the merged AI-003 PR, marks it done and moves the loop to next-task', () => {
    seed();
    const result = run([mergedPr()]);
    expect(result.status).toBe(0);
    expect(result.managed).toBe(true);

    const loop = readState();
    expect(loop.status).toBe('next-task');
    expect(loop.completedTasks).toContain('AI-003');

    const task = readQueue().tasks.find((candidate) => candidate.id === 'AI-003');
    expect(task?.status).toBe('done');
    expect(task?.pr).toBe(30);
  });

  it('(2) leaves the loop ready to generate exactly AI-004', () => {
    seed();
    expect(run([mergedPr()]).managed).toBe(true);

    // The architect generates the next task through the real queue helper: the
    // recovered queue's next id is exactly AI-004, never AI-005.
    const brief = join(scratch, 'brief.json');
    writeFileSync(
      brief,
      JSON.stringify({
        id: 'AI-004',
        title: 'a generated task',
        phase: 'phase-9',
        status: 'proposed',
        summary: 'something real',
        acceptanceCriteria: ['`npm test` passes'],
        outOfScope: ['mobile'],
        humanApproval: false,
        createdAt: '2026-10-03T00:00:00Z',
      }),
    );
    const nextId = spawnSync('node', [resolve(root, '.ai/scripts/loop-tasks.mjs'), 'next-id'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, AI_LOOP_ROOT: scratch },
    });
    expect(nextId.stdout.trim()).toBe('AI-004');

    const append = spawnSync(
      'node',
      [resolve(root, '.ai/scripts/loop-tasks.mjs'), 'append', '--file', brief],
      { cwd: root, encoding: 'utf8', env: { ...process.env, AI_LOOP_ROOT: scratch } },
    );
    expect(append.status, append.stderr).toBe(0);
    expect(readQueue().tasks.map((task) => task.id)).toEqual([
      'AI-001',
      'AI-002',
      'AI-003',
      'AI-004',
    ]);
  });

  it('(3) running recovery again creates no AI-005 and duplicates nothing', () => {
    seed();
    expect(run([mergedPr()]).managed).toBe(true);
    const afterFirst = readQueue().tasks.map((task) => task.id);

    // A second recovery over the reconciled state must not invent a task.
    run([mergedPr()]);
    expect(readQueue().tasks.map((task) => task.id)).toEqual(afterFirst);
    expect(readQueue().tasks.some((task) => task.id === 'AI-005')).toBe(false);
    expect(readQueue().tasks.filter((task) => task.id === 'AI-003')).toHaveLength(1);

    // And once AI-004 exists, a further recovery is a no-op: the queue already
    // holds the next task, so nothing is dispatched again.
    const brief = join(scratch, 'brief.json');
    writeFileSync(
      brief,
      JSON.stringify({
        id: 'AI-004',
        title: 'a generated task',
        phase: 'phase-9',
        status: 'proposed',
        summary: 'something real',
        acceptanceCriteria: ['`npm test` passes'],
        outOfScope: ['mobile'],
        humanApproval: false,
        createdAt: '2026-10-03T00:00:00Z',
      }),
    );
    spawnSync('node', [resolve(root, '.ai/scripts/loop-tasks.mjs'), 'append', '--file', brief], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, AI_LOOP_ROOT: scratch },
    });
    const third = run([mergedPr()]);
    expect(third.managed).toBe(false);
    expect(readQueue().tasks.map((task) => task.id)).toEqual([
      'AI-001',
      'AI-002',
      'AI-003',
      'AI-004',
    ]);
  });

  it('(4) does not mark an approved task done while its PR is still open', () => {
    seed();
    // No merged pull requests: PR #30 is still open, so there is nothing to
    // reconcile. The queue still holds a pending task, so the loop is not in a
    // recoverable between-tasks state either.
    const result = run([]);
    expect(result.managed).toBe(false);
    expect(readState().status).toBe('next-task');
    expect(readQueue().tasks.find((task) => task.id === 'AI-003')?.status).toBe('approved');
  });

  it('(5) does not advance on an unrelated merged pull request', () => {
    seed();
    const result = run([
      mergedPr({
        number: 99,
        headRefName: 'feature/readme',
        title: 'Fix the readme',
        comments: [],
      }),
    ]);
    expect(result.managed).toBe(false);
    expect(readState().status).toBe('next-task');
    expect(readQueue().tasks.find((task) => task.id === 'AI-003')?.status).toBe('approved');
  });

  it('(6) treats an [AI-INFRA] merged pull request as infrastructure, never a task', () => {
    seed();
    const result = run([
      mergedPr({
        number: 35,
        headRefName: 'fix/ai-loop-infra-reconcile',
        title: '[AI-INFRA] Reconcile an infrastructure merge instead of hard-stopping the loop',
      }),
    ]);
    expect(result.managed).toBe(false);
    expect(readState().status).toBe('next-task');
    expect(readQueue().tasks.find((task) => task.id === 'AI-003')?.status).toBe('approved');
    expect(readState().completedTasks).not.toContain('AI-003');
  });

  it('(8) keeps maxConcurrentTasks at 1 and never leaves two tasks awaiting implementation', () => {
    expect(config.automation.maxConcurrentTasks).toBe(1);
    seed();
    expect(run([mergedPr()]).managed).toBe(true);

    const awaiting = readQueue().tasks.filter((task) =>
      ['proposed', 'queued', 'approved'].includes(task.status),
    );
    expect(awaiting.length).toBeLessThanOrEqual(1);
    expect(readQueue().tasks.filter((task) => task.status === 'in-progress')).toHaveLength(0);
  });

  it('never hard-stops as state-corruption while reconciling an infrastructure merge', () => {
    // Guard the classifier boundary: the infra PR must be `infrastructure`, not
    // `unattributable`, or the recovery would stop the loop for a human.
    const classified = classifyMergedLoopPr({
      pr: mergedPr({
        number: 35,
        headRefName: 'fix/ai-loop-infra-reconcile',
        title: '[AI-INFRA] Reconcile an infrastructure merge instead of hard-stopping the loop',
      }),
      state: state(),
      queue: queue(),
    });
    expect(classified.kind).toBe('infrastructure');
  });
});
