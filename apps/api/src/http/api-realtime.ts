import type { RealtimeEventPublisher } from '@badminton/application';

/**
 * The realtime wiring the HTTP layer needs.
 *
 * Phase 8.1 builds the publisher and outbox plumbing; Phase 8.2 adds the SSE
 * route on top of this. The HTTP layer depends only on the publisher port, so
 * routes never reach for Prisma or a `pg` client and tests can inject an
 * in-memory publisher.
 */
export interface ApiRealtime {
  readonly publisher: RealtimeEventPublisher;
}
