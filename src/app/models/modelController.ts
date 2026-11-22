import {
  ClientEvent,
  MatrixClient,
  MatrixEvent,
  MatrixEventEvent,
  Room,
  RoomMember,
  RoomMemberEvent,
  SyncState,
} from 'matrix-js-sdk';
import type { ReceivedToDeviceMessage } from 'matrix-js-sdk/lib/sync-accumulator';
import type { RoomMessageEventContent } from 'matrix-js-sdk/lib/@types/events';
import { CryptoEvent } from 'matrix-js-sdk/lib/crypto-api';
import { threadModelContent, type ThreadModelContent } from '../matrix/protocol/threadModel';
import { getMessageRelation } from '../matrix/send/composeMessageRelation';
import {
  ModelCatalogEntry,
  ModelCatalogResponse,
  ModelInheritedEntry,
  ModelSelectionResult,
  MODEL_RESPONSE,
  MODEL_RESULT,
  MODEL_SELECTION,
  MODEL_TIMEOUT,
  parseModelCatalogResponse,
  parseModelSelectionResult,
  ReasoningLevel,
} from './modelProtocol';
import {
  ModelRuntime,
  hasJoinedModelAgent,
  isCurrentModelRuntime,
  joinedModelCandidates,
  signedModelDevices,
} from './modelDeviceTrust';
import { sendModelRequest } from './modelTransport';
import { loadRoomCatalogs, ROOM_CATALOG_LIMIT, type RoomCatalog } from './modelCatalogStorage';
import { randomUuid } from '../lib/randomUuid';

export type ModelPickerSnapshot = {
  eligible: boolean;
  runtimes: ModelRuntime[];
  runtime?: ModelRuntime;
  models: ModelCatalogEntry[];
  override: string | null;
  /** The override's reasoning level when it names one; null runs the model at its default. */
  reasoning: ReasoningLevel | null;
  inherited: ModelInheritedEntry[];
  loading: boolean;
  pending: boolean;
  canMutate: boolean;
  error?: string;
};
type Catalog = { runtime: ModelRuntime; response: ModelCatalogResponse };
type RootModelDraft = { catalog: Catalog; key: string; level?: ReasoningLevel };
type Scope = {
  room: Room;
  threadId?: string;
  /** Room-settings catalog-only view: lists all models without composer draft or cache writes. */
  catalogOnly: boolean;
  snapshot: ModelPickerSnapshot;
  listeners: Set<() => void>;
  /** Readers of the snapshot that ask for nothing (`watch`): they start and keep no discovery. */
  watchers: Set<() => void>;
  catalogs: Map<string, Catalog>;
  generation: number;
  needsRefresh: boolean;
  chosenRuntimeId?: string;
  refreshScheduled?: boolean;
  /** Discovery attempts that ended without an answer since the last accepted one. */
  failures: number;
  retry?: ReturnType<typeof setTimeout>;
  /** The verified runtimes a button shown without catalogs (cached or revalidating) rests on. */
  kept?: RoomCatalog[];
  /** The cached-catalog seed waits for a probe that sees the full member roster. */
  seedDeferred: boolean;
  /** Recent event IDs of model commands typed in the thread and awaiting answers. */
  typedCommands: Set<string>;
  draft?: RootModelDraft;
  query?: Query;
  command?: Command;
  send?: Command;
};
type Query = {
  id: string;
  scope: Scope;
  generation: number;
  devices: ModelRuntime[];
  hydrating: boolean;
  replies: Map<string, Catalog>;
  abort: AbortController;
  timer: ReturnType<typeof setTimeout>;
};
type Command = {
  scope: Scope;
  runtime: ModelRuntime;
  operation: 'set' | 'reset';
  /** The catalog key, which the selection reports once the runtime applies it. */
  model?: string;
  /** The picked level; the command sends `<model>@<level>`, and the plain key without one. */
  level?: ReasoningLevel;
  eventId?: string;
  generation: number;
  early: ModelSelectionResult[];
  acknowledged?: boolean;
  timer: ReturnType<typeof setTimeout>;
};
const NO_MODELS: ModelCatalogEntry[] = [];
const emptySnapshot = (): ModelPickerSnapshot => ({
  eligible: false,
  runtimes: [],
  models: [],
  override: null,
  reasoning: null,
  inherited: [],
  loading: false,
  pending: false,
  canMutate: false,
});
/** What the command names: the key, with the picked level after `@`. */
const commandModel = ({ model, level }: Pick<Command, 'model' | 'level'>): string | undefined =>
  model && level ? `${model}@${level}` : model;
const INACTIVE_SNAPSHOT = emptySnapshot();
const scopeKey = (room: Room, threadId?: string, catalogOnly = false): string =>
  catalogOnly
    ? JSON.stringify([room.roomId, null, 'catalog'])
    : JSON.stringify([room.roomId, threadId]);
/** Discovery asks again after these delays while a composer shows the scope, the last repeating. */
const RETRY_DELAYS = [3000, 10000, 30000, 60000];
/** Failed attempts after which a button shown without a confirmed catalog hides. */
const STALE_ATTEMPTS = 5;
const supportsRootModel = ({ response }: Catalog): boolean =>
  response.capabilities.includes('thread_model_on_root');
