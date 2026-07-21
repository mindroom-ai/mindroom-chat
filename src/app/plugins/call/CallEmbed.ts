import {
  ClientEvent,
  KnownMembership,
  MatrixClient,
  MatrixEvent,
  MatrixEventEvent,
  Room,
  RoomStateEvent,
} from 'matrix-js-sdk';
import {
  ClientWidgetApi,
  IRoomEvent,
  IWidget,
  Widget,
  WidgetApiToWidgetAction,
} from 'matrix-widget-api';
import { CallWidgetDriver } from './CallWidgetDriver';
import { trimTrailingSlash } from '../../utils/common';
import {
  ElementCallIntent,
  ElementCallThemeKind,
  ElementMediaStateDetail,
  ElementWidgetActions,
} from './types';
import { CallControl } from './CallControl';
import { CallControlState } from './CallControlState';

export class CallEmbed {
  private mx: MatrixClient;

  public readonly call: ClientWidgetApi;

  public readonly iframe: HTMLIFrameElement;

  public readonly room: Room;

  public joined = false;

  public readonly control: CallControl;

  private readonly container: HTMLElement;

  private readonly callWidgetDriver: CallWidgetDriver;

  private readUpToMap: { [roomId: string]: string } = {}; // room ID to event ID

  private eventsToFeed = new WeakSet<MatrixEvent>();

  private readonly disposables: Array<() => void> = [];

  private disposed = false;

  // The exact listener references registered with the MatrixClient in
  // `start()`. `off` must receive these same references — a fresh `.bind()`
  // at removal time removes nothing and leaks the embed (and its event
  // decryption/forwarding) for the rest of the session.
  private boundOnEvent?: (ev: MatrixEvent) => void;

  private boundOnEventDecrypted?: (ev: MatrixEvent) => void;

  private boundOnStateUpdate?: (ev: MatrixEvent) => void;

  private boundOnToDeviceEvent?: (ev: MatrixEvent) => Promise<void>;

  static getIntent(dm: boolean, ongoing: boolean, video?: boolean): ElementCallIntent {
    if (dm && ongoing) {
      return video ? ElementCallIntent.JoinExistingDM : ElementCallIntent.JoinExistingDMVoice;
    }
    if (dm) {
      return video ? ElementCallIntent.StartCallDM : ElementCallIntent.StartCallDMVoice;
    }

    if (ongoing) {
      return video ? ElementCallIntent.JoinExisting : ElementCallIntent.JoinExistingVoice;
    }
    return video ? ElementCallIntent.StartCall : ElementCallIntent.StartCallVoice;
  }

  static dmCall(intent: ElementCallIntent): boolean {
    return (
      intent === ElementCallIntent.JoinExistingDM ||
      intent === ElementCallIntent.JoinExistingDMVoice ||
      intent === ElementCallIntent.StartCallDM ||
      intent === ElementCallIntent.StartCallDMVoice
    );
  }

  static startingCall(intent: ElementCallIntent): boolean {
    return (
      intent === ElementCallIntent.StartCallDM ||
      intent === ElementCallIntent.StartCallDMVoice ||
      intent === ElementCallIntent.StartCall ||
      intent === ElementCallIntent.StartCallVoice
    );
  }

  static getWidget(
    mx: MatrixClient,
    room: Room,
    intent: ElementCallIntent,
    themeKind: ElementCallThemeKind
  ): Widget {
    const userId = mx.getSafeUserId();
    const deviceId = mx.getDeviceId() ?? '';
    const clientOrigin = window.location.origin;
    const widgetId = 'call-embed';

    const params = new URLSearchParams({
      widgetId,
      parentUrl: clientOrigin,
      baseUrl: mx.baseUrl,
      roomId: room.roomId,
      userId,
      deviceId,
      intent,

      skipLobby: 'true',
      confineToRoom: 'true',
      appPrompt: 'false',
      perParticipantE2EE: room.hasEncryptionStateEvent().toString(),
      lang: 'en-EN',
      theme: themeKind,
      header: 'none',
    });

    if (!room.isCallRoom() && CallEmbed.startingCall(intent)) {
      params.append('sendNotificationType', CallEmbed.dmCall(intent) ? 'ring' : 'notification');
    }

    const widgetUrl = new URL(
      `${trimTrailingSlash(import.meta.env.BASE_URL)}/public/element-call/index.html`,
      window.location.origin
    );
    widgetUrl.search = params.toString();

    const options: IWidget = {
      id: widgetId,
      creatorUserId: userId,
      name: 'Call',
      type: 'm.call',
      url: widgetUrl.href,
      waitForIframeLoad: false,
      data: {},
    };

    const widget: Widget = new Widget(options);

    return widget;
  }

