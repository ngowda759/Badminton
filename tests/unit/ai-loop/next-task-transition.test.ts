import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isAiManagedPullRequest, loadConfig, REPO_ROOT } from '../../../.ai/scripts/loop-core.mjs';

/**
 * The merge -> next-task transition.
 *
 * This is the stage that failed for TASK-4 / PR #22: the workflow gated on the
 * branch name (`automation/*`) and the script asked `gh pr view` for a `merged`
 * field that does not exist, so a successfully merged AI-managed task on
 * `feat/*` never generated its successor. These tests pin the behaviour that
 * repairs it:
 *
 *   a. an AI-managed `feat/*` PR merge triggers the next task;
 *   b. an AI-managed `automation/*` PR merge still triggers it;
 *   c. an unrelated PR merge does not;
 *   d. a closed-without-merge PR does not advance;
 *   e. exactly one active task stays enforced across `feat/*` PRs;
 *   f. a duplicate merge event cannot generate a second next task.
 *
 * `isAiManagedPullRequest` is pure and tested directly; `advance-after-merge.mjs`
 * is exercised through its real entry point (a child process) with a stubbed
 * `gh`, exactly as GitHub Actions invokes it.
 */

const root = REPO_ROOT;
const config = loadConfig(root);

type PrOverrides = Parameters<typeof isAiManagedPullRequest>[0]['pr'];

function pr(overrides: Partial<NonNullable<PrOverrides>> = {}) {
  return {
    number: 42,
    state: 'MERGED',
    mergedAt: '2026-09-30T13:54:09Z',
    mergeCommit: { oid: 'b'.repeat(40) },
    baseRefName: config.baseBranch,
    headRefName: 'feat/tournament-progression',
    headRefOid: 'a'.repeat(40),
    isCrossRepository: false,
    labels: [],
    comments: [],
    title: 'feat(tournament): complete group to knockout progression',
    ...overrides,
  };
}

function state(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    loopId: config.loopId,
    status: 'ready-to-merge',
    round: 1,
    maxReviewRounds: config.maxReviewRounds,
    currentTaskId: 'AI-002',
    currentPr: { number: 42, branch: 'feat/tournament-progression', headSha: 'a'.repeat(40) },
    lastVerdict: 'approved',
    lastCiStatus: 'success',
    reviewedHeadSha: 'a'.repeat(40),
    blockedReason: null,
    completedTasks: ['AI-001'],
    updatedAt: '2026-09-30T00:00:00Z',
    history: [],
    ...overrides,
  };
}

function queue(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    updatedAt: '2026-09-30T00:00:00Z',
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
      {
        id: 'AI-002',
        title: 'Group to knockout progression',
        phase: 'phase-6',
        status: 'in-review',
        summary: 'TASK-4',
        acceptanceCriteria: ['derived qualification'],
        outOfScope: [],
        humanApproval: false,
        dependsOn: ['AI-001'],
        createdAt: '2026-09-30T00:00:00Z',
        pr: 42,
        branch: 'feat/tournament-progression',
      },
    ],
    ...overrides,
  };
}

