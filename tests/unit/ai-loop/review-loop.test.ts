import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildComment,
  buildFixContext,
  buildReviewRequestBody,
  classifyCi,
  ciFindings,
  coerceVerdict,
  decisionFor,
  extractOutputText,
  normalizeModelReport,
  parseModelJson,
  planReview,
  reviewMarker,
  reviewedHeads,
  validateReport,
} from '../../../.ai/scripts/review-core.mjs';

/**
 * The ChatGPT review stage of the AI development loop.
 *
 * ChatGPT is the reviewer and OpenHands is the fixer, so the loop's decision
 * rules are the contract that keeps those two apart. They are pure functions, so
 * they are tested directly. The two network boundaries — `gh` and the OpenAI
 * Responses API — are exercised through the CLI with canned inputs; neither
 * OpenAI nor OpenHands is ever called.
 */

const root = resolve(import.meta.dirname, '..', '..', '..');
const REQUIRED_CHECKS = ['Lint, typecheck, test, build'];

const PASS_CHECK = { name: 'Lint, typecheck, test, build', state: 'SUCCESS', bucket: 'pass' };
const FAIL_CHECK = { name: 'Lint, typecheck, test, build', state: 'FAILURE', bucket: 'fail' };
const PENDING_CHECK = {
  name: 'Lint, typecheck, test, build',
  state: 'IN_PROGRESS',
  bucket: 'pending',
};

/** A well-formed model report, so each test can vary exactly one field. */
function modelReport(overrides = {}) {
  return {
    verdict: 'approved',
    summary: 'The change does what the brief asks and CI is green.',
    findings: [],
    ...overrides,
  };
}

function facts(overrides = {}) {
  return {
    taskId: 'AI-002-T1',
    pr: 25,
    round: 1,
    headSha: 'abcdef1234567890abcdef1234567890abcdef12',
    ciStatus: 'success',
    reviewedAt: '2026-09-30T10:00:00Z',
    ...overrides,
  };
}

describe('review rounds and head de-duplication', () => {
  const head = 'abc1234def5678abc1234def5678abc1234def56';

  it('reviews a fresh head as round 1', () => {
    const plan = planReview({ comments: [], headSha: head, maxReviewRounds: 3 });
    expect(plan).toMatchObject({ action: 'review', round: 1 });
  });

  it('never reviews the same head SHA twice', () => {
    const comments = [{ body: reviewMarker(1, head, 'changes-requested') }];
    const plan = planReview({ comments, headSha: head, maxReviewRounds: 3 });
    expect(plan.action).toBe('skip');
    expect(plan.round).toBe(1);
    expect(plan.reason).toContain('already reviewed');
  });

  it('increments the round for a new head SHA after a fix push', () => {
    const comments = [{ body: reviewMarker(1, head, 'changes-requested') }];
    const plan = planReview({
      comments,
      headSha: 'fff9999aaa8888fff9999aaa8888fff9999aaa88',
      maxReviewRounds: 3,
    });
    expect(plan).toMatchObject({ action: 'review', round: 2 });
  });

  it('takes the highest round when a head carries several markers', () => {
    const comments = [
      { body: `Reviewed.\n${reviewMarker(1, 'aaa1111', 'changes-requested')}` },
      { body: `Re-reviewed.\n${reviewMarker(2, 'aaa1111', 'approved')}` },
    ];
    const heads = reviewedHeads(comments);
    expect(heads.get('aaa1111')).toMatchObject({ round: 2, verdict: 'approved' });
  });

  it('ignores markers that are not loop markers', () => {
    const comments = [{ body: '<!-- unrelated note round=9 head=deadbee -->' }];
    expect(reviewedHeads(comments).size).toBe(0);
  });

  it('skips a fourth round because maxReviewRounds is 3', () => {
    const comments = [
      { body: reviewMarker(1, 'aaa1111', 'changes-requested') },
      { body: reviewMarker(2, 'bbb2222', 'changes-requested') },
      { body: reviewMarker(3, 'ccc3333', 'changes-requested') },
    ];
    const plan = planReview({ comments, headSha: 'ddd4444', maxReviewRounds: 3 });
    expect(plan.action).toBe('skip');
    expect(plan.round).toBe(4);
    expect(plan.reason).toContain('maxReviewRounds');
  });
});

