import {
  isRealtimeAggregateType,
  isRealtimeEventType,
  normalizeRealtimePayload,
  RealtimeEventValidationError,
  type RealtimeEvent,
} from '@badminton/domain';

import type { CreateRealtimeEventData } from '../repositories/data.ts';
import type { RepositoryClient } from '../repositories/index.ts';

/**
 * Realtime event creation abstraction.
 *
 * Services call `record` with the client they are already using - inside
 * `UnitOfWork.runInTransaction` for a mutation - so the event is written to the
 * outbox in the same transaction as the business change. This is the only way
 * events are created; no service writes the outbox directly and no service ever
 * publishes to SSE itself.
 *
 * The catalogue and payload shape are validated here, so a programmer error
 * fails the transaction instead of persisting a useless event.
 */
export interface RealtimeEventService {
  record(client: RepositoryClient, data: CreateRealtimeEventData): Promise<RealtimeEvent>;
}

export function createRealtimeEventService(): RealtimeEventService {
  return {
    async record(client, data): Promise<RealtimeEvent> {
      if (!isRealtimeEventType(data.eventType)) {
        throw new RealtimeEventValidationError(
          `Unknown realtime event type: ${String(data.eventType)}`,
        );
      }
      if (!isRealtimeAggregateType(data.aggregateType)) {
        throw new RealtimeEventValidationError(
          `Unknown realtime aggregate type: ${String(data.aggregateType)}`,
        );
      }
      if (data.tournamentId.length === 0 || data.aggregateId.length === 0) {
        throw new RealtimeEventValidationError(
          'A realtime event requires a tournament id and an aggregate id.',
        );
      }

      return client.realtimeEvents.create({
        tournamentId: data.tournamentId,
        eventType: data.eventType,
        aggregateType: data.aggregateType,
        aggregateId: data.aggregateId,
        payload: normalizeRealtimePayload(data.payload),
      });
    },
  };
}
