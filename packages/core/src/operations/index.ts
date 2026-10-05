/**
 * Durable local-command contract for the Android Cashier Hub.
 *
 * The browser does not instantiate this runtime. A native encrypted SQLite
 * adapter will implement TransactionalHubStore so receipt, event, projection,
 * audit, and outbox changes commit or roll back together.
 */

export interface HubCommand<TPayload = unknown> {
  commandId: string;
  type: string;
  issuedAt: string;
  deviceId: string;
  staffSessionId: string;
  sequence: number;
  payload: TPayload;
  signature: string;
}

/**
 * Trusted context derived by the native verifier. These values are never
 * accepted from the terminal command payload as authority.
 */
export interface AuthorizedHubCommandContext {
  businessId: string;
  branchId: string;
  deviceId: string;
  staffId: string;
  staffSessionId: string;
  role: string;
  authorizationBundleId: string;
  revocationVersion: number;
}

export interface HubEventDraft<TPayload = unknown> {
  entityId: string;
  entityType: string;
  action: string;
  payload: TPayload;
  schemaVersion?: number;
}

export interface HubEvent<TPayload = unknown> extends HubEventDraft<TPayload> {
  eventId: string;
  commandId: string;
  businessId: string;
  branchId: string;
  deviceId: string;
  staffId: string;
  staffSessionId: string;
  sequence: number;
  occurredAt: string;
  schemaVersion: number;
}

export interface HubProjectionWrite {
  projection: string;
  key: string;
  value: unknown;
}

export interface HubOutboxItem {
  outboxId: string;
  eventId: string;
  commandId: string;
  businessId: string;
  branchId: string;
  enqueuedAt: string;
  attempts: number;
  status: 'PENDING' | 'IN_FLIGHT' | 'ACKNOWLEDGED' | 'FAILED';
}

export interface HubAuditRecord {
  auditId: string;
  commandId: string;
  businessId: string;
  branchId: string;
  deviceId: string;
  staffId: string;
  staffSessionId: string;
  type: string;
  recordedAt: string;
  outcome: 'APPLIED';
}

export interface HubCommandReceipt {
  commandId: string;
  businessId: string;
  branchId: string;
  deviceId: string;
  staffSessionId: string;
  type: string;
  sequence: number;
  outcome: 'APPLIED' | 'DUPLICATE';
  committedAt: string;
  eventIds: string[];
  outboxIds: string[];
}

/** Internal idempotency metadata; it is never presented as business state. */
export interface HubReceiptRecord {
  receipt: HubCommandReceipt;
  commandFingerprint: string;
}

export interface HubTransaction {
  getReceipt(commandId: string): Promise<HubReceiptRecord | null>;
  saveReceipt(record: HubReceiptRecord): Promise<void>;
  appendEvent(event: HubEvent): Promise<void>;
  writeProjection(write: HubProjectionWrite): Promise<void>;
  enqueueOutbox(item: HubOutboxItem): Promise<void>;
  appendAudit(record: HubAuditRecord): Promise<void>;
}

export interface TransactionalHubStore {
  transaction<T>(operation: (transaction: HubTransaction) => Promise<T>): Promise<T>;
}

export interface CommandAuthorizer {
  authorize(command: HubCommand): Promise<AuthorizedHubCommandContext>;
}

export interface CommandEventFactory {
  createEvents(command: HubCommand, context: AuthorizedHubCommandContext): Promise<HubEventDraft[]>;
}

export interface CommandProjector {
  project(command: HubCommand, context: AuthorizedHubCommandContext, event: HubEvent): Promise<HubProjectionWrite[]>;
}

export interface HubIdFactory {
  create(prefix: string): string;
}

export interface HubClock {
  now(): string;
}

export class HubCommandRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HubCommandRejectedError';
  }
}

export class DenyAllCommandAuthorizer implements CommandAuthorizer {
  async authorize(_: HubCommand): Promise<AuthorizedHubCommandContext> {
    throw new HubCommandRejectedError(
      'No local authorization verifier is configured. The Android Hub must validate the signed device proof and offline authorization bundle before accepting commands.'
    );
  }
}

export class SystemHubClock implements HubClock {
  now(): string {
    return new Date().toISOString();
  }
}