describe('AI-managed pull request identity', () => {
  it('accepts the loop branch prefix', () => {
    expect(
      isAiManagedPullRequest({
        pr: pr({ headRefName: 'automation/ai-002-fix' }),
        state: null,
        queue: null,
        config,
      }),
    ).toBe(true);
  });

  it('accepts an AI task on feat/* via the recorded active pull request', () => {
    expect(
      isAiManagedPullRequest({
        pr: pr({ headRefName: 'feat/tournament-progression' }),
        state: state(),
        queue: queue(),
        config,
      }),
    ).toBe(true);
  });

  it('accepts an AI task on fix/* via the trigger label', () => {
    expect(
      isAiManagedPullRequest({
        pr: pr({ headRefName: 'fix/round-robin-bye', labels: [config.automation.triggerLabel] }),
        state: null,
        queue: null,
        config,
      }),
    ).toBe(true);
  });

  it('accepts a PR whose head a trusted review marker covers', () => {
    const head = 'b'.repeat(40);
    expect(
      isAiManagedPullRequest({
        pr: pr({
          headRefName: 'feat/anything',
          headRefOid: head,
          comments: [
            { body: `Reviewed.\n<!-- ai-loop-review round=1 head=${head} verdict=approved -->` },
          ],
        }),
        state: null,
        queue: null,
        config,
      }),
    ).toBe(true);
  });

  it('accepts a PR that names a task id present in the queue', () => {
    expect(
      isAiManagedPullRequest({
        pr: pr({ headRefName: 'feat/anything', title: '[AI-002] group to knockout' }),
        state: null,
        queue: queue(),
        config,
      }),
    ).toBe(true);
  });

  it('accepts a PR a queue task records as its implementation, even after state moves on', () => {
    // The loop state has already advanced to a later task, but the queue still
    // records PR #42 as AI-002's implementation. The merge of #42 must still
    // advance the loop.
    expect(
      isAiManagedPullRequest({
        pr: pr({ number: 42, headRefName: 'feat/tournament-progression' }),
        state: state({ currentTaskId: 'AI-003', currentPr: { number: 77, branch: 'feat/next' } }),
        queue: queue(),
        config,
      }),
    ).toBe(true);
  });

  it('accepts a PR whose branch a queue task records as its implementation', () => {
    expect(
      isAiManagedPullRequest({
        pr: pr({ number: 4242, headRefName: 'feat/tournament-progression' }),
        state: null,
        queue: queue(),
        config,
      }),
    ).toBe(true);
  });

  it('refuses an unrelated pull request', () => {
    expect(
      isAiManagedPullRequest({
        pr: pr({ number: 99, headRefName: 'feature/readme', title: 'Fix the readme' }),
        state: state(),
        queue: queue(),
        config,
      }),
    ).toBe(false);
  });

  it('refuses a fork even when the branch looks like a loop branch', () => {
    expect(
      isAiManagedPullRequest({
        pr: pr({ headRefName: 'automation/ai-002', isCrossRepository: true }),
        state: null,
        queue: null,
        config,
      }),
    ).toBe(false);
  });

  it('refuses a pull request that targets another base branch', () => {
    expect(
      isAiManagedPullRequest({
        pr: pr({ headRefName: 'automation/ai-002', baseRefName: 'release' }),
        state: null,
        queue: null,
        config,
      }),
    ).toBe(false);
  });
});