  static getIframe(url: string): HTMLIFrameElement {
    const iframe = document.createElement('iframe');

    iframe.title = 'Call Embed';
    iframe.setAttribute(
      'sandbox',
      'allow-forms allow-scripts allow-same-origin allow-popups allow-modals allow-downloads'
    );
    iframe.allow = 'microphone; camera; display-capture; autoplay; clipboard-write;';
    iframe.src = url;

    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.style.position = 'relative';
    iframe.style.zIndex = '1';
    iframe.style.backgroundColor = 'transparent';

    return iframe;
  }

  constructor(
    mx: MatrixClient,
    room: Room,
    widget: Widget,
    container: HTMLElement,
    initialControlState?: CallControlState
  ) {
    const iframe = CallEmbed.getIframe(
      widget.getCompleteUrl({ currentUserId: mx.getSafeUserId() })
    );
    container.append(iframe);

    const callWidgetDriver = new CallWidgetDriver(mx, room.roomId);
    const call: ClientWidgetApi = new ClientWidgetApi(widget, iframe, callWidgetDriver);

    this.mx = mx;
    this.call = call;
    this.room = room;
    this.iframe = iframe;
    this.container = container;
    this.callWidgetDriver = callWidgetDriver;

    const controlState = initialControlState ?? new CallControlState(true, false, true);
    this.control = new CallControl(controlState, call, iframe);
    this.control.startObserving();
    iframe.onload = () => {
      this.control.startObserving();
    };

    let initialMediaEvent = true;
    this.disposables.push(
      this.listenAction<ElementMediaStateDetail>(ElementWidgetActions.DeviceMute, (evt) => {
        if (initialMediaEvent) {
          initialMediaEvent = false;
          this.control.applyState();
          return;
        }
        this.control.onMediaState(evt);
      })
    );

    this.start();
  }

  get roomId(): string {
    return this.room.roomId;
  }

  /**
   * The Matrix client this embed was constructed over. Exposed so the
   * embed's cleanup owner — created by the `callEmbedAtom` setter, outside
   * any React context — can run its network cleanup against the same client.
   */
  get client(): MatrixClient {
    return this.mx;
  }

  get document(): Document | undefined {
    return this.iframe.contentDocument ?? this.iframe.contentWindow?.document;
  }

  public setTheme(theme: ElementCallThemeKind) {
    return this.call.transport.send(WidgetApiToWidgetAction.ThemeChange, {
      name: theme,
    });
  }

  public hangup() {
    return this.call.transport.send(ElementWidgetActions.HangupCall, {});
  }

  public onPreparing(callback: () => void) {
    return this.listenEvent('preparing', callback);
  }

  public onPreparingError(callback: (error: any) => void) {
    return this.listenEvent('error:preparing', callback);
  }

  public onReady(callback: () => void) {
    return this.listenEvent('ready', callback);
  }

  public onCapabilitiesNotified(callback: () => void) {
    return this.listenEvent('capabilitiesNotified', callback);
  }