describe('CI classification and CI findings', () => {
  it('reports success only when every required check passed', () => {
    expect(classifyCi([PASS_CHECK], REQUIRED_CHECKS).status).toBe('success');
  });

  it('ignores non-required checks such as the loop reporting jobs', () => {
    const ci = classifyCi(
      [PASS_CHECK, { name: 'Report merge readiness (no merge)', state: 'FAILURE', bucket: 'fail' }],
      REQUIRED_CHECKS,
    );
    expect(ci.status).toBe('success');
  });

  it('reports failure for a failed required check', () => {
    const ci = classifyCi([FAIL_CHECK], REQUIRED_CHECKS);
    expect(ci.status).toBe('failure');
    expect(ci.failing).toHaveLength(1);
  });

  it('reports pending while a required check is still running', () => {
    expect(classifyCi([PENDING_CHECK], REQUIRED_CHECKS).status).toBe('pending');
  });

  it('reports unknown when a required check never reported', () => {
    const ci = classifyCi([], REQUIRED_CHECKS);
    expect(ci.status).toBe('unknown');
    expect(ci.missing).toHaveLength(1);
  });

  it('turns a failed required check into a blocker finding naming the run', () => {
    const ci = classifyCi([{ ...FAIL_CHECK, link: 'https://example.test/run/1' }], REQUIRED_CHECKS);
    const findings = ciFindings(ci);
    expect(findings).toHaveLength(1);
    const finding = findings[0];
    expect(finding).toMatchObject({ severity: 'blocker' });
    expect(finding?.summary).toContain('did not pass');
    expect(finding?.suggestion).toContain('https://example.test/run/1');
    expect(finding?.suggestion).toContain('re-run');
  });

  it('turns a missing required check into a blocker finding', () => {
    const finding = ciFindings(classifyCi([], REQUIRED_CHECKS))[0];
    expect(finding?.summary).toContain('has not reported');
  });
});

describe('verdict coercion', () => {
  const failing = classifyCi([FAIL_CHECK], REQUIRED_CHECKS);
  const passing = classifyCi([PASS_CHECK], REQUIRED_CHECKS);
  const unknown = classifyCi([], REQUIRED_CHECKS);

  it('turns a failing build into changes-requested', () => {
    const coerced = coerceVerdict({
      requested: 'approved',
      ci: failing,
      round: 1,
      maxReviewRounds: 3,
    });
    expect(coerced).toMatchObject({ verdict: 'changes-requested', forced: true });
  });

  it('does not approve when a required check never reported', () => {
    const coerced = coerceVerdict({
      requested: 'approved',
      ci: unknown,
      round: 1,
      maxReviewRounds: 3,
    });
    expect(coerced.verdict).toBe('changes-requested');
  });

  it('blocks changes-requested at the round limit instead of looping', () => {
    const coerced = coerceVerdict({
      requested: 'changes-requested',
      ci: passing,
      round: 3,
      maxReviewRounds: 3,
    });
    expect(coerced).toMatchObject({ verdict: 'blocked', forced: true });
  });

  it('allows changes-requested below the round limit', () => {
    const coerced = coerceVerdict({
      requested: 'changes-requested',
      ci: passing,
      round: 2,
      maxReviewRounds: 3,
    });
    expect(coerced).toMatchObject({ verdict: 'changes-requested', forced: false });
  });

  it('leaves a green approval alone', () => {
    const coerced = coerceVerdict({
      requested: 'approved',
      ci: passing,
      round: 1,
      maxReviewRounds: 3,
    });
    expect(coerced).toMatchObject({ verdict: 'approved', forced: false });
  });
});