const draftMatches = (catalog: Catalog | undefined, draft: RootModelDraft): boolean => {
  if (catalog?.runtime.id !== draft.catalog.runtime.id || !supportsRootModel(catalog)) return false;
  const entry = catalog.response.models.find(({ key }) => key === draft.key);
  return !!entry && (draft.level === undefined || !!entry.reasoning_levels?.includes(draft.level));
};
const roomCatalogsOf = (catalogs: Iterable<Catalog>): RoomCatalog[] =>
  [...catalogs].map((catalog) => ({
    runtime: catalog.runtime,
    models: catalog.response.models,
    agentUserIds: catalog.response.agent_user_ids,
    ...(supportsRootModel(catalog) && { supportsRootModel: true }),
    inherited: catalog.response.selection.inherited,
  }));
/** The runtime and every agent it named stay joined: what a button no composer shows rests on. */
const everyAgentJoined = (mx: MatrixClient, room: Room, { runtime, agentUserIds }: RoomCatalog) =>
  hasJoinedModelAgent(mx, room, runtime, agentUserIds) &&
  agentUserIds.every((id) => joinedModelCandidates(mx, room).includes(id));
const controllers = new WeakMap<MatrixClient, ModelController>();

/** One listener owner per client; composer subscriptions only select a scope. */
export class ModelController {
  private readonly scopes = new Map<string, Scope>();

  private roomCatalogs: ReturnType<typeof loadRoomCatalogs>;

  private readonly queries = new Map<string, Query>();

  private readonly userId: string | null;

  private disposed = false;

  private started = false;

  private owners = 0;

  constructor(private readonly mx: MatrixClient) {
    this.userId = mx.getUserId();
    this.roomCatalogs = loadRoomCatalogs(this.userId);
  }

