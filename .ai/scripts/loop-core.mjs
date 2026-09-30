/**
 * Pure logic for the autonomous AI development loop.
 *
 * Everything here is deterministic and side-effect free, so the loop's
 * scheduling rules — task sequencing, single-active-task enforcement, the merge
 * gate and hard-stop classification — can be tested directly without a network,
 * a GitHub token or a live pull request.
 *
 * The CLIs (`loop-state.mjs`, `loop-tasks.mjs`, `merge-gate.mjs`) do nothing but
 * wire these functions to `gh`, the state files and the workflows.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function loadConfig(root = REPO_ROOT) {
  return JSON.parse(readFileSync(resolve(root, '.ai/loop.config.json'), 'utf8'));
}

// --- task identity and sequencing -----------------------------------------

/**
 * Task ids are `AI-<n>` with an optional `-T<m>` sub-task suffix. The loop
 * progresses strictly one number at a time: AI-001, AI-002, AI-003, …
 *
 * @returns {number | null} the numeric part, or null when the id is malformed.
 */
export function taskNumber(taskId) {
  if (typeof taskId !== 'string') return null;
  const match = /^AI-(\d+)(?:-T\d+)?$/.exec(taskId);
  if (match === null) return null;
  return Number.parseInt(match[1], 10);
}

/** Sort task ids by their numeric part, then by sub-task. */
export function sortTaskIds(ids) {
  return [...ids].sort((a, b) => {
    const na = taskNumber(a) ?? 0;
    const nb = taskNumber(b) ?? 0;
    if (na !== nb) return na - nb;
    return a.localeCompare(b);
  });
}

/**
 * The next task id after the highest id already present.
 *
 * @param {string[]} existingIds every id in the queue
 * @returns {string} e.g. `AI-003` when AI-002 is the highest
 */
export function resolveNextTaskId(existingIds) {
  const highest = (existingIds ?? []).reduce((max, id) => Math.max(max, taskNumber(id) ?? 0), 0);
  return `AI-${String(highest + 1).padStart(3, '0')}`;
}

/**
 * Sequencing invariants for the queue.
 *
 * The loop must never skip an id and must never hold more than one task beyond
 * the active one — the queue is a queue, not a speculative backlog.
 *
 * @returns {string[]} errors; empty means the sequence is sound.
 */
export function validateTaskSequence(existingIds) {
  const errors = [];
  const ids = existingIds ?? [];
  const numbers = ids.map(taskNumber);
  if (numbers.some((value) => value === null)) {
    errors.push(`task ids must match AI-<n> or AI-<n>-T<m>: ${ids.join(', ')}`);
    return errors;
  }
  const unique = new Set(numbers);
  if (unique.size !== numbers.length) errors.push('task ids are not unique');

  const sorted = [...unique].sort((a, b) => a - b);
  for (let index = 0; index < sorted.length; index += 1) {
    if (sorted[index] !== index + 1) {
      errors.push(
        `task ids must be contiguous starting at AI-001; found ${sorted.map((n) => `AI-${String(n).padStart(3, '0')}`).join(', ')}`,
      );
      break;
    }
  }
  return errors;
}

/**
 * Enforce exactly one active task across the state file, the queue and GitHub.
 *
 * `state` is authoritative but not trusted on its own: an interrupted run can
 * leave the state idle while a pull request is still open, and starting a second
 * task in that window would put two implementations in flight at once.
 *
 * @returns {{ ok: boolean, errors: string[], activePr: number | null }}
 */