describe('model report normalization and validation', () => {
  it('records the loop facts rather than trusting the model', () => {
    const report = normalizeModelReport(
      { verdict: 'approved', headSha: 'deadbeefdeadbeef', pr: 999, round: 7 },
      facts(),
    );
    expect(report).toMatchObject({
      taskId: 'AI-002-T1',
      pr: 25,
      round: 1,
      headSha: facts().headSha,
      ciStatus: 'success',
    });
  });

  it('normalizes missing finding fields and drops a bogus line number', () => {
    const report = normalizeModelReport(
      modelReport({
        findings: [{ severity: 'catastrophic', file: '', summary: 'x', line: 0 }],
      }),
      facts(),
    );
    expect(report.findings[0]).toMatchObject({ id: 'REV-1', severity: 'major', file: 'unknown' });
    expect(report.findings[0]?.line).toBeUndefined();
  });

  it('rejects a changes-requested report with no findings', () => {
    const report = normalizeModelReport(modelReport({ verdict: 'changes-requested' }), facts());
    const errors = validateReport(report, facts());
    expect(errors.join('\n')).toContain('must carry at least one finding');
  });

  it('rejects a verdict outside the schema enum', () => {
    const report = normalizeModelReport(modelReport({ verdict: 'looks-fine' }), facts());
    expect(validateReport(report, facts()).join('\n')).toContain('is not one of');
  });

  it('rejects a report whose head SHA does not match the reviewed head', () => {
    const report = normalizeModelReport(modelReport(), facts({ headSha: 'other-sha' }));
    expect(validateReport(report, facts()).join('\n')).toContain(
      'does not match the reviewed head',
    );
  });

  it('accepts a well-formed changes-requested report', () => {
    const report = normalizeModelReport(
      modelReport({
        verdict: 'changes-requested',
        findings: [
          {
            id: 'REV-001',
            severity: 'major',
            file: 'apps/api/src/http/routes/x.ts',
            line: 12,
            summary: 'Business logic lives in the route handler.',
            suggestion: 'Move the rule into the application service and unit-test it there.',
          },
        ],
      }),
      facts(),
    );
    expect(validateReport(report, facts())).toEqual([]);
  });
});

describe('loop decision', () => {
  it('dispatches a fix on changes-requested', () => {
    const decision = decisionFor({
      verdict: 'changes-requested',
      ciStatus: 'success',
      round: 1,
      maxReviewRounds: 3,
    });
    expect(decision).toMatchObject({ action: 'fix', status: 'fixing' });
    expect(decision.addLabels).toEqual([]);
  });

  it('blocks at the round limit without dispatching a fix', () => {
    const decision = decisionFor({
      verdict: 'changes-requested',
      ciStatus: 'success',
      round: 3,
      maxReviewRounds: 3,
    });
    expect(decision.action).toBe('blocked');
    expect(decision.addLabels).toEqual(['ai-blocked']);
    expect(decision.message).toContain('Human intervention required');
  });

  it('marks ready on a green approval and never merges', () => {
    const decision = decisionFor({
      verdict: 'approved',
      ciStatus: 'success',
      round: 2,
      maxReviewRounds: 3,
    });
    expect(decision).toMatchObject({ action: 'ready', status: 'ready' });
    expect(decision.addLabels).toEqual(['ai-ready']);
    expect(decision.message).toContain('never merges');
  });

  it('does not mark ready while CI is not green', () => {
    const decision = decisionFor({
      verdict: 'approved',
      ciStatus: 'pending',
      round: 1,
      maxReviewRounds: 3,
    });
    expect(decision.action).toBe('none');
    expect(decision.addLabels).toEqual([]);
  });

  it('blocks without dispatching a fix on a blocked verdict', () => {
    const decision = decisionFor({
      verdict: 'blocked',
      ciStatus: 'success',
      round: 1,
      maxReviewRounds: 3,
    });
    expect(decision.action).toBe('blocked');
  });
});