  /** Restart is explicit; snapshot reads and actions never replace a stopped owner. */
  retain = (): (() => void) => {
    this.owners += 1;
    this.start();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.owners -= 1;
      if (this.owners === 0) this.dispose();
    };
  };

  private start(): void {
    if (
      (this.started && !this.disposed) ||
      this.mx.getSyncState() === SyncState.Stopped ||
      this.mx.getUserId() !== this.userId
    )
      return;
    const restarting = this.disposed;
    if (restarting) this.roomCatalogs = loadRoomCatalogs(this.userId);
    this.started = true;
    this.disposed = false;
    const mx = this.mx;
    mx.on(ClientEvent.ReceivedToDeviceMessage, this.onResponse);
    mx.on(ClientEvent.Event, this.onEvent);
    mx.on(MatrixEventEvent.Decrypted, this.onEvent);
    mx.on(RoomMemberEvent.Membership, this.onMembership);
    mx.on(CryptoEvent.DevicesUpdated, this.onDevices);
    mx.on(ClientEvent.Sync, this.onSync);
    if (typeof document !== 'undefined')
      document.addEventListener('visibilitychange', this.onVisibility);
    this.scopes.forEach((scope) => {
      if (restarting) this.reseed(scope);
      if (scope.listeners.size) this.refreshScope(scope);
    });
  }

  private active(): boolean {
    return this.started && !this.disposed && this.mx.getUserId() === this.userId;
  }

  private roomSeed(room: Room, threadId?: string, catalogOnly = false) {
    if (catalogOnly) {
      return { kept: [], eligible: false, runtimes: [], models: [], inherited: [] };
    }
    const cached = this.roomCatalogs.rooms.get(room.roomId);
    const kept = (cached ?? []).filter(
      ({ runtime, agentUserIds, supportsRootModel: supports }) =>
        (threadId || supports) && hasJoinedModelAgent(this.mx, room, runtime, agentUserIds)
    );
    const single = kept.length === 1 ? kept[0] : undefined;
    return {
      kept,
      eligible: kept.length > 0,
      // A chooser needs the thread's own catalogs, not the room's display seed.
      runtimes: single ? [single.runtime] : [],
      models: single?.models ?? [],
      inherited: single && everyAgentJoined(this.mx, room, single) ? single.inherited : [],
    };
  }

  private reseed(scope: Scope): void {
    const { kept, ...seed } = this.roomSeed(scope.room, scope.threadId, scope.catalogOnly);
    scope.kept = kept;
    if (seed.eligible || scope.snapshot.eligible) this.publish(scope, seed);
  }

  private scope(room: Room, threadId?: string, catalogOnly = false): Scope {
    const key = scopeKey(room, threadId, catalogOnly);
    let scope = this.scopes.get(key);
    if (!scope) {
      // Keep inactive scope caches bounded without evicting subscriptions or pending commands.
      if (this.scopes.size >= 64) {
        const stale = [...this.scopes.entries()].find(
          ([, s]) => !s.listeners.size && !s.watchers.size && !s.command && !s.send && !s.draft
        );
        if (stale) {
          this.cancelQuery(stale[1]);
          this.scopes.delete(stale[0]);
        }
      }
      const { kept, ...seed } = this.roomSeed(room, threadId, catalogOnly);
      scope = {
        room,
        threadId,
        catalogOnly,
        snapshot: { ...emptySnapshot(), ...seed },
        listeners: new Set(),
        watchers: new Set(),
        typedCommands: new Set(),
        catalogs: new Map(),
        generation: 0,
        needsRefresh: false,
        failures: 0,
        kept,
        seedDeferred: !room.membersLoaded(),
      };
      this.scopes.set(key, scope);
    }
    return scope;
  }

  getSnapshot = (room: Room, threadId?: string): ModelPickerSnapshot =>
    this.mx.getUserId() === this.userId ? this.scope(room, threadId).snapshot : INACTIVE_SNAPSHOT;

  /**
   * Room-settings catalog-only snapshot, independent of the room composer's draft and eligibility.
   * Its `canMutate` says the shown runtime answered the latest refresh, so its models are current.
   */
  getRoomCatalogSnapshot = (room: Room): ModelPickerSnapshot =>
    this.mx.getUserId() === this.userId
      ? this.scope(room, undefined, true).snapshot
      : INACTIVE_SNAPSHOT;

  /**
   * The models of the runtime `userId` runs on `deviceId`, while the catalog the scope shows is
   * that runtime's: its chosen runtime's, or its one runtime's from the room's cache. None for
   * any other runtime, whose models may carry the same keys under other names.
   */
  runtimeModels = (
    room: Room,
    threadId: string | undefined,
    userId: string,
    deviceId: string
  ): ModelCatalogEntry[] => {
    const { runtime, runtimes, models } = this.getSnapshot(room, threadId);
    const shown = runtime ?? (runtimes.length === 1 ? runtimes[0] : undefined);
    return shown?.userId === userId && shown.deviceId === deviceId ? models : NO_MODELS;
  };

  private publish(scope: Scope, patch: Partial<ModelPickerSnapshot>): void {
    scope.snapshot = { ...scope.snapshot, ...patch };
    scope.snapshot.canMutate = this.canMutate(scope);
    this.notify(scope);
  }

  private notify(scope: Scope): void {
    scope.listeners.forEach((listener) => listener());
    scope.watchers.forEach((watcher) => watcher());
  }

  /**
   * Hears a scope's snapshot change without asking for it: what a composer's subscription
   * discovered shows elsewhere too, such as a model's name on a thread's model change line, and
   * a scope with watchers alone sends nothing.
   */
  watch = (room: Room, threadId: string | undefined, watcher: () => void): (() => void) => {
    const scope = this.scope(room, threadId);
    scope.watchers.add(watcher);
    return () => {
      scope.watchers.delete(watcher);
    };
  };

  private subscribeScope(scope: Scope, listener: () => void): () => void {
    scope.listeners.add(listener);
    if (scope.listeners.size === 1 && !scope.command) this.refreshScope(scope);
    return () => {
      scope.listeners.delete(listener);
      if (!scope.listeners.size) {
        this.cancelQuery(scope);
        clearTimeout(scope.retry);
        scope.failures = 0;
        this.publish(scope, { loading: false });
      }
    };
  }

  subscribe = (room: Room, threadId: string | undefined, listener: () => void): (() => void) => {
    if (!this.started && !this.disposed) this.start();
    return this.subscribeScope(this.scope(room, threadId), listener);
  };

  subscribeRoomCatalog = (room: Room, listener: () => void): (() => void) => {
    if (!this.started && !this.disposed) this.start();
    return this.subscribeScope(this.scope(room, undefined, true), listener);
  };

  private cancelQuery(scope: Scope): void {
    const query = scope.query;
    if (!query) return;
    query.abort.abort();
    clearTimeout(query.timer);
    this.queries.delete(query.id);
    scope.query = undefined;
  }

  private currentQuery(query: Query): boolean {
    return (
      this.active() &&
      this.queries.get(query.id) === query &&
      query.scope.generation === query.generation &&
      !query.abort.signal.aborted
    );
  }

  refresh = (room: Room, threadId?: string): void => {
    this.refreshScope(this.scope(room, threadId));
  };

  refreshRoomCatalog = (room: Room): void => {
    this.refreshScope(this.scope(room, undefined, true));
  };

  private refreshScope(scope: Scope): void {
    const { room, threadId } = scope;
    if (
      !this.active() ||
      threadId === '' ||
      (threadId !== undefined && threadId.length > 1024) ||
      room.roomId.length > 1024 ||
      scope.command ||
      scope.query
    )
      return;
    if (this.queries.size >= 8) {
      this.publish(scope, { loading: false, error: 'Model discovery is busy. Try again.' });
      this.retryLater(scope, false);
      return;
    }
    clearTimeout(scope.retry);
    scope.generation += 1;
    const query: Query = {
      id: randomUuid(),
      scope,
      generation: scope.generation,
      devices: [],
      hydrating: !room.membersLoaded(),
      replies: new Map(),
      abort: new AbortController(),
      timer: setTimeout(() => this.finishQuery(query), MODEL_TIMEOUT),
    };
    scope.query = query;
    this.queries.set(query.id, query);
    // Room settings write no model of a list this refresh has not confirmed.
    if (scope.catalogOnly) scope.needsRefresh = true;
    this.publish(scope, { loading: true });
    void this.probe(query);
  }

  private async probe(query: Query): Promise<void> {
    try {
      const { scope, hydrating } = query;
      scope.seedDeferred ||= hydrating;
      if (hydrating) await scope.room.loadMembersIfNeeded();
      if (!this.currentQuery(query)) return;
      query.hydrating = false;
      const { failures, catalogs, snapshot, seedDeferred } = scope;
      scope.seedDeferred = false;
      // A cancelled probe leaves this seed check for the next probe with the full roster.
      if (seedDeferred && failures < STALE_ATTEMPTS && !catalogs.size && !snapshot.runtime) {
        this.reseed(scope);
        if (!this.currentQuery(query)) return;
      }
      const candidates = joinedModelCandidates(this.mx, query.scope.room);
      if (!candidates.length) {
        this.invalidate(query.scope);
        return;
      }
      const devices = await signedModelDevices(this.mx, candidates);
      if (!this.currentQuery(query)) return;
      query.devices = devices;
      if (!devices.length) {
        this.finishQuery(query);
        return;
      }
      await sendModelRequest(
        this.mx,
        devices,
        {
          version: 1,
          request_id: query.id,
          room_id: query.scope.room.roomId,
          ...(query.scope.threadId ? { thread_id: query.scope.threadId } : {}),
        },
        query.abort.signal,
        (runtimeId) => query.replies.has(runtimeId)
      );
    } catch {
      if (this.currentQuery(query)) this.finishQuery(query);
    }
  }

  private finishQuery(query: Query): void {
    if (!this.currentQuery(query)) return;
    const { scope } = query;
    this.cancelQuery(scope);
    if (!query.replies.size) {
      this.publish(scope, {
        loading: false,
        ...(scope.snapshot.eligible || scope.needsRefresh
          ? { error: 'Model discovery unavailable. Retry or use !model.' }
          : {}),
      });
      this.retryLater(scope, true);
      return;
    }
    scope.catalogs =
      scope.threadId || scope.catalogOnly
        ? query.replies
        : new Map([...query.replies].filter(([, catalog]) => supportsRootModel(catalog)));
    if (!scope.catalogOnly) {
      const { rooms, save } = this.roomCatalogs;
      const { roomId } = scope.room;
      const cached = roomCatalogsOf(
        [...query.replies.values()].filter(({ response }) =>
          response.capabilities.includes('model_selection')
        )
      );
      rooms.delete(roomId);
      if (cached.length) rooms.set(roomId, cached);
      if (rooms.size > ROOM_CATALOG_LIMIT) rooms.delete(rooms.keys().next().value);
      save();
    }
    scope.needsRefresh = !!scope.send;
    this.showCatalogs(scope, {
      loading: false,
      pending: !!scope.send,
      error: scope.send ? scope.snapshot.error : undefined,
    });
  }

  private showCatalogs(scope: Scope, patch?: Partial<ModelPickerSnapshot>): void {
    const runtimes = [...scope.catalogs.values()].map((c) => c.runtime);
    const runtime =
      runtimes.find((r) => r.id === scope.chosenRuntimeId) ??
      (runtimes.length === 1 ? runtimes[0] : undefined);
    if (!scope.threadId && runtime && scope.chosenRuntimeId !== runtime.id)
      scope.chosenRuntimeId = undefined;
    this.publish(scope, { ...patch, eligible: runtimes.length > 0, runtimes, runtime });
    this.showRuntime(scope, runtime);
  }

  /**
   * Asks again later while a composer shows the scope. A discovery that ran and got no answer
   * (`failed`) counts toward hiding a stale button; a local capacity refusal only waits.
   */
  private retryLater(scope: Scope, failed: boolean): void {
    clearTimeout(scope.retry);
    if (!this.active() || !scope.listeners.size) return;
    if (failed) scope.failures += 1;
    if (
      failed &&
      scope.failures >= STALE_ATTEMPTS &&
      scope.snapshot.eligible &&
      !scope.catalogs.size
    ) {
      // This thread keeps no dead button; the retries bring it back. The room cache stays: only
      // answers and membership or device invalidation change it, as another thread may be fine.
      scope.kept = undefined;
      scope.draft = undefined;
      this.publish(scope, { ...emptySnapshot(), pending: !!scope.send });
    }
    const delay = RETRY_DELAYS[Math.max(Math.min(scope.failures, RETRY_DELAYS.length) - 1, 0)];
    scope.retry = setTimeout(() => {
      scope.retry = undefined;
      if (this.active() && scope.listeners.size) this.refreshScope(scope);
    }, delay);
  }

  private onResponse = (payload: ReceivedToDeviceMessage): void => {
    void this.receiveResponse(payload).catch(() => undefined);
  };

  private async receiveResponse({
    message,
    encryptionInfo,
  }: ReceivedToDeviceMessage): Promise<void> {
    if (
      !this.active() ||
      message.type !== MODEL_RESPONSE ||
      !encryptionInfo ||
      encryptionInfo.sender !== message.sender
    )
      return;
    const response = parseModelCatalogResponse(message.content);
    if (
      !response ||
      (response.thread_id !== undefined && !response.capabilities.includes('model_selection'))
    )
      return;
    const query = this.queries.get(response.request_id);
    if (
      !query ||
      !this.currentQuery(query) ||
      response.room_id !== query.scope.room.roomId ||
      response.thread_id !== query.scope.threadId
    )
      return;
    const runtime = query.devices.find(
      (d) => d.userId === message.sender && d.curveKey === encryptionInfo.senderCurve25519KeyBase64
    );
    if (
      !runtime ||
      !hasJoinedModelAgent(this.mx, query.scope.room, runtime, response.agent_user_ids) ||
      !(await isCurrentModelRuntime(this.mx, runtime)) ||
      !this.currentQuery(query) ||
      !hasJoinedModelAgent(this.mx, query.scope.room, runtime, response.agent_user_ids)
    )
      return;
    const { scope } = query;
    const rootSupported = !scope.threadId && supportsRootModel({ runtime, response });
    if (scope.threadId || rootSupported || response.capabilities.includes('model_selection')) {
      query.replies.set(runtime.id, { runtime, response });
      query.scope.failures = 0;
    }
    if (scope.catalogOnly) {
      if (!query.replies.has(runtime.id)) return;
    } else if (!scope.threadId && !rootSupported) {
      if (scope.catalogs.delete(runtime.id)) this.showCatalogs(scope);
      else if (scope.draft?.catalog.runtime.id === runtime.id) {
        scope.draft = undefined;
        this.publish(scope, { override: null, reasoning: null });
      }
      return;
    }
    // Keep collecting: another signed device may represent a distinct runtime.
    // The shown runtime's answer is the thread's selection now, so show it at once.
    if (scope.snapshot.runtime?.id === runtime.id && scope.catalogs.has(runtime.id)) {
      scope.catalogs.set(runtime.id, { runtime, response });
      // For room settings this answer confirms the list, also after a refresh that failed.
      if (scope.catalogOnly) scope.needsRefresh = false;
      this.showRuntime(scope, runtime, scope.catalogOnly ? { error: undefined } : undefined);
    } else if (
      !scope.catalogs.size &&
      !scope.send &&
      (scope.chosenRuntimeId ?? runtime.id) === runtime.id
    ) {
      // A first discovery shows its first answer now rather than when the window ends, so the chip
      // is there before someone types `!model`, and a runtime that answers it can ask again.
      scope.catalogs = new Map([[runtime.id, { runtime, response }]]);
      scope.needsRefresh = false;
      this.publish(scope, { eligible: true, runtimes: [runtime], error: undefined });
      this.showRuntime(scope, runtime);
    }
  }

  private chooseScopeRuntime(scope: Scope, runtimeId: string): void {
    if (!this.active() || scope.command) return;
    const catalog = scope.catalogs.get(runtimeId);
    if (!catalog) return;
    scope.chosenRuntimeId = runtimeId;
    this.showRuntime(scope, catalog.runtime);
  }

  chooseRuntime = (room: Room, threadId: string | undefined, runtimeId: string): void => {
    this.chooseScopeRuntime(this.scope(room, threadId), runtimeId);
  };

  chooseRoomCatalogRuntime = (room: Room, runtimeId: string): void => {
    this.chooseScopeRuntime(this.scope(room, undefined, true), runtimeId);
  };

  private showRuntime(
    scope: Scope,
    runtime?: ModelRuntime,
    patch?: Partial<ModelPickerSnapshot>
  ): void {
    const catalog = runtime && scope.catalogs.get(runtime.id);
    if (scope.draft && !draftMatches(catalog, scope.draft)) scope.draft = undefined;
    else if (scope.draft && catalog) scope.draft.catalog = catalog;
    const selection = catalog?.response.selection;
    this.publish(scope, {
      ...patch,
      runtime,
      models: catalog ? catalog.response.models : [],
      override: scope.threadId ? selection?.override ?? null : scope.draft?.key ?? null,
      reasoning: scope.threadId ? selection?.reasoning ?? null : scope.draft?.level ?? null,
      inherited: catalog ? catalog.response.selection.inherited : [],
    });
  }

  /** Consumes the room's next-thread draft once, resetting the picker to Default. */
  takeRootModelDraft = (room: Room): ThreadModelContent | undefined => {
    const scope = this.scopes.get(scopeKey(room));
    const draft = scope?.draft;
    if (!scope || !draft || !this.active()) return undefined;
    scope.draft = undefined;
    this.publish(scope, { override: null, reasoning: null });
    const { catalog } = draft;
    if (
      !supportsRootModel(catalog) ||
      !hasJoinedModelAgent(this.mx, scope.room, catalog.runtime, catalog.response.agent_user_ids)
    )
      return undefined;
    const model = draft.level ? `${draft.key}@${draft.level}` : draft.key;
    return threadModelContent(catalog.runtime.userId, catalog.runtime.deviceId, model);
  };

  /** Runs the thread on `model`, at `level` when given (as `model@level`), else on the plain key. */
  selectModel = (
    room: Room,
    threadId: string | undefined,
    model: string,
    level?: ReasoningLevel
  ): void => {
    this.mutate(this.scope(room, threadId), 'set', model, level);
  };

  resetToRoomDefault = (room: Room, threadId?: string): void => {
    this.mutate(this.scope(room, threadId), 'reset');
  };

  private canMutate(scope: Scope): boolean {
    const { runtime } = scope.snapshot;
    const catalog = runtime && scope.catalogs.get(runtime.id);
    return !!(
      this.active() &&
      catalog &&
      runtime &&
      (scope.catalogOnly || scope.threadId || supportsRootModel(catalog)) &&
      !scope.command &&
      !scope.send &&
      !scope.needsRefresh &&
      hasJoinedModelAgent(this.mx, scope.room, runtime, catalog.response.agent_user_ids)
    );
  }

  private mutate(
    scope: Scope,
    operation: 'set' | 'reset',
    model?: string,
    level?: ReasoningLevel
  ): void {
    const entry = scope.snapshot.models.find((m) => m.key === model);
    if (
      !this.canMutate(scope) ||
      (operation === 'set' && !entry) ||
      (level !== undefined && !entry?.reasoning_levels?.includes(level))
    )
      return;
    const runtime = scope.snapshot.runtime!;
    if (!scope.threadId) {
      const catalog = scope.catalogs.get(runtime.id);
      if (!catalog) return;
      scope.draft =
        operation === 'set' ? { catalog, key: model!, ...(level && { level }) } : undefined;
      if (scope.draft) scope.chosenRuntimeId = runtime.id;
      this.publish(scope, {
        override: scope.draft?.key ?? null,
        reasoning: scope.draft?.level ?? null,
        error: undefined,
      });
      return;
    }
    this.cancelQuery(scope);
    scope.generation += 1;
    const command: Command = {
      scope,
      runtime,
      operation,
      model,
      // A picked level is always named, the default too: the catalog's default may be stale.
      ...(level !== undefined ? { level } : {}),
      generation: scope.generation,
      early: [],
      timer: setTimeout(() => this.uncertain(command), MODEL_TIMEOUT),
    };
    scope.command = command;
    scope.send = command;
    this.publish(scope, { pending: true, loading: false, error: undefined });
    void this.sendCommand(command);
  }

  private currentCommand(command: Command): boolean {
    return (
      this.active() &&
      command.scope.command === command &&
      command.scope.generation === command.generation
    );
  }

  private async sendCommand(command: Command): Promise<void> {
    const { scope, runtime, operation } = command;
    const model = commandModel(command);
    try {
      if (!(await isCurrentModelRuntime(this.mx, runtime))) {
        if (!this.currentCommand(command)) return;
        if (this.roomCatalogs.rooms.delete(scope.room.roomId)) this.roomCatalogs.save();
        this.invalidate(scope);
        return;
      }
      if (!this.currentCommand(command)) return;
      const content = {
        msgtype: 'm.text',
        body: '!model ' + (operation === 'reset' ? 'reset' : model),
        'm.relates_to': getMessageRelation(undefined, undefined, scope.threadId),
        [MODEL_SELECTION]: {
          version: 1,
          runtime_user_id: runtime.userId,
          runtime_device_id: runtime.deviceId,
          operation,
          ...(operation === 'set' ? { model } : {}),
        },
      } as RoomMessageEventContent;
      // The client scheduler already retries a dropped connection within its window; sending
      // the command again afterwards could change the model long after it was chosen.
      const result = await this.mx.sendMessage(scope.room.roomId, scope.threadId!, content);
      if (!this.currentCommand(command)) return;
      command.eventId = result.event_id;
      command.early.forEach((ack) => this.applyResult(command, ack));
      command.early = [];
    } catch {
      if (this.currentCommand(command)) this.uncertain(command);
    } finally {
      this.settleSend(command);
    }
  }

  private settleSend(command: Command): void {
    const { scope } = command;
    if (scope.send !== command) return;
    scope.send = undefined;
    if (command.acknowledged) {
      this.publish(scope, { pending: false });
      return;
    }
    if (this.currentCommand(command)) return;
    // A query completed before settlement can precede the delayed server mutation.
    // Keep the barrier until a new query, started after settlement, confirms selection.
    scope.needsRefresh = true;
    this.cancelQuery(scope);
    scope.generation += 1;
    this.publish(scope, { pending: this.active() });
    if (this.active()) this.refresh(scope.room, scope.threadId);
  }

  private onEvent = (event: MatrixEvent): void => {
    this.receiveTypedCommand(event);
    void this.receiveResult(event).catch(() => undefined);
  };

  /** A joined agent's answer to a typed model command triggers discovery again. */
  private receiveTypedCommand(event: MatrixEvent): void {
    const relation = event.getRelation();
    if (
      !this.active() ||
      event.getType() !== 'm.room.message' ||
      event.isRedacted() ||
      relation?.rel_type !== 'm.thread' ||
      !relation.event_id
    )
      return;
    const scope = this.scopes.get(JSON.stringify([event.getRoomId(), relation.event_id]));
    if (!scope?.listeners.size || scope.command) return;
    const content = event.getContent<Record<string, unknown>>();
    const { body } = content;
    const eventId = event.getId();
    const { typedCommands } = scope;
    if (eventId && typeof body === 'string' && /^[!/]model(\s|$)/i.test(body.trim())) {
      typedCommands.add(eventId);
      if (typedCommands.size > 4) {
        const [oldest] = typedCommands;
        if (oldest) typedCommands.delete(oldest);
      }
      return;
    }
    if (!typedCommands.size) return;
    const sender = event.getSender();
    if (!sender || !joinedModelCandidates(this.mx, scope.room).includes(sender)) return;
    let commandId: string | undefined;
    if (MODEL_RESULT in content) {
      const result = parseModelSelectionResult(content[MODEL_RESULT]);
      if (
        !result ||
        result.room_id !== scope.room.roomId ||
        result.thread_id !== relation.event_id ||
        result.runtime_user_id !== sender
      )
        return;
      commandId = result.command_event_id;
    } else if (!relation.is_falling_back) {
      commandId = event.replyEventId;
    }
    if (!commandId || !typedCommands.delete(commandId)) return;
    this.cancelQuery(scope);
    this.refresh(scope.room, scope.threadId);
  }

  private async receiveResult(event: MatrixEvent): Promise<void> {
    if (!this.active() || event.getType() !== 'm.room.message' || event.isRedacted()) return;
    const result = parseModelSelectionResult(event.getContent()[MODEL_RESULT]);
    if (
      !result ||
      !result.thread_id ||
      event.getRoomId() !== result.room_id ||
      event.getRelation()?.rel_type !== 'm.thread' ||
      event.getRelation()?.event_id !== result.thread_id
    )
      return;
    const scope = this.scopes.get(JSON.stringify([result.room_id, result.thread_id]));
    const command = scope?.command;
    if (
      !command ||
      !this.currentCommand(command) ||
      event.getSender() !== command.runtime.userId ||
      result.runtime_user_id !== command.runtime.userId ||
      result.runtime_device_id !== command.runtime.deviceId ||
      result.operation !== command.operation ||
      result.model !== commandModel(command)
    )
      return;
    const catalog = scope?.catalogs.get(command.runtime.id);
    if (
      !scope ||
      !catalog ||
      !hasJoinedModelAgent(this.mx, scope.room, command.runtime, catalog.response.agent_user_ids)
    )
      return;
    const encryptedRoom = !!scope.room.currentState.getStateEvents('m.room.encryption', '');
    if (encryptedRoom || event.isEncrypted()) {
      if (
        !event.isEncrypted() ||
        event.getSenderKey() !== command.runtime.curveKey ||
        !(await isCurrentModelRuntime(this.mx, command.runtime))
      )
        return;
    }
    if (!this.currentCommand(command)) return;
    if (!command.eventId) {
      if (command.early.length < 16) command.early.push(result);
      return;
    }
    this.applyResult(command, result);
  }

  private applyResult(command: Command, result: ModelSelectionResult): void {
    if (!this.currentCommand(command) || command.eventId !== result.command_event_id) return;
    const { scope } = command;
    clearTimeout(command.timer);
    command.acknowledged = true;
    scope.command = undefined;
    if (result.status === 'applied') {
      // The result echoes the command's reference; the selection keeps the key and the level apart.
      const override = command.model ?? null;
      const reasoning = command.level ?? null;
      const catalog = scope.catalogs.get(command.runtime.id);
      if (catalog)
        catalog.response = {
          ...catalog.response,
          selection: {
            override,
            ...(reasoning ? { reasoning } : {}),
            inherited: catalog.response.selection.inherited,
          },
        };
      this.publish(scope, { pending: !!scope.send, override, reasoning, error: undefined });
    } else {
      this.publish(scope, {
        pending: !!scope.send,
        error: result.error ?? 'Model selection rejected. Retry or use !model.',
      });
    }
  }

  private uncertain(command: Command): void {
    if (!this.currentCommand(command)) return;
    const { scope } = command;
    clearTimeout(command.timer);
    scope.command = undefined;
    scope.needsRefresh = true;
    this.publish(scope, {
      pending: !!scope.send,
      error: 'Model selection unconfirmed. Try again once the models reload.',
    });
    this.refresh(scope.room, scope.threadId);
  }

  /** Drops what the scope verified; `shown` keeps an old button up, unable to mutate, meanwhile. */
  private invalidate(scope: Scope, shown?: ModelPickerSnapshot, keepDraft = false): void {
    this.cancelQuery(scope);
    clearTimeout(scope.retry);
    scope.generation += 1;
    if (scope.command) clearTimeout(scope.command.timer);
    scope.command = undefined;
    scope.catalogs.clear();
    scope.kept = undefined;
    scope.needsRefresh = true;
    if (
      scope.draft &&
      (!keepDraft ||
        shown?.runtime?.id !== scope.draft.catalog.runtime.id ||
        !hasJoinedModelAgent(
          this.mx,
          scope.room,
          scope.draft.catalog.runtime,
          scope.draft.catalog.response.agent_user_ids
        ))
    )
      scope.draft = undefined;
    scope.snapshot = {
      ...emptySnapshot(),
      ...(shown && { ...shown, loading: true, error: undefined, canMutate: false }),
      ...(!scope.threadId && {
        override: scope.draft?.key ?? null,
        reasoning: scope.draft?.level ?? null,
      }),
      pending: !!scope.send,
    };
    this.notify(scope);
  }

  private onMembership = (_event: MatrixEvent, member: RoomMember): void => {
    if (!this.active()) return;
    // Missing roster entries during lazy hydration are not evidence that an agent left.
    const { roomId, userId, membership } = member;
    const { rooms, save } = this.roomCatalogs;
    const cached = rooms.get(roomId);
    if (cached && membership !== 'join') {
      const kept = cached.filter(
        ({ runtime, agentUserIds }) =>
          userId !== this.userId && userId !== runtime.userId && !agentUserIds.includes(userId)
      );
      if (kept.length !== cached.length) {
        if (kept.length) rooms.set(roomId, kept);
        else rooms.delete(roomId);
        save();
      }
    }
    this.scopes.forEach((scope) => {
      if (scope.room.roomId !== member.roomId) return;
      if (scope.query?.hydrating && !scope.catalogs.size) return;
      this.invalidateAndRefresh(scope, true);
    });
  };

  private onDevices = (users: string[]): void => {
    if (!this.active()) return;
    const { rooms, save } = this.roomCatalogs;
    const size = rooms.size;
    rooms.forEach((catalogs, roomId) => {
      if (catalogs.some((catalog) => users.includes(catalog.runtime.userId))) rooms.delete(roomId);
    });
    if (rooms.size !== size) save();
    this.scopes.forEach((scope) => {
      const catalogs = scope.catalogs.size ? scope.catalogs.values() : scope.kept ?? [];
      const known = [...catalogs]
        .map((c) => c.runtime)
        .concat(scope.query?.devices ?? [], scope.snapshot.runtimes);
      if (known.some((d) => users.includes(d.userId))) {
        const draftUser = scope.draft?.catalog.runtime.userId;
        this.invalidateAndRefresh(scope, false, !!draftUser && !users.includes(draftUser));
      } else if (
        this.waiting(scope) &&
        joinedModelCandidates(this.mx, scope.room).some((id) => users.includes(id))
      )
        // A candidate's keys arrived, possibly after a probe found none of its devices signed.
        this.refreshScope(scope);
    });
  };

  /** `keepUnshown`: a membership change, after which a thread no composer shows keeps its button. */
  private invalidateAndRefresh(scope: Scope, keepUnshown = false, keepDraft = keepUnshown): void {
    // Revalidate behind a shown button while its runtime and one of its agents stay joined, and
    // behind a button no composer shows while each of its runtimes and all their agents do.
    const shown = scope.listeners.size > 0;
    const verified =
      (scope.catalogs.size ? roomCatalogsOf(scope.catalogs.values()) : scope.kept) ?? [];
    const kept = verified.filter((catalog) =>
      hasJoinedModelAgent(this.mx, scope.room, catalog.runtime, catalog.agentUserIds)
    );
    const intact = verified.every((catalog) => everyAgentJoined(this.mx, scope.room, catalog));
    const keep = scope.snapshot.eligible && kept.length > 0 && (shown || (keepUnshown && intact));
    // A kept button never names an agent that left: the room default waits for discovery then.
    this.invalidate(
      scope,
      keep ? { ...scope.snapshot, ...(!intact && { inherited: [] }) } : undefined,
      keepDraft
    );
    if (keep) scope.kept = kept;
    if (scope.refreshScheduled || !scope.listeners.size) return;
    scope.refreshScheduled = true;
    void Promise.resolve().then(() => {
      scope.refreshScheduled = false;
      if (this.active() && scope.listeners.size) this.refreshScope(scope);
    });
  }

  /** A shown scope with no confirmed button, or with an error, that a wake-up asks again for. */
  private waiting(scope: Scope): boolean {
    return scope.listeners.size > 0 && (!scope.snapshot.eligible || !!scope.snapshot.error);
  }

  private wake(): void {
    if (!this.active()) return;
    this.scopes.forEach((scope) => {
      if (this.waiting(scope)) this.refreshScope(scope);
    });
  }

  private onSync = (state: SyncState, previous?: SyncState | null): void => {
    if (state === SyncState.Stopped) this.dispose();
    else if (state === SyncState.Syncing && previous !== SyncState.Syncing) this.wake();
  };

  private onVisibility = (): void => {
    if (document.visibilityState === 'visible') this.wake();
  };

  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    this.scopes.forEach((scope) => this.invalidate(scope));
    this.roomCatalogs = loadRoomCatalogs(null);
    this.mx.removeListener(ClientEvent.ReceivedToDeviceMessage, this.onResponse);
    this.mx.removeListener(ClientEvent.Event, this.onEvent);
    this.mx.removeListener(MatrixEventEvent.Decrypted, this.onEvent);
    this.mx.removeListener(RoomMemberEvent.Membership, this.onMembership);
    this.mx.removeListener(CryptoEvent.DevicesUpdated, this.onDevices);
    this.mx.removeListener(ClientEvent.Sync, this.onSync);
    if (typeof document !== 'undefined')
      document.removeEventListener('visibilitychange', this.onVisibility);
  };
}

export const getModelController = (mx: MatrixClient): ModelController => {
  let controller = controllers.get(mx);
  if (!controller) {
    controller = new ModelController(mx);
    controllers.set(mx, controller);
  }
  return controller;
};
export const disposeModelController = (mx: MatrixClient): void => controllers.get(mx)?.dispose();
