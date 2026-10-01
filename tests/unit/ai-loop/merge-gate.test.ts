import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { evaluateMergeGate, loadConfig, REPO_ROOT } from '../../../.ai/scripts/loop-core.mjs';

/**
 * The autonomous loop's safety-critical decisions.
 *
 * `evaluateMergeGate` is the function that decides whether an AI-authored pull
 * request is merged without a human, so it is tested directly against every way
 * the decision could be wrong: a stale approval, a blocked loop, a fork, a
 * protected path, red CI, the wrong pull request. A regression here is a
 * privilege bug, not a test failure.
 *
 * `assert-trusted-review.mjs` is tested through its real entry point (a child
 * process, the way GitHub Actions invokes it) against deliberately broken copies
 * of the workflows, because it is the only thing standing between a
 * `workflow_run` job and pull-request-controlled code.
 */

const root = REPO_ROOT;
const config = loadConfig(root);

type PrOverrides = Parameters<typeof evaluateMergeGate>[0]['pr'];
type StateOverrides = Parameters<typeof evaluateMergeGate>[0]['state'];

interface GateInput {
  pr?: PrOverrides;
  state?: StateOverrides;
  verdict?: string;
  verdictHeadSha?: string;
  ci?: { status: string };
  changedPaths?: string[];
}

const HEAD = 'a'.repeat(40);

function loopState(overrides: Partial<NonNullable<StateOverrides>> = {}) {
  return {
    version: 1,
    loopId: config.loopId,
    status: 'reviewing',
    round: 1,
    maxReviewRounds: config.maxReviewRounds,
    currentTaskId: 'AI-002',
    currentPr: { number: 42, branch: `${config.branchPrefix}ai-002-fix`, headSha: HEAD },
    lastVerdict: 'approved',
    lastCiStatus: 'success',
    reviewedHeadSha: HEAD,
    blockedReason: null,
    updatedAt: '2026-09-30T00:00:00Z',
    history: [],
    ...overrides,
  };
}

function gate(overrides: GateInput = {}) {
  const pr: PrOverrides = {
    number: 42,
    state: 'OPEN',
    merged: false,
    baseRefName: config.baseBranch,
    headRefName: `${config.branchPrefix}ai-002-fix`,
    headRefOid: HEAD,
    isCrossRepository: false,
    mergeable: 'MERGEABLE',
    labels: [config.automation.triggerLabel],
    title: '[AI-002] fix something',
    ...overrides.pr,
  };
  const state = overrides.state === undefined ? loopState() : overrides.state;

  return evaluateMergeGate({
    pr,
    state,
    verdict: overrides.verdict ?? 'approved',
    verdictHeadSha: overrides.verdictHeadSha ?? HEAD,
    ci: overrides.ci ?? { status: 'success' },
    changedPaths: overrides.changedPaths ?? ['apps/api/src/app.ts'],
    config,
  });
}