export function assertSingleActiveTask({ state, queue, openPrs, config }) {
  const errors = [];
  const max = config?.automation?.maxConcurrentTasks ?? 1;

  const inFlight = (queue?.tasks ?? []).filter((task) =>
    ['in-progress', 'in-review', 'blocked'].includes(task.status),
  );
  const live = inFlight.filter((task) => task.status !== 'blocked');

  if (live.length > max) {
    errors.push(
      `${live.length} tasks are active (${live.map((task) => task.id).join(', ')}); maxConcurrentTasks is ${max}`,
    );
  }

  const automationPrs = (openPrs ?? []).filter((pr) => pr.isAutomation === true);
  if (automationPrs.length > max) {
    errors.push(
      `${automationPrs.length} automation pull requests are open (${automationPrs
        .map((pr) => `#${pr.number}`)
        .join(', ')}); maxConcurrentTasks is ${max}`,
    );
  }

  const stateStatus = state?.status ?? 'idle';
  const stateActive = !['idle', 'complete'].includes(stateStatus);
  if (stateActive && automationPrs.length === 0 && state?.currentPr === null) {
    errors.push(`loop state is "${stateStatus}" but no automation pull request is open`);
  }

  return {
    ok: errors.length === 0,
    errors,
    activePr: state?.currentPr?.number ?? automationPrs[0]?.number ?? null,
  };
}

// --- protected paths -------------------------------------------------------

const DOUBLE_STAR = '__DOUBLE_STAR__';

/**
 * Translate a repository glob into a regular expression.
 *
 * `**` crosses path separators, `*` does not — the same semantics as the
 * `.gitignore`-style patterns the config uses.
 */
export function globToRegExp(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, DOUBLE_STAR)
    .replace(/\*/g, '[^/]*')
    .split(DOUBLE_STAR)
    .join('.*');
  return new RegExp(`^${escaped}$`);
}

/**
 * Which changed paths hit a protected pattern.
 *
 * A protected path is never a CI failure — it is a hard stop that hands the
 * decision to a human, because the loop must not silently rewrite migrations,
 * CI definitions or credentials.
 *
 * @returns {string[]} the offending paths, sorted and de-duplicated
 */
export function protectedPathViolations(paths, protectedPaths) {
  const patterns = (protectedPaths ?? []).map(globToRegExp);
  const hits = (paths ?? []).filter((path) => patterns.some((pattern) => pattern.test(path)));
  return [...new Set(hits)].sort();
}

/**
 * Extra hard-stop patterns that are not plain protected paths.
 *
 * `.env` files and credential material are treated as hard stops in their own
 * right, so a task that needs to touch them always stops for a human even if the
 * config's `protectedPaths` is later relaxed.
 */
export const CREDENTIAL_PATTERNS = ['.env', '.env.*', '**/*.pem', '**/*.key', '**/credentials*'];

export function credentialViolations(paths) {
  return protectedPathViolations(paths, CREDENTIAL_PATTERNS);
}

// --- the loop state machine ------------------------------------------------

/**
 * The autonomous lifecycle. Each key lists the statuses it may move to.
 *
 * `blocked` and `human-review-required` are reachable from anywhere: a stage
 * that cannot proceed must always be allowed to stop for a human.
 */
export const TRANSITIONS = {
  idle: ['architecting', 'implementing'],
  architecting: ['implementing', 'blocked'],
  implementing: ['ci-running', 'blocked'],
  'ci-running': ['reviewing', 'fixing', 'blocked'],
  reviewing: ['fixing', 'ready-to-merge', 'blocked', 'human-review-required'],
  fixing: ['ci-running', 'reviewing', 'blocked'],
  'ready-to-merge': ['merging', 'blocked', 'human-review-required'],
  merging: ['completed', 'blocked', 'human-review-required'],
  completed: ['next-task'],
  // After a merge the loop either generates the next task (`architecting`) or
  // goes straight to implementation when the brief is already queued.
  'next-task': ['architecting', 'implementing', 'completed', 'blocked'],
  'human-review-required': ['idle', 'implementing', 'reviewing', 'ready-to-merge'],
  blocked: ['idle', 'implementing', 'reviewing', 'fixing', 'ready-to-merge'],
};

/** Statuses in which the loop owns an active task and a pull request. */
export const ACTIVE_STATUSES = [
  'architecting',
  'implementing',
  'ci-running',
  'reviewing',
  'fixing',
  'ready-to-merge',
  'merging',
];

/** Statuses that mean automation has stopped and a human is needed. */
export const STOPPED_STATUSES = ['blocked', 'human-review-required'];

export function isTransitionAllowed(from, to) {
  if (from === to) return true;
  if (STOPPED_STATUSES.includes(to)) return true;
  return (TRANSITIONS[from] ?? []).includes(to);
}

/** The task-queue status that matches a loop status. */
export function taskStatusForLoopStatus(loopStatus) {
  switch (loopStatus) {
    case 'architecting':
    case 'implementing':
      return 'in-progress';
    case 'ci-running':
    case 'reviewing':
    case 'fixing':
      return 'in-review';
    case 'ready-to-merge':
    case 'merging':
      return 'ready-to-merge';
    case 'completed':
      return 'done';
    case 'blocked':
    case 'human-review-required':
      return 'blocked';
    default:
      return 'queued';
  }
}

/** The single task that may be implemented, or null. */
export function selectActiveTask(queue) {
  const tasks = queue?.tasks ?? [];
  const inFlight = tasks.filter((task) => ['in-progress', 'in-review'].includes(task.status));
  if (inFlight.length > 0) return inFlight[0];
  const ready = tasks
    .filter((task) => task.status === 'approved')
    .sort((a, b) => (taskNumber(a.id) ?? 0) - (taskNumber(b.id) ?? 0));
  return ready[0] ?? null;
}

// --- the merge gate --------------------------------------------------------

/**
 * The merge-gate decision.
 *
 * Every check is re-derived at merge time from GitHub rather than trusted from
 * the earlier review: between the approval and the merge a push, a label change
 * or a new commit could have invalidated it, and merging on stale evidence is
 * the failure this function exists to prevent.
 *
 * The authoritative record of *what* was approved is the review marker on the
 * pull request, because the trusted review workflow writes it. The state file
 * supplies the loop's own bookkeeping (which task and pull request are active);
 * when it is present it is enforced strictly, and when it is missing the
 * pull-request evidence alone must carry the decision, so a lost state commit
 * cannot silently authorise a merge of the wrong pull request.
 *
 * @returns {{ allowed: boolean, reasons: string[], checks: Record<string, boolean>, protectedHits: string[], credentials: string[] }}
 */
export function evaluateMergeGate({
  pr,
  state,
  verdict,
  verdictHeadSha,
  ci,
  changedPaths,
  config,
}) {
  const reasons = [];
  const checks = {};

  const record = (name, ok, reason) => {
    checks[name] = ok;
    if (!ok && reason !== undefined) reasons.push(reason);
    return ok;
  };

  const recordedPr = state?.currentPr ?? null;

  record('prOpen', pr?.state === 'OPEN' && pr?.merged !== true, 'the pull request is not open');
  record(
    'correctBase',
    pr?.baseRefName === config.baseBranch,
    `the pull request does not target ${config.baseBranch}`,
  );
  record('sameRepository', pr?.isCrossRepository !== true, 'the pull request comes from a fork');
  record(
    'loopBranch',
    typeof pr?.headRefName === 'string' && pr.headRefName.startsWith(config.branchPrefix),
    `the branch does not use the loop prefix ${config.branchPrefix}`,
  );

  if (recordedPr !== null && typeof recordedPr.number === 'number') {
    record(
      'activePr',
      recordedPr.number === pr?.number,
      `PR #${pr?.number} is not the loop's recorded active pull request (#${recordedPr.number})`,
    );
    record(
      'activeBranch',
      recordedPr.branch === pr?.headRefName,
      'the pull request branch does not match the recorded active branch',
    );
  } else {
    // No usable state: fall back to the pull request's own evidence, which is
    // weaker but still refuses an unrelated pull request.
    record(
      'activePr',
      (pr?.labels ?? []).includes(config.automation.triggerLabel) ||
        /AI-\d+/.test(`${pr?.title ?? ''} ${pr?.headRefName ?? ''}`),
      'the pull request is not labelled as an AI-loop task and names no task id',
    );
  }

  record(
    'notBlocked',
    !STOPPED_STATUSES.includes(state?.status) &&
      !(pr?.labels ?? []).includes(config.automation.blockedLabel),
    'the loop is blocked and needs a human decision',
  );
  record(
    'reviewApproved',
    verdict === 'approved',
    verdict === undefined
      ? 'no review verdict is recorded for this pull request'
      : `the latest review verdict is "${verdict}"`,
  );
  // The approval must belong to the commit being merged. This is what makes
  // "a push after approval invalidates the approval" hold.
  record(
    'headMatchesApproval',
    verdictHeadSha !== undefined && verdictHeadSha === pr?.headRefOid,
    verdictHeadSha === undefined
      ? 'the approval records no head commit'
      : 'the head commit changed after the approval; the new commit must be reviewed',
  );
  record('ciGreen', ci?.status === 'success', `required CI is ${ci?.status ?? 'unknown'}`);
  record('mergeable', pr?.mergeable !== 'CONFLICTING', 'the pull request has merge conflicts');

  const protectedHits = protectedPathViolations(changedPaths, config.protectedPaths);
  const credentials = credentialViolations(changedPaths);
  if (config.automation.stopOnProtectedPath === true && protectedHits.length > 0) {
    record('noProtectedPaths', false, `protected paths changed: ${protectedHits.join(', ')}`);
  } else {
    record('noProtectedPaths', true);
  }
  if (config.automation.stopOnProtectedPath === true && credentials.length > 0) {
    record('noCredentials', false, `credential files changed: ${credentials.join(', ')}`);
  } else {
    record('noCredentials', true);
  }

  return { allowed: reasons.length === 0, reasons, checks, protectedHits, credentials };
}