export class SystemHubIdFactory implements HubIdFactory {
  create(prefix: string): string {
    const random = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}_${random}`;
  }
}

export class LocalCommandRuntime {
  private readonly store: TransactionalHubStore;
  private readonly authorizer: CommandAuthorizer;
  private readonly eventFactory: CommandEventFactory;
  private readonly projector: CommandProjector;
  private readonly ids: HubIdFactory;
  private readonly clock: HubClock;

  constructor(
    store: TransactionalHubStore,
    authorizer: CommandAuthorizer,
    eventFactory: CommandEventFactory,
    projector: CommandProjector,
    ids: HubIdFactory = new SystemHubIdFactory(),
    clock: HubClock = new SystemHubClock()
  ) {
    this.store = store;
    this.authorizer = authorizer;
    this.eventFactory = eventFactory;
    this.projector = projector;
    this.ids = ids;
    this.clock = clock;
  }

  /**
   * Applies one command atomically. A committed receipt is the idempotency
   * boundary: retries never create new events, projection writes, or outbox
   * rows. Cloud acknowledgement is intentionally outside this transaction.
   */
  async execute(command: HubCommand): Promise<HubCommandReceipt> {
    this.assertCommandShape(command);
    // Device/session proof is checked before a receipt can be observed. This
    // prevents an arbitrary caller from learning a receipt by guessing a UUID.
    // Sequence monotonicity belongs inside the transaction below so a genuine
    // retry can reach the idempotency boundary instead of looking stale.
    const context = await this.authorizer.authorize(command);
    this.assertAuthorizedContext(command, context);
    const commandFingerprint = fingerprintCommand(command);

    return this.store.transaction(async (transaction) => {
      const existing = await transaction.getReceipt(command.commandId);
      if (existing) {
        if (existing.commandFingerprint !== commandFingerprint || !sameReceiptPrincipal(existing.receipt, command, context)) {
          throw new HubCommandRejectedError('This command ID is already bound to a different verified command.');
        }
        return { ...existing.receipt, outcome: 'DUPLICATE' };
      }

      const drafts = await this.eventFactory.createEvents(command, context);
      if (!drafts.length) {
        throw new HubCommandRejectedError('A local command must produce at least one durable operational event.');
      }

      const committedAt = this.clock.now();
      const eventIds: string[] = [];
      const outboxIds: string[] = [];

      for (const draft of drafts) {
        this.assertEventDraft(draft);
        const event: HubEvent = {
          ...draft,
          eventId: this.ids.create('evt'),
          commandId: command.commandId,
          businessId: context.businessId,
          branchId: context.branchId,
          deviceId: context.deviceId,
          staffId: context.staffId,
          staffSessionId: context.staffSessionId,
          sequence: command.sequence,
          occurredAt: committedAt,
          schemaVersion: draft.schemaVersion || 1
        };

        await transaction.appendEvent(event);
        eventIds.push(event.eventId);

        const writes = await this.projector.project(command, context, event);
        for (const write of writes) {
          this.assertProjectionWrite(write);
          await transaction.writeProjection(write);
        }

        const outboxId = this.ids.create('outbox');
        await transaction.enqueueOutbox({
          outboxId,
          eventId: event.eventId,
          commandId: command.commandId,
          businessId: context.businessId,
          branchId: context.branchId,
          enqueuedAt: committedAt,
          attempts: 0,
          status: 'PENDING'
        });
        outboxIds.push(outboxId);
      }

      await transaction.appendAudit({
        auditId: this.ids.create('audit'),
        commandId: command.commandId,
        businessId: context.businessId,
        branchId: context.branchId,
        deviceId: context.deviceId,
        staffId: context.staffId,
        staffSessionId: context.staffSessionId,
        type: command.type,
        recordedAt: committedAt,
        outcome: 'APPLIED'
      });

      const receipt: HubCommandReceipt = {
        commandId: command.commandId,
        businessId: context.businessId,
        branchId: context.branchId,
        deviceId: context.deviceId,
        staffSessionId: context.staffSessionId,
        type: command.type,
        sequence: command.sequence,
        outcome: 'APPLIED',
        committedAt,
        eventIds,
        outboxIds
      };
      await transaction.saveReceipt({ receipt, commandFingerprint });
      return receipt;
    });
  }

  private assertCommandShape(command: HubCommand) {
    const required: Array<keyof HubCommand> = ['commandId', 'type', 'deviceId', 'staffSessionId', 'issuedAt', 'signature'];
    if (required.some((field) => !String(command[field] || '').trim())) {
      throw new HubCommandRejectedError('Command identity, type, device, staff session, signature, and issued time are required.');
    }
    if (!Number.isInteger(command.sequence) || command.sequence < 0) {
      throw new HubCommandRejectedError('A non-negative, monotonic terminal-session sequence is required.');
    }
    if (command.payload === undefined) {
      throw new HubCommandRejectedError('Command payload is required.');
    }
  }

  private assertAuthorizedContext(command: HubCommand, context: AuthorizedHubCommandContext) {
    if (!context.businessId || !context.branchId || !context.staffId || !context.staffSessionId || !context.authorizationBundleId) {
      throw new HubCommandRejectedError('The native verifier did not return complete business, branch, staff-session, and authorization-bundle context.');
    }
    if (context.deviceId !== command.deviceId || context.staffSessionId !== command.staffSessionId) {
      throw new HubCommandRejectedError('Verified device or staff session does not match the submitted command.');
    }
  }

  private assertEventDraft(draft: HubEventDraft) {
    if (!draft.entityId || !draft.entityType || !draft.action) {
      throw new HubCommandRejectedError('Every operational event needs an entity id, entity type, and action.');
    }
  }

  private assertProjectionWrite(write: HubProjectionWrite) {
    if (!write.projection || !write.key || write.value === undefined) {
      throw new HubCommandRejectedError('Every projection write needs a projection name, key, and defined value.');
    }
  }
}

interface InMemoryHubState {
  receipts: Map<string, HubReceiptRecord>;
  events: HubEvent[];
  projections: Map<string, unknown>;
  outbox: HubOutboxItem[];
  audit: HubAuditRecord[];
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneState(state: InMemoryHubState): InMemoryHubState {
  return {
    receipts: new Map(Array.from(state.receipts.entries(), ([key, value]) => [key, cloneValue(value)])),
    events: cloneValue(state.events),
    projections: new Map(Array.from(state.projections.entries(), ([key, value]) => [key, cloneValue(value)])),
    outbox: cloneValue(state.outbox),
    audit: cloneValue(state.audit)
  };
}

/**
 * Contract-test adapter only. It is intentionally volatile and must never be
 * used as the operational persistence implementation.
 */
export class InMemoryTransactionalHubStore implements TransactionalHubStore {
  private state: InMemoryHubState = {
    receipts: new Map(),
    events: [],
    projections: new Map(),
    outbox: [],
    audit: []
  };
  private tail: Promise<void> = Promise.resolve();

  async transaction<T>(operation: (transaction: HubTransaction) => Promise<T>): Promise<T> {
    let release!: () => void;
    const acquired = new Promise<void>((resolve) => { release = resolve; });
    const previous = this.tail;
    this.tail = previous.then(() => acquired, () => acquired);
    await previous.catch(() => undefined);

    const draft = cloneState(this.state);
    const transaction: HubTransaction = {
      getReceipt: async (commandId) => cloneValue(draft.receipts.get(commandId) || null),
      saveReceipt: async (record) => { draft.receipts.set(record.receipt.commandId, cloneValue(record)); },
      appendEvent: async (event) => { draft.events.push(cloneValue(event)); },
      writeProjection: async (write) => { draft.projections.set(`${write.projection}:${write.key}`, cloneValue(write.value)); },
      enqueueOutbox: async (item) => { draft.outbox.push(cloneValue(item)); },
      appendAudit: async (record) => { draft.audit.push(cloneValue(record)); }
    };

    try {
      const result = await operation(transaction);
      this.state = draft;
      return result;
    } finally {
      release();
    }
  }

  inspect(): Readonly<{
    receipts: HubCommandReceipt[];
    events: HubEvent[];
    projections: Array<{ key: string; value: unknown }>;
    outbox: HubOutboxItem[];
    audit: HubAuditRecord[];
  }> {
    return {
      receipts: Array.from(this.state.receipts.values(), (record) => cloneValue(record.receipt)),
      events: cloneValue(this.state.events),
      projections: Array.from(this.state.projections.entries(), ([key, value]) => ({ key, value: cloneValue(value) })),
      outbox: cloneValue(this.state.outbox),
      audit: cloneValue(this.state.audit)
    };
  }
}

function sameReceiptPrincipal(
  receipt: HubCommandReceipt,
  command: HubCommand,
  context: AuthorizedHubCommandContext
): boolean {
  return receipt.businessId === context.businessId &&
    receipt.branchId === context.branchId &&
    receipt.deviceId === context.deviceId &&
    receipt.staffSessionId === context.staffSessionId &&
    receipt.type === command.type &&
    receipt.sequence === command.sequence;
}

/**
 * Deliberately deterministic and dependency-free for contract tests. Native
 * SQLCipher persists a SHA-256 of its concrete signed command bytes instead.
 */
function fingerprintCommand(command: HubCommand): string {
  return [
    command.commandId,
    command.type,
    command.issuedAt,
    command.deviceId,
    command.staffSessionId,
    String(command.sequence),
    canonicalJson(command.payload)
  ].join('\u001f');
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new HubCommandRejectedError('Command payload cannot contain a non-finite number.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
  }
  throw new HubCommandRejectedError('Command payload must be JSON-compatible.');
}