describe('OpenAI request and response handling', () => {
  const schema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'https://example.test/schema.json',
    type: 'object',
    required: ['verdict'],
    properties: { verdict: { type: 'string' } },
  };

  it('requests a strict structured response and strips schema meta keys', () => {
    const body = buildReviewRequestBody({
      model: 'gpt-5.6-sol',
      instructions: 'review it',
      input: 'the diff',
      schema,
    });
    expect(body.model).toBe('gpt-5.6-sol');
    expect(body.text.format).toMatchObject({ type: 'json_schema', strict: true });
    expect(body.text.format.schema).not.toHaveProperty('$schema');
    expect(body.text.format.schema).not.toHaveProperty('$id');
    expect(body.text.format.schema.required).toEqual(['verdict']);
  });

  it('extracts the assistant text from a Responses API payload', () => {
    const payload = {
      output: [
        { type: 'message', content: [{ type: 'output_text', text: '{"verdict":"approved"}' }] },
      ],
    };
    expect(extractOutputText(payload)).toBe('{"verdict":"approved"}');
  });

  it('extracts text from a convenience output_text field', () => {
    expect(extractOutputText({ output_text: '{"verdict":"blocked"}' })).toBe(
      '{"verdict":"blocked"}',
    );
  });

  it('surfaces a refusal instead of parsing it as a review', () => {
    const payload = {
      output: [
        { type: 'message', content: [{ type: 'refusal', refusal: 'I cannot help with that.' }] },
      ],
    };
    expect(() => extractOutputText(payload)).toThrow(/refused/);
  });

  it('fails when the payload carries no text at all', () => {
    expect(() => extractOutputText({ output: [] })).toThrow(/no text content/);
  });

  it('rejects invalid JSON from the reviewer', () => {
    expect(() => parseModelJson('{ not json')).toThrow(/invalid JSON/);
  });

  it('rejects a JSON payload that is not an object', () => {
    expect(() => parseModelJson('["approved"]')).toThrow(/not an object/);
    expect(() => parseModelJson('')).toThrow(/empty body/);
  });
});

describe('review comment and fix handoff', () => {
  const report = normalizeModelReport(
    modelReport({
      verdict: 'changes-requested',
      findings: [
        {
          id: 'REV-001',
          severity: 'blocker',
          file: 'apps/api/src/x.ts',
          line: 9,
          summary: 'Secret is returned.',
          suggestion: 'Return the DTO instead.',
        },
        {
          id: 'REV-002',
          severity: 'nit',
          file: 'apps/web/src/y.tsx',
          summary: 'Naming.',
          suggestion: 'Rename.',
        },
      ],
    }),
    facts(),
  );

  it('leads the comment with the dedupe marker', () => {
    const comment = buildComment(
      report,
      decisionFor({
        verdict: 'changes-requested',
        ciStatus: 'success',
        round: 1,
        maxReviewRounds: 3,
      }),
    );
    expect(comment.split('\n')[0]).toBe(reviewMarker(1, report.headSha, 'changes-requested'));
    expect(comment).toContain('apps/api/src/x.ts:9');
    expect(comment).toContain('Return the DTO instead.');
    expect(comment).toContain('AI agent');
  });

  it('round-trips: the posted comment makes the next run skip that head', () => {
    const comment = buildComment(
      report,
      decisionFor({
        verdict: 'changes-requested',
        ciStatus: 'success',
        round: 1,
        maxReviewRounds: 3,
      }),
    );
    const plan = planReview({
      comments: [{ body: comment }],
      headSha: report.headSha,
      maxReviewRounds: 3,
    });
    expect(plan.action).toBe('skip');
  });

  it('hands the fix the same PR and branch, and separates blocking from advisory', () => {
    const context = buildFixContext({
      report,
      pr: 25,
      branch: 'automation/ai-002-t1',
      headSha: report.headSha,
      maxReviewRounds: 3,
    });
    expect(context).toContain('Pull request: #25');
    expect(context).toContain('`automation/ai-002-t1`');
    expect(context).toContain('Do **NOT** create another branch');
    expect(context).toContain('Do **NOT** merge');
    expect(context).toContain('REV-001');
    expect(context).toContain('Blocking findings to fix');
    expect(context).toContain('Advisory findings');
    expect(context).toContain('FIXED');
    expect(context).toContain('DECLINED');
    expect(context).toContain('npm run test:e2e');
  });

  it('tells the fixer there is nothing blocking when only advisory findings exist', () => {
    const advisoryOnly = normalizeModelReport(
      modelReport({
        verdict: 'changes-requested',
        findings: [{ id: 'REV-1', severity: 'nit', file: 'a.ts', summary: 'x', suggestion: 'y' }],
      }),
      facts(),
    );
    const context = buildFixContext({
      report: advisoryOnly,
      pr: 25,
      branch: 'automation/x',
      headSha: advisoryOnly.headSha,
      maxReviewRounds: 3,
    });
    expect(context).toContain('None. If the only findings are advisory');
  });
});

