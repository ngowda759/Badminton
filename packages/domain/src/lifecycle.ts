/**
 * Generic lifecycle helpers shared by the Phase 2 aggregates.
 *
 * A lifecycle is modelled as a total map from every status to the statuses it
 * may move to. Terminal statuses map to an empty list. Keeping the tables here
 * - rather than in the services - means the allowed transitions are a single,
 * pure source of truth that both the services and the tests read.
 */
export type TransitionTable<S extends string> = Readonly<Record<S, readonly S[]>>;

/** True when `to` is reachable from `from` in one step. */
export function isAllowedTransition<S extends string>(
  transitions: TransitionTable<S>,
  from: S,
  to: S,
): boolean {
  return transitions[from].includes(to);
}

/** True when `status` has no outgoing transitions. */
export function isTerminal<S extends string>(transitions: TransitionTable<S>, status: S): boolean {
  return transitions[status].length === 0;
}
