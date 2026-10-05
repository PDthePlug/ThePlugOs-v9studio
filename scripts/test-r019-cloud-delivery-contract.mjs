import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HubSyncAcknowledgementError,
  validateDistinctSyncEvents,
  validateReceiverAcknowledgements,
} from '../supabase/functions/_shared/hub-sync-ack.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (relativePath) => readFile(resolve(root, relativePath), 'utf8');
const requireText = (subject, fragment, message = `Expected source to contain: ${fragment}`) => {
  assert.ok(subject.includes(fragment), message);
};

const [
  packageSource,
  adr,
  receiverContract,
  acknowledgementValidator,
  syncEndpoint,
  syncClient,
  database,
  config,
  deployScript,
  releaseStatus,
] = await Promise.all([
  load('package.json'),
  load('docs/architecture/ADR-012_CLOUD_SYNC_BATCH_ACKNOWLEDGEMENT_INTEGRITY.md'),
  load('docs/architecture/CLOUD_HUB_RECEIVER_CONTRACT.md'),
  load('supabase/functions/_shared/hub-sync-ack.ts'),
  load('supabase/functions/hub-sync/index.ts'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubCloudSyncClient.kt'),
  load('android/app/src/main/java/com/theplugos/cashierhub/native/HubDatabase.kt'),
  load('supabase/config.toml'),
  load('scripts/deploy-hub-cloud.sh'),
  load('docs/operations/RELEASE_STATUS.md'),
]);

const packageManifest = JSON.parse(packageSource);
assert.equal(
  packageManifest.scripts['test:r019-cloud-delivery'],
  'node --experimental-strip-types scripts/test-r019-cloud-delivery-contract.mjs',
  'R019 must retain a dedicated cloud-delivery contract command.',
);
assert.ok(packageManifest.scripts['test:all'].includes('test:r019-cloud-delivery'), 'The full source gate must run R019.');

for (const fragment of [
  'OUTBOX_PENDING',
  'ACK_VALIDATED',
  'RECEIVER_GROUP_PENDING',
  'cross-group',
  'Duplicate event ID in an outbound batch',
  'Partial valid acknowledgement',
]) requireText(adr, fragment);
requireText(receiverContract, 'ADR-012 further binds each acknowledgement');
requireText(receiverContract, 'duplicate outbound event ID before any receiver runs');

const normalizeFixtureEventId = (value) => {
  if (typeof value !== 'string') throw new HubSyncAcknowledgementError('Fixture ID is invalid.');
  return value;
};
assert.deepEqual(
  validateDistinctSyncEvents(['order-1', 'payment-1'], (event) => ({
    event,
    eventId: event,
    receiver: event.startsWith('order') ? 'orders' : 'payments',
  })),
  [
    { event: 'order-1', eventId: 'order-1', receiver: 'orders' },
    { event: 'payment-1', eventId: 'payment-1', receiver: 'payments' },
  ],
  'A valid signed batch must preserve its event identities and receiver family.',
);
assert.throws(
  () => validateDistinctSyncEvents(['order-1', 'order-1'], (event) => ({ event, eventId: event, receiver: 'orders' })),
  HubSyncAcknowledgementError,
  'A duplicate event ID must fail before a receiver can be called.',
);
const orderGroup = new Set(['order-1']);
assert.deepEqual(
  validateReceiverAcknowledgements(['order-1'], orderGroup, normalizeFixtureEventId),
  ['order-1'],
  'A receiver may acknowledge its own event.',
);
assert.deepEqual(
  validateReceiverAcknowledgements([], orderGroup, normalizeFixtureEventId),
  [],
  'A valid partial response may leave an event queued.',
);
for (const receipt of [['payment-1'], ['order-1', 'order-1'], [42], 'order-1']) {
  assert.throws(
    () => validateReceiverAcknowledgements(receipt, orderGroup, normalizeFixtureEventId),
    HubSyncAcknowledgementError,
    'Cross-group, duplicate, non-string, and non-array acknowledgements must fail closed.',
  );
}

requireText(acknowledgementValidator, 'export function validateDistinctSyncEvents');
requireText(acknowledgementValidator, 'Sync payload contains duplicate event IDs.');
requireText(acknowledgementValidator, 'export function validateReceiverAcknowledgements');
requireText(acknowledgementValidator, 'seenEventIds.has(parsed.eventId)');
requireText(acknowledgementValidator, 'acknowledgedInGroup.has(eventId)');
requireText(syncEndpoint, 'validateDistinctSyncEvents');
requireText(syncEndpoint, 'const inputEvents = payload.events.map');
requireText(syncEndpoint, 'const groupEventIds = new Set(group.map((entry) => entry.eventId))');
requireText(syncEndpoint, 'p_events: group.map((entry) => entry.event)');
requireText(syncEndpoint, 'validateReceiverAcknowledgements');
requireText(syncEndpoint, "uuid(acknowledgement, 'Sync acknowledgement event ID')");
requireText(syncEndpoint, 'return noStoreJson({ ok: true, acknowledgedEventIds });');
assert.ok(
  syncEndpoint.indexOf('const validatedEvents = validateDistinctSyncEvents') < syncEndpoint.indexOf('const flush = async () =>'),
  'The whole batch must validate before the first receiver can run.',
);

requireText(syncClient, 'val rawAcknowledgement = acknowledged.opt(index)');
requireText(syncClient, 'rawAcknowledgement !is String');
requireText(syncClient, 'eventId !in submittedIds || eventId in acknowledgedIds');
requireText(syncClient, 'database.acknowledgeCloudEvents(acknowledgedIds, HubCloudTime.now())');
requireText(syncClient, 'database.recordCloudSyncFailure(submittedIds, "CLOUD_SYNC_UNACKNOWLEDGED")');
assert.ok(!syncClient.includes('val acknowledgedIds = buildSet'), 'Duplicate acknowledgement IDs must be rejected, not silently collapsed.');

requireText(database, "WHERE event_id = ? AND status != 'ACKNOWLEDGED'");
requireText(database, "SET attempts = attempts + 1, status = 'FAILED'");

const syncConfigStart = config.indexOf('[functions.hub-sync]');
const syncConfigEnd = config.indexOf('[functions.', syncConfigStart + 1);
assert.ok(syncConfigStart >= 0, 'hub-sync must be explicitly configured.');
assert.match(config.slice(syncConfigStart, syncConfigEnd < 0 ? undefined : syncConfigEnd), /verify_jwt\s*=\s*false/);
requireText(deployScript, 'test-r019-cloud-delivery-contract.mjs');
requireText(releaseStatus, 'ADR-012/R019');
assert.match(releaseStatus, /\*\*Status:\*\* HOLD/, 'R019 must not grant release authority.');
assert.match(releaseStatus, /not evidence of a deployed `hub-sync` Function/, 'R019 must retain truthful delivery boundaries.');

console.log('R019 cloud-delivery acknowledgement contract checks passed');