describe('merge -> next-task transition (advance-after-merge.mjs)', () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'badminton-next-task-'));
    cpSync(resolve(root, '.ai'), join(scratch, '.ai'), { recursive: true });
    mkdirSync(join(scratch, 'bin'), { recursive: true });

    // Stub `gh`: the script only ever calls `gh pr view <n>` and `gh pr list`.
    const gh = join(scratch, 'bin', 'gh');
    writeFileSync(
      gh,
      [
        '#!/usr/bin/env bash',
        'set -u',
        'case "$1 $2" in',
        '  "pr view") cat "$GH_PR_FIXTURE" ;;',
        '  "pr list") printf \'%s\' "${GH_PR_LIST:-[]}" ;;',
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

  function seed(prFixture: Record<string, unknown>, loopState = state(), taskQueue = queue()) {
    writeFileSync(join(scratch, 'pr.json'), JSON.stringify(prFixture));
    writeFileSync(join(scratch, '.ai/state/loop-state.json'), JSON.stringify(loopState, null, 2));
    writeFileSync(join(scratch, '.ai/state/task-queue.json'), JSON.stringify(taskQueue, null, 2));
  }

  function run(prNumber: number, env: Record<string, string> = {}) {
    const outputFile = join(scratch, 'github-output.txt');
    writeFileSync(outputFile, '');
    const result = spawnSync('node', [resolve(root, '.ai/scripts/advance-after-merge.mjs')], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${join(scratch, 'bin')}:${process.env.PATH ?? ''}`,
        AI_LOOP_ROOT: scratch,
        GH_PR_FIXTURE: join(scratch, 'pr.json'),
        GITHUB_OUTPUT: outputFile,
        MERGED_PR: String(prNumber),
        MERGED_SHA: 'b'.repeat(40),
        MERGED_BRANCH: 'feat/tournament-progression',
        ...env,
      },
    });
    const output = readFileSync(outputFile, 'utf8');
    const managed = /^managed=(true|false)$/m.exec(output)?.[1] === 'true';
    const loopState = JSON.parse(
      readFileSync(join(scratch, '.ai/state/loop-state.json'), 'utf8'),
    ) as { status: string; completedTasks?: string[]; blockedReason?: string | null };
    const taskQueue = JSON.parse(
      readFileSync(join(scratch, '.ai/state/task-queue.json'), 'utf8'),
    ) as {
      tasks: { id: string; status: string; pr?: number | null }[];
    };
    return {
      status: result.status ?? -1,
      stdout: result.stdout,
      stderr: result.stderr,
      managed,
      loopState,
      taskQueue,
    };
  }

  it('(a) advances an AI-managed feat/* pull request that merged', () => {
    seed(
      pr({
        headRefName: 'feat/tournament-progression',
        comments: [
          { body: `<!-- ai-loop-review round=1 head=${'a'.repeat(40)} verdict=approved -->` },
        ],
      }),
    );

    const result = run(42);
    expect(result.status).toBe(0);
    expect(result.managed).toBe(true);
    expect(result.loopState.status).toBe('next-task');
    expect(result.loopState.completedTasks).toContain('AI-002');
    expect(result.taskQueue.tasks.find((task) => task.id === 'AI-002')?.status).toBe('done');
  });

  it('(b) still advances an AI-managed automation/* pull request that merged', () => {
    seed(
      pr({ headRefName: 'automation/ai-002-fix', number: 42 }),
      state({
        currentPr: { number: 42, branch: 'automation/ai-002-fix', headSha: 'a'.repeat(40) },
      }),
      queue({
        tasks: [queue().tasks[0], { ...queue().tasks[1], branch: 'automation/ai-002-fix' }],
      }),
    );

    const result = run(42);
    expect(result.status).toBe(0);
    expect(result.managed).toBe(true);
    expect(result.loopState.status).toBe('next-task');
  });

  it('(c) does not advance on an unrelated pull request that merged', () => {
    seed(pr({ number: 99, headRefName: 'feature/readme', title: 'Fix the readme', comments: [] }));

    const result = run(99);
    expect(result.status).toBe(0);
    expect(result.managed).toBe(false);
    expect(result.loopState.status).toBe('ready-to-merge');
    expect(result.taskQueue.tasks.find((task) => task.id === 'AI-002')?.status).toBe('in-review');
  });

  it('(d) does not advance a closed-without-merge pull request', () => {
    seed(
      pr({
        state: 'CLOSED',
        mergedAt: null,
        mergeCommit: null,
        comments: [
          { body: `<!-- ai-loop-review round=1 head=${'a'.repeat(40)} verdict=approved -->` },
        ],
      }),
    );

    const result = run(42);
    expect(result.status).toBe(1);
    expect(result.managed).toBe(false);
    expect(result.loopState.status).toBe('blocked');
    expect(result.loopState.blockedReason).toBe('merge-conflict');
  });

  it('(f) a duplicate merge event cannot generate a second next task', () => {
    seed(
      pr({
        headRefName: 'feat/tournament-progression',
        comments: [
          { body: `<!-- ai-loop-review round=1 head=${'a'.repeat(40)} verdict=approved -->` },
        ],
      }),
    );

    const first = run(42);
    expect(first.managed).toBe(true);
    expect(first.loopState.status).toBe('next-task');

    // The same `pull_request: closed` event delivered twice (or an operator
    // re-run) must be a no-op: the task is already `done`.
    const second = run(42);
    expect(second.status).toBe(0);
    expect(second.managed).toBe(false);
    expect(second.loopState.completedTasks).toEqual(first.loopState.completedTasks);
    expect(second.loopState.status).toBe('next-task');
  });

  it('(g) attributes a merged AI-managed pull request to its queue task when the state lost the active record', () => {
    // The real stall: the loop state on `main` is still `next-task` with no
    // active task (the implementation/review transitions were never committed),
    // but the queue records PR #42 as AI-002's implementation. The merge must
    // still advance the loop rather than hard-stop as state corruption.
    seed(
      pr({
        number: 42,
        headRefName: 'feat/tournament-progression',
        comments: [
          { body: `<!-- ai-loop-review round=1 head=${'a'.repeat(40)} verdict=approved -->` },
        ],
      }),
      state({ status: 'next-task', currentTaskId: null, currentPr: null, lastVerdict: null }),
      queue(),
    );

    const result = run(42);
    expect(result.status).toBe(0);
    expect(result.managed).toBe(true);
    expect(result.loopState.status).toBe('next-task');
    expect(result.loopState.completedTasks).toContain('AI-002');
    expect(result.taskQueue.tasks.find((task) => task.id === 'AI-002')?.status).toBe('done');
  });

  it('(g2) attributes a merged task PR by the task id in its title when the queue never recorded it', () => {
    // The implementation opened the PR but did not record `pr`/`branch` on the
    // queue task (the real AI-002 stall). The title still names the task, so the
    // merge advances instead of hard-stopping.
    seed(
      pr({
        number: 42,
        headRefName: 'feat/match-result-correction',
        title: '[AI-002] Match result correction with downstream propagation',
        comments: [
          { body: `<!-- ai-loop-review round=1 head=${'a'.repeat(40)} verdict=approved -->` },
        ],
      }),
      state({ status: 'next-task', currentTaskId: null, currentPr: null, lastVerdict: null }),
      queue({ tasks: [queue().tasks[0], { ...queue().tasks[1], pr: null, branch: null }] }),
    );

    const result = run(42);
    expect(result.status).toBe(0);
    expect(result.managed).toBe(true);
    expect(result.loopState.status).toBe('next-task');
    expect(result.loopState.completedTasks).toContain('AI-002');
    expect(result.taskQueue.tasks.find((task) => task.id === 'AI-002')?.status).toBe('done');
  });

  it('(h) hard-stops when neither the state nor the queue records the merged task', () => {
    // A genuinely unattributable AI-managed merge must still stop for a human —
    // the fallbacks must not invent a task.
    seed(
      pr({
        number: 99,
        headRefName: 'feat/orphan',
        title: 'orphan work',
        comments: [
          { body: `<!-- ai-loop-review round=1 head=${'a'.repeat(40)} verdict=approved -->` },
        ],
      }),
      state({ status: 'next-task', currentTaskId: null, currentPr: null, lastVerdict: null }),
      queue(),
    );

    const result = run(99);
    expect(result.status).toBe(1);
    expect(result.managed).toBe(false);
    expect(result.loopState.status).toBe('blocked');
    expect(result.loopState.blockedReason).toBe('state-corruption');
  });

  it('(e) enforces exactly one active task across feat/* pull requests', () => {
    seed(pr(), state({ status: 'implementing' }));
    const one = spawnSync('node', [resolve(root, '.ai/scripts/loop-tasks.mjs'), 'enforce-single'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${join(scratch, 'bin')}:${process.env.PATH ?? ''}`,
        AI_LOOP_ROOT: scratch,
        GITHUB_REPOSITORY: 'ngowda759/Badminton',
        GH_PR_LIST: JSON.stringify([
          {
            number: 42,
            headRefName: 'feat/tournament-progression',
            baseRefName: 'main',
            isCrossRepository: false,
            title: '[AI-002] progression',
            labels: [],
          },
        ]),
      },
    });
    expect(one.status).toBe(0);

    // Two open AI-managed PRs on feat/* violate maxConcurrentTasks = 1, even
    // though neither branch uses the `automation/` prefix.
    const two = spawnSync('node', [resolve(root, '.ai/scripts/loop-tasks.mjs'), 'enforce-single'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${join(scratch, 'bin')}:${process.env.PATH ?? ''}`,
        AI_LOOP_ROOT: scratch,
        GITHUB_REPOSITORY: 'ngowda759/Badminton',
        GH_PR_LIST: JSON.stringify([
          {
            number: 42,
            headRefName: 'feat/tournament-progression',
            baseRefName: 'main',
            isCrossRepository: false,
            title: '[AI-002] progression',
            labels: [],
          },
          {
            number: 43,
            headRefName: 'fix/round-robin-bye',
            baseRefName: 'main',
            isCrossRepository: false,
            title: '[AI-002] fix',
            labels: [],
          },
        ]),
      },
    });
    expect(two.status).toBe(1);
    expect(two.stderr).toContain('maxConcurrentTasks');
  });
});