  private start() {
    // Room widgets get locked to the room they were added in
    this.call.setViewedRoomId(this.roomId);
    this.disposables.push(
      this.listenAction(ElementWidgetActions.JoinCall, this.onCallJoined.bind(this))
    );

    // Populate the map of "read up to" events for this widget with the current event in every room.
    // This is a bit inefficient, but should be okay. We do this for all rooms in case the widget
    // requests timeline capabilities in other rooms down the road. It's just easier to manage here.
    this.mx.getRooms().forEach((room) => {
      // Timelines are most recent last
      const events = room.getLiveTimeline()?.getEvents() || [];
      const roomEvent = events[events.length - 1];
      if (!roomEvent) return; // force later code to think the room is fresh
      this.readUpToMap[room.roomId] = roomEvent.getId()!;
    });

    // Attach listeners for feeding events - the underlying widget classes handle permissions for us
    this.boundOnEvent = this.onEvent.bind(this);
    this.boundOnEventDecrypted = this.onEventDecrypted.bind(this);
    this.boundOnStateUpdate = this.onStateUpdate.bind(this);
    this.boundOnToDeviceEvent = this.onToDeviceEvent.bind(this);
    this.mx.on(ClientEvent.Event, this.boundOnEvent);
    this.mx.on(MatrixEventEvent.Decrypted, this.boundOnEventDecrypted);
    this.mx.on(RoomStateEvent.Events, this.boundOnStateUpdate);
    this.mx.on(ClientEvent.ToDeviceEvent, this.boundOnToDeviceEvent);
  }

  /**
   * Tears down widget messaging, the iframe (and with it any live media),
   * controls and listeners. Idempotent, and each step is attempted
   * independently: the caller drops its only reference right after this
   * returns, so one throwing step must not leave a live iframe or media
   * session running unreachably behind a UI that reports no active call.
   */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    const attempt = (step: string, run: () => void): void => {
      try {
        run();
      } catch (error) {
        console.warn(`[call-embed] ${step} failed during dispose`, error);
      }
    };

    this.disposables.forEach((disposable) => {
      attempt('widget listener removal', disposable);
    });
    attempt('widget driver disposal', () => this.callWidgetDriver.dispose());
    attempt('widget transport stop', () => this.call.stop());
    attempt('iframe load handler removal', () => {
      this.iframe.onload = null;
    });
    attempt('iframe removal', () => this.container.removeChild(this.iframe));
    attempt('call control disposal', () => this.control.dispose());

    // Remove exactly the references registered in start(), each attempted
    // independently so one throwing removal cannot leak the other three.
    const { boundOnEvent, boundOnEventDecrypted, boundOnStateUpdate, boundOnToDeviceEvent } = this;
    if (boundOnEvent) {
      attempt('client Event listener removal', () => this.mx.off(ClientEvent.Event, boundOnEvent));
    }
    if (boundOnEventDecrypted) {
      attempt('client Decrypted listener removal', () =>
        this.mx.off(MatrixEventEvent.Decrypted, boundOnEventDecrypted)
      );
    }
    if (boundOnStateUpdate) {
      attempt('client RoomState listener removal', () =>
        this.mx.off(RoomStateEvent.Events, boundOnStateUpdate)
      );
    }
    if (boundOnToDeviceEvent) {
      attempt('client ToDeviceEvent listener removal', () =>
        this.mx.off(ClientEvent.ToDeviceEvent, boundOnToDeviceEvent)
      );
    }