describe('merge gate', () => {
  it('allows the merge when every gate passes', () => {
    const decision = gate();
    expect(decision.allowed).toBe(true);
    expect(decision.reasons).toEqual([]);
  });

  it('refuses a stale approval after the head commit changed', () => {
    const decision = gate({ verdictHeadSha: 'b'.repeat(40) });
    expect(decision.allowed).toBe(false);
    expect(decision.checks.headMatchesApproval).toBe(false);
    expect(decision.reasons.join(' ')).toContain('head commit changed');
  });

  it('refuses when the reviewer requested changes', () => {
    const decision = gate({ verdict: 'changes-requested' });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.join(' ')).toContain('changes-requested');
  });

  it('refuses when no verdict has been recorded at all', () => {
    // `verdict: null` is what the caller passes when no marker exists on the
    // pull request; it must never be read as an approval.
    const decision = evaluateMergeGate({
      pr: {
        number: 42,
        state: 'OPEN',
        merged: false,
        baseRefName: config.baseBranch,
        headRefName: `${config.branchPrefix}ai-002-fix`,
        headRefOid: HEAD,
        isCrossRepository: false,
        mergeable: 'MERGEABLE',
        labels: [config.automation.triggerLabel],
        title: '[AI-002] fix something',
      },
      state: loopState(),
      verdict: undefined,
      verdictHeadSha: undefined,
      ci: { status: 'success' },
      changedPaths: ['apps/api/src/app.ts'],
      config,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.checks.reviewApproved).toBe(false);
    expect(decision.reasons.join(' ')).toContain('no review verdict');
  });

  it('refuses when required CI is red', () => {
    const decision = gate({ ci: { status: 'failure' } });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.join(' ')).toContain('required CI is failure');
  });

  it('refuses a pull request that is not the loop\u2019s recorded active one', () => {
    const decision = gate({ pr: { number: 99 }, state: loopState() });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.join(' ')).toContain('not the loop');
  });

  it('refuses a fork pull request', () => {
    const decision = gate({ pr: { isCrossRepository: true } });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.join(' ')).toContain('fork');
  });

  it('refuses a pull request that is not AI-managed', () => {
    const decision = gate({
      pr: { headRefName: 'feature/hand-written', labels: [], title: 'A hand-written change' },
      state: null,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.join(' ')).toContain('not an AI-managed loop task');
  });

  it('refuses while the loop is blocked', () => {
    const decision = gate({
      state: loopState({ status: 'blocked', blockedReason: 'max-rounds-exceeded' }),
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.join(' ')).toContain('blocked');
  });

  it('refuses when a protected path changed', () => {
    const decision = gate({ changedPaths: ['prisma/migrations/20260101000000_x/migration.sql'] });
    expect(decision.allowed).toBe(false);
    expect(decision.protectedHits.length).toBeGreaterThan(0);
  });

  it('refuses when a credential file changed', () => {
    const decision = gate({ changedPaths: ['.env.production'] });
    expect(decision.allowed).toBe(false);
    expect(decision.credentials.length).toBeGreaterThan(0);
  });

  it('refuses a pull request with merge conflicts', () => {
    const decision = gate({ pr: { mergeable: 'CONFLICTING' } });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons.join(' ')).toContain('conflicts');
  });

  it('allows an AI-managed feat/* pull request, not just automation/*', () => {
    // TASK-4 / PR #22: the loop's own task lived on `feat/tournament-progression`.
    const decision = gate({
      pr: { headRefName: 'feat/tournament-progression' },
      state: loopState({
        currentPr: { number: 42, branch: 'feat/tournament-progression', headSha: HEAD },
      }),
    });
    expect(decision.allowed).toBe(true);
    expect(decision.checks.aiManaged).toBe(true);
  });

  it('falls back to the pull request evidence when the state file is missing', () => {
    // A lost state commit must not silently authorise an unrelated merge, but it
    // must also not deadlock a correctly labelled loop pull request.
    const allowed = gate({ state: null });
    expect(allowed.allowed).toBe(true);

    const unrelated = gate({
      state: null,
      pr: { labels: [], title: 'Fix the readme', headRefName: 'feature/readme' },
    });
    expect(unrelated.allowed).toBe(false);
  });
});

describe('trusted-workflow security guard', () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'badminton-trusted-'));
    cpSync(resolve(root, '.github'), join(scratch, '.github'), { recursive: true });
    cpSync(resolve(root, '.ai'), join(scratch, '.ai'), { recursive: true });
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  function runGuard() {
    const result = spawnSync('node', [resolve(root, '.ai/scripts/assert-trusted-review.mjs')], {
      cwd: scratch,
      encoding: 'utf8',
      env: { ...process.env, AI_LOOP_ROOT: scratch },
    });
    return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
  }

  it('accepts the committed trusted workflows', () => {
    const { status, stdout } = runGuard();
    expect(status).toBe(0);
    expect(stdout).toContain('security check passed');
  });

  it('rejects a review workflow that checks out the pull request head', () => {
    const path = join(scratch, '.github/workflows/ai-loop-review.yml');
    const contents = readFileSync(path, 'utf8').replace(
      /ref: \$\{\{ github\.event\.repository\.default_branch \|\| 'main' \}\}/,
      'ref: ${{ github.event.workflow_run.head_sha }}',
    );
    writeFileSync(path, contents);

    const { status, stderr } = runGuard();
    expect(status).toBe(1);
    expect(stderr).toContain('workflow_run head');
  });

  it('rejects a trusted workflow that installs or runs pull-request code', () => {
    const path = join(scratch, '.github/workflows/ai-loop-review.yml');
    writeFileSync(path, `${readFileSync(path, 'utf8')}\n      - run: npm ci\n`);

    const { status, stderr } = runGuard();
    expect(status).toBe(1);
    expect(stderr).toContain('npm');
  });

  it('rejects a trusted workflow that drops persist-credentials: false', () => {
    const path = join(scratch, '.github/workflows/ai-loop-merge-gate.yml');
    const contents = readFileSync(path, 'utf8').replace(
      '          persist-credentials: false\n',
      '',
    );
    writeFileSync(path, contents);

    const { status, stderr } = runGuard();
    expect(status).toBe(1);
    expect(stderr).toContain('persist-credentials');
  });

  it('rejects contents: write in a workflow that must stay read-only', () => {
    const path = join(scratch, '.github/workflows/ai-loop-next-task.yml');
    const contents = readFileSync(path, 'utf8').replace('  contents: read', '  contents: write');
    writeFileSync(path, contents);

    const { status, stderr } = runGuard();
    expect(status).toBe(1);
    expect(stderr).toContain('contents: write');
  });

  it('rejects a pull_request_target trigger', () => {
    const path = join(scratch, '.github/workflows/ai-loop-implement.yml');
    writeFileSync(path, `${readFileSync(path, 'utf8')}\non:\n  pull_request_target:\n`);

    const { status, stderr } = runGuard();
    expect(status).toBe(1);
    expect(stderr).toContain('pull_request_target');
  });
});
