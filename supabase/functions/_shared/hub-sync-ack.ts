/**
 * Deterministic acknowledgement validation shared by the `hub-sync` Edge
 * receiver and its source gate. It deliberately has no Deno, Supabase, or
 * crypto dependency so malformed receiver output can be tested without a live
 * Function or database connection.
 */
export class HubSyncAcknowledgementError extends Error {}

export interface ValidatedSyncEvent<TEvent, TReceiver> {
  event: TEvent;
  eventId: string;
  receiver: TReceiver;
}

/** Validates all batch identities before any action-family receiver is called. */
export function validateDistinctSyncEvents<TEvent, TReceiver>(
  values: readonly TEvent[],
  parse: (value: TEvent) => ValidatedSyncEvent<TEvent, TReceiver>,
): ValidatedSyncEvent<TEvent, TReceiver>[] {
  const seenEventIds = new Set<string>();
  return values.map((value) => {
    const parsed = parse(value);
    if (seenEventIds.has(parsed.eventId)) {
      throw new HubSyncAcknowledgementError('Sync payload contains duplicate event IDs.');
    }
    seenEventIds.add(parsed.eventId);
    return parsed;
  });
}

/** A receiver may acknowledge only unique IDs from the exact group supplied
 * to it. A valid empty acknowledgement is allowed; the Hub keeps every other
 * outbox row queued for an exact retry. */
export function validateReceiverAcknowledgements(
  values: unknown,
  groupEventIds: ReadonlySet<string>,
  normalizeEventId: (value: unknown) => string,
): string[] {
  if (!Array.isArray(values)) {
    throw new HubSyncAcknowledgementError('Sync receipt is invalid.');
  }
  const acknowledgedInGroup = new Set<string>();
  return values.map((acknowledgement) => {
    const eventId = normalizeEventId(acknowledgement);
    if (!groupEventIds.has(eventId) || acknowledgedInGroup.has(eventId)) {
      throw new HubSyncAcknowledgementError('Sync receipt is invalid.');
    }
    acknowledgedInGroup.add(eventId);
    return eventId;
  });
}