describe('ChatGPT review CLI', () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'badminton-review-'));
    cpSync(resolve(root, '.ai'), join(scratch, '.ai'), { recursive: true });
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  // The CLI shells out to `gh`. Stub it so the tests are hermetic: no network,
  // and no dependence on an ambient GH_TOKEN that a developer happens to have
  // exported but CI does not.
  function stubGh(pr: Record<string, unknown>): string {
    const bin = join(scratch, 'bin');
    mkdirSync(bin, { recursive: true });
    const fixture = join(scratch, 'pr.json');
    writeFileSync(fixture, JSON.stringify(pr));
    const script = [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'case "$1 $2" in',
      '  "pr view") cat "$AI_LOOP_STUB_PR" ;;',
      '  "pr checks") printf \'%s\' "${AI_LOOP_STUB_CHECKS:-[]}" ;;',
      '  "pr diff") printf \'%s\' "${AI_LOOP_STUB_DIFF:-}" ;;',
      "  *) printf '%s' '' ;;",
      'esac',
      '',
    ].join('\n');
    const gh = join(bin, 'gh');
    writeFileSync(gh, script, { mode: 0o755 });
    return bin;
  }

  // A minimal but schema-valid review report, so the CLI's own validation path
  // runs without a network call.
  function canned(verdict: string): string {
    const file = join(scratch, `canned-${verdict}.json`);
    writeFileSync(
      file,
      JSON.stringify({
        verdict,
        summary: `stub ${verdict}`,
        acceptanceCriteria: [
          { criterion: 'the loop is automatic', status: 'met', evidence: 'stub' },
        ],
        findings:
          verdict === 'approved'
            ? []
            : [
                {
                  id: 'REV-1',
                  severity: 'major',
                  file: '.ai/scripts/chatgpt-review.mjs',
                  line: 1,
                  summary: 'stub finding',
                  suggestion: 'stub suggestion',
                },
              ],
      }),
    );
    return file;
  }

  function runReview(
    args: string[],
    env: Record<string, string> = {},
    pr: Record<string, unknown> = {
      number: 19,
      title: 'stub',
      body: '',
      headRefName: 'automation/ai-development-loop',
      headRefOid: 'a'.repeat(40),
      baseRefName: 'main',
      headRepositoryOwner: { login: 'ngowda759' },
      comments: [],
      labels: [],
      isCrossRepository: false,
    },
  ) {
    const bin = stubGh(pr);
    return spawnSync('node', [resolve(root, '.ai/scripts/chatgpt-review.mjs'), ...args], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        AI_LOOP_ROOT: scratch,
        AI_LOOP_STUB_PR: join(scratch, 'pr.json'),
        OPENAI_API_KEY: '',
        ...env,
      },
    });
  }

  it('fails safely when OPENAI_API_KEY is missing', () => {
    const result = runReview(['--pr', '19']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('OPENAI_API_KEY is not configured');
    expect(result.stderr).not.toMatch(/sk-[A-Za-z0-9]/);
  });

  it('rejects a non-numeric --pr without touching the network', () => {
    const result = runReview(['--pr', 'not-a-number']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--pr must be a positive integer');
  });

  it('requires --pr', () => {
    const result = runReview([]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage: chatgpt-review.mjs');
  });

  it('plans a fix on the SAME pr and branch when the verdict needs work', () => {
    const result = runReview(
      ['--pr', '19', '--response-file', canned('changes-requested'), '--dry-run'],
      { OPENAI_API_KEY: 'test-key' },
    );
    expect(result.status).toBe(0);
    const out = `${result.stdout}${result.stderr}`;
    expect(out).toContain('verdict: changes-requested');
    expect(out).toContain(
      'fix dispatch: --stage fix --pr 19 --branch automation/ai-development-loop',
    );
    // A fix updates the existing pull request; it never opens a second one.
    expect(out).not.toMatch(/--new-pr|create.*pull request/i);
  });

  it('routes an approval to the human merge gate without dispatching a fix', () => {
    const result = runReview(['--pr', '19', '--response-file', canned('approved'), '--dry-run'], {
      OPENAI_API_KEY: 'test-key',
      AI_LOOP_STUB_CHECKS: JSON.stringify([
        { name: 'Lint, typecheck, test, build', state: 'SUCCESS', bucket: 'pass', link: '' },
      ]),
    });
    expect(result.status).toBe(0);
    const out = `${result.stdout}${result.stderr}`;
    expect(out).toContain('verdict: approved');
    expect(out).toContain('fix dispatch: none');
    expect(out).toContain('ai-ready');
  });

  it('runs a round on a red build and reports changes-requested rather than blocking', () => {
    // The reviewer still runs when CI is red, so a fix round is dispatched with
    // the failure attached instead of the loop going straight to blocked.
    const result = runReview(['--pr', '19', '--response-file', canned('approved'), '--dry-run'], {
      OPENAI_API_KEY: 'test-key',
      AI_LOOP_STUB_CHECKS: JSON.stringify([
        {
          name: 'Lint, typecheck, test, build',
          state: 'FAILURE',
          bucket: 'fail',
          link: 'https://example.test/run/9',
        },
      ]),
    });
    expect(result.status).toBe(0);
    const out = `${result.stdout}${result.stderr}`;
    expect(out).toContain('verdict: changes-requested');
    expect(out).not.toContain('verdict: approved');
    expect(out).toContain('fix dispatch: --stage fix --pr 19');
  });

  it('stops for a human at the round limit instead of dispatching another fix', () => {
    // Rounds 1-3 already ran on older heads, so this head would be round 4.
    const comments = [1, 2, 3].map((round) => ({
      body: reviewMarker(round, 'a'.repeat(40), 'changes-requested'),
    }));
    const result = runReview(
      ['--pr', '19', '--response-file', canned('changes-requested'), '--dry-run'],
      { OPENAI_API_KEY: 'test-key' },
      {
        number: 19,
        headRefName: 'automation/ai-development-loop',
        headRefOid: 'b'.repeat(40),
        comments,
        isCrossRepository: false,
      },
    );
    expect(result.status).toBe(0);
    const out = `${result.stdout}${result.stderr}`;
    expect(out).toContain('exceeds maxReviewRounds 3');
    expect(out).not.toContain('fix dispatch: --stage fix');
  });

  it('skips a head SHA that a previous review already covered', () => {
    const sha = 'a'.repeat(40);
    const result = runReview(
      ['--pr', '19', '--dry-run'],
      { OPENAI_API_KEY: 'test-key' },
      {
        number: 19,
        headRefName: 'automation/ai-development-loop',
        headRefOid: sha,
        comments: [{ body: reviewMarker(1, sha, 'approved') }],
        isCrossRepository: false,
      },
    );
    expect(result.status).toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('no review needed');
  });
});

describe('CI wait script', () => {
  it('requires --pr', () => {
    const result = spawnSync('node', [resolve(root, '.ai/scripts/wait-for-ci.mjs')], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage: wait-for-ci.mjs');
  });
});

describe('loop state machine transitions', () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'badminton-transitions-'));
    cpSync(resolve(root, '.ai'), join(scratch, '.ai'), { recursive: true });
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  function set(args: string[]) {
    return spawnSync('node', [resolve(root, '.ai/scripts/loop-state.mjs'), 'set', ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, AI_LOOP_ROOT: scratch },
    });
  }

  function status(): string {
    return (
      JSON.parse(readFileSync(join(scratch, '.ai/state/loop-state.json'), 'utf8')) as {
        status: string;
      }
    ).status;
  }

  it('walks the documented path from idle to ready', () => {
    expect(set(['--status', 'implementing']).status).toBe(0);
    expect(set(['--status', 'ci-running']).status).toBe(0);
    expect(set(['--status', 'reviewing']).status).toBe(0);
    expect(set(['--status', 'fixing']).status).toBe(0);
    expect(set(['--status', 'ci-running']).status).toBe(0);
    expect(set(['--status', 'reviewing']).status).toBe(0);
    expect(set(['--status', 'ready']).status).toBe(0);
    expect(status()).toBe('ready');
  });

  it('refuses a transition the loop does not define', () => {
    const result = set(['--status', 'complete']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('refusing the transition idle -> complete');
    expect(status()).toBe('idle');
  });

  it('allows blocking from any state without --force', () => {
    expect(set(['--status', 'implementing']).status).toBe(0);
    expect(set(['--status', 'blocked']).status).toBe(0);
    expect(status()).toBe('blocked');
  });

  it('records a forced transition in the history', () => {
    expect(set(['--status', 'complete', '--force', '--note', 'recovering']).status).toBe(0);
    const state = JSON.parse(readFileSync(join(scratch, '.ai/state/loop-state.json'), 'utf8')) as {
      history: { note: string }[];
    };
    expect(state.history.at(-1)?.note).toBe('recovering');
  });

  it('allows the human-merge terminal state', () => {
    expect(set(['--status', 'implementing']).status).toBe(0);
    expect(set(['--status', 'ci-running']).status).toBe(0);
    expect(set(['--status', 'reviewing']).status).toBe(0);
    expect(set(['--status', 'ready']).status).toBe(0);
    expect(set(['--status', 'human-merge']).status).toBe(0);
    expect(status()).toBe('human-merge');
  });
});