/**
 * Classify a failure as a hard stop (a human is required) or a normal event
 * (the loop handles it and carries on).
 *
 * Getting this wrong in either direction is expensive: treating a normal event
 * as a hard stop breaks the autonomous path, and treating a real exception as
 * normal lets the loop spin or merge something it should not.
 */
export const HARD_STOPS = {
  'max-rounds-exceeded':
    'The maximum number of review rounds was reached with findings still open.',
  'reviewer-blocked': 'The reviewer explicitly blocked the pull request.',
  'protected-path': 'A protected path was modified.',
  'migration-change': 'A database migration was modified.',
  'credential-change': 'A credential or environment file was modified.',
  'ci-workflow-change': 'The CI workflow definition was modified.',
  'security-sensitive': 'A security-sensitive change needs human review.',
  'contradictory-task': 'The task brief contradicts the repository state.',
  'ambiguous-roadmap': 'The next task could not be determined unambiguously.',
  'auth-failure-github': 'GitHub authentication failed and cannot be retried.',
  'auth-failure-openhands': 'OpenHands authentication failed and cannot be retried.',
  'auth-failure-openai': 'OpenAI authentication failed.',
  'merge-conflict': 'The pull request has a merge conflict that needs a human.',
  'branch-protection': 'Branch protection prevents the merge.',
  'no-valid-next-task': 'No valid next task could be generated.',
  'multiple-active-tasks': 'More than one implementation task is active.',
  'state-corruption': 'The loop state is invalid or inconsistent.',
  'unexpected-pr': 'The pull request/branch relationship is not the one the loop recorded.',
  'head-sha-mismatch': 'The head commit changed between approval and merge.',
};

export const NORMAL_EVENTS = {
  'changes-requested': 'The reviewer requested changes; the loop dispatches a fix.',
  'fix-round': 'OpenHands needs another fix round on the same pull request.',
  'ci-defect': 'CI failed because of a code defect; the fix round addresses it.',
  'ci-rerun': 'CI needs another run.',
  'task-completed': 'A task completed normally.',
  'next-task-generated': 'A next task was generated normally.',
  'pr-created': 'A pull request was created normally.',
  'pr-merged': 'A pull request merged normally.',
  approved: 'The reviewer approved; the loop proceeds to merge.',
};

export function classifyEvent(event) {
  if (Object.hasOwn(HARD_STOPS, event)) return { hardStop: true, description: HARD_STOPS[event] };
  if (Object.hasOwn(NORMAL_EVENTS, event))
    return { hardStop: false, description: NORMAL_EVENTS[event] };
  return { hardStop: true, description: `unrecognised event "${event}"` };
}

/** The label set a stop should leave behind. */
export function labelsForStop(config) {
  return {
    add: [config.automation.blockedLabel],
    remove: [config.automation.readyLabel],
  };
}