    // Clear internal state
    this.readUpToMap = {};
    this.eventsToFeed = new WeakSet<MatrixEvent>();
  }

  private onCallJoined(): void {
    this.joined = true;
  }

  private onEvent(ev: MatrixEvent): void {
    this.mx.decryptEventIfNeeded(ev);
    this.feedEvent(ev);
  }

  private onEventDecrypted(ev: MatrixEvent): void {
    this.feedEvent(ev);
  }

  private onStateUpdate(ev: MatrixEvent): void {
    if (this.call === null) return;
    const raw = ev.getEffectiveEvent();
    this.call.feedStateUpdate(raw as IRoomEvent).catch((e) => {
      console.error('Error sending state update to widget: ', e);
    });
  }

  private async onToDeviceEvent(ev: MatrixEvent): Promise<void> {
    // The emitter never consumes an async listener's promise, so every
    // rejection here would surface as an unhandled rejection.
    try {
      await this.mx.decryptEventIfNeeded(ev);
      // The decryption await can resume after dispose() stopped the widget
      // transport; feeding it then would only produce a rejection.
      if (this.disposed) return;
      if (ev.isDecryptionFailure()) return;
      await this.call?.feedToDevice(ev.getEffectiveEvent() as IRoomEvent, ev.isEncrypted());
    } catch (e) {
      if (!this.disposed) console.error('Error sending to-device event to widget: ', e);
    }
  }

  /**
   * Determines whether the event has a relation to an unknown parent.
   */
  private relatesToUnknown(ev: MatrixEvent): boolean {
    // Replies to unknown events don't count
    if (!ev.relationEventId || ev.replyEventId) return false;
    const room = this.mx.getRoom(ev.getRoomId());
    return room === null || !room.findEventById(ev.relationEventId);
  }

  /**
   * Advances the "read up to" marker for a room to a certain event. No-ops if
   * the event is before the marker.
   * @returns Whether the "read up to" marker was advanced.
   */
  private advanceReadUpToMarker(ev: MatrixEvent): boolean {
    const evId = ev.getId();
    if (evId === undefined) return false;
    const roomId = ev.getRoomId();
    if (roomId === undefined) return false;
    const room = this.mx.getRoom(roomId);
    if (room === null) return false;

    const upToEventId = this.readUpToMap[ev.getRoomId()!];
    if (!upToEventId) {
      // There's no marker yet; start it at this event
      this.readUpToMap[roomId] = evId;
      return true;
    }

    // Small optimization for exact match (skip the search)
    if (upToEventId === evId) return false;

    // Timelines are most recent last, so reverse the order and limit ourselves to 100 events
    // to avoid overusing the CPU.
    const timeline = room.getLiveTimeline();
    const events = [...timeline.getEvents()].reverse().slice(0, 100);
    function isRelevantTimelineEvent(timelineEvent: MatrixEvent): boolean {
      return timelineEvent.getId() === upToEventId || timelineEvent.getId() === ev.getId();
    }
    const possibleMarkerEv = events.find(isRelevantTimelineEvent);
    if (possibleMarkerEv?.getId() === upToEventId) {
      // The event must be somewhere before the "read up to" marker
      return false;
    }
    if (possibleMarkerEv?.getId() === ev.getId()) {
      // The event is after the marker; advance it
      this.readUpToMap[roomId] = evId;
      return true;
    }

    // We can't say for sure whether the widget has seen the event; let's
    // just assume that it has
    return false;
  }

  /**
   * Determines whether the event comes from a room that we've been invited to
   * (in which case we likely don't have the full timeline).
   */
  private isFromInvite(ev: MatrixEvent): boolean {
    const room = this.mx.getRoom(ev.getRoomId());
    return room?.getMyMembership() === KnownMembership.Invite;
  }

  private feedEvent(ev: MatrixEvent): void {
    if (this.call === null) return;
    if (
      // If we had decided earlier to feed this event to the widget, but
      // it just wasn't ready, give it another try
      this.eventsToFeed.delete(ev) ||
      // Skip marker timeline check for events with relations to unknown parent because these
      // events are not added to the timeline here and will be ignored otherwise:
      // https://github.com/matrix-org/matrix-js-sdk/blob/d3dfcd924201d71b434af3d77343b5229b6ed75e/src/models/room.ts#L2207-L2213
      this.relatesToUnknown(ev) ||
      // Skip marker timeline check for rooms where membership is
      // 'invite', otherwise the membership event from the invitation room
      // will advance the marker and new state events will not be
      // forwarded to the widget.
      this.isFromInvite(ev) ||
      // Check whether this event would be before or after our "read up to" marker. If it's
      // before, or we can't decide, then we assume the widget will have already seen the event.
      // If the event is after, or we don't have a marker for the room,
      // then the marker will advance and we'll send it through.
      // This approach of "read up to" prevents widgets receiving decryption spam from startup or
      // receiving ancient events from backfill and such.
      this.advanceReadUpToMarker(ev)
    ) {
      // If the event is still being decrypted, remember that we want to
      // feed it to the widget (even if not strictly in the order given by
      // the timeline) and get back to it later
      if (ev.isBeingDecrypted() || ev.isDecryptionFailure()) {
        this.eventsToFeed.add(ev);
      } else {
        const raw = ev.getEffectiveEvent();
        this.call.feedEvent(raw as IRoomEvent).catch((e) => {
          console.error('Error sending event to widget: ', e);
        });
      }
    }
  }

  public listenAction<T>(type: string, callback: (event: CustomEvent<T>) => void) {
    return this.listenEvent(`action:${type}`, callback);
  }

  public listenEvent<T>(type: string, callback: (event: T) => void) {
    this.call.on(type, callback);
    return () => {
      this.call.off(type, callback);
    };
  }
}