describe('review stage is not dispatched to OpenHands', () => {
  it('has no OpenHands review stage in the dispatcher', () => {
    const result = spawnSync(
      'node',
      [resolve(root, '.ai/scripts/dispatch-conversation.mjs'), '--stage', 'review'],
      { cwd: root, encoding: 'utf8' },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('unknown stage: review');
  });

  it('never wires the review prompt into the OpenHands dispatcher', () => {
    const source = readFileSync(resolve(root, '.ai/scripts/dispatch-conversation.mjs'), 'utf8');
    expect(source).not.toContain("review: ['system.md'");
    expect(source).toContain("fix: ['system.md', 'fix.md']");
  });

  it('runs the ChatGPT reviewer from the review workflow, not OpenHands', () => {
    const workflow = readFileSync(resolve(root, '.github/workflows/ai-loop-review.yml'), 'utf8');
    expect(workflow).toContain('chatgpt-review.mjs');
    expect(workflow).toContain('wait-for-ci.mjs');
    expect(workflow).not.toContain('--stage review');
    expect(workflow).toContain('isCrossRepository');
  });
});

describe('review workflow safety', () => {
  const workflow = readFileSync(resolve(root, '.github/workflows/ai-loop-review.yml'), 'utf8');

  it('never requests contents: write', () => {
    expect(workflow).not.toMatch(/contents:\s*write/);
  });

  it('does not use pull_request_target as a trigger', () => {
    // The word may appear in the explanatory comment; the trigger must not.
    expect(workflow).not.toMatch(/^ {2}pull_request_target:/m);
  });

  it('declares least-privilege permissions', () => {
    expect(workflow).toMatch(
      /permissions:\n {2}contents: read\n {2}checks: read\n {2}pull-requests: write\n {2}issues: write/,
    );
  });

  it('skips the review cleanly when OPENAI_API_KEY is absent', () => {
    // The gate must exist so an unconfigured secret cannot turn the check red,
    // and the review step must be conditional on it.
    expect(workflow).toContain('Check the reviewer credential');
    expect(workflow).toContain("steps.creds.outputs.available == 'true'");
    expect(workflow).toContain('::warning::OPENAI_API_KEY is not configured');
  });
});
