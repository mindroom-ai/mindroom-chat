import {
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useSetAtom, useStore } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { MatrixEvent } from 'matrix-js-sdk';
import { Box, Button, Text } from 'folds';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useRoom } from '../matrix/hooks/useRoom';
import { useRoomMembers } from '../matrix/hooks/useRoomMembers';
import { usePowerLevels, PowerLevelsContextProvider } from '../matrix/hooks/usePowerLevels';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { useInert } from '../lib/hooks/useInert';
import { useClientConfig } from '../config/useClientConfig';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import { useSetting } from '../preferences/useSetting';
import { settingsAtom } from '../preferences/settings';
import { settingsModalAtom } from '../navigation/settingsModal';
import { conversationBehindPanelAtom } from '../navigation/conversationCover';
import { MembersDrawer } from '../members/MembersDrawer';
import { hasActiveMindroomAgent, isMindroomAgentUserId } from '../matrix/protocol/agentIdentity';
import { useMembersDrawer } from '../members/useMembersDrawer';
import { ResizableMembersPanel } from '../members/ResizableMembersPanel';
import { PanelRow, useMembersOverlay } from '../members/PanelRow';
import { CONVERSATION_MIN_WIDTH, ResizablePanel } from '../ui/panels/ResizablePanel';
import { usePanelSlot } from '../ui/panels/panelPresence';
import { type PanelFrame, PanelFrameProvider } from '../ui/panels/PanelFrame';
import { type RoomPanel, useRoomPanels } from '../ui/panels/roomPanels';
import { registeredPlugins } from '../plugins/registry';
import {
  type PluginPanelControls,
  PluginPanelControlsContext,
  enabledSidePanels,
} from '../plugins/sidePanels';
import { usePluginHeaderActions } from '../plugins/headerActions';
import { ComputerPanel } from '../computer/ComputerPanel';
import type { ComputerAgent } from '../computer/types';
import { useComputerApiUrl } from '../computer/useComputerApiUrl';
import { useRoomComputerState } from '../computer/useRoomComputerState';
import { useBindsOpenIdTokens, useRoomAgentServers } from '../computer/useAgentServers';
import { RoomCanvasPanel } from '../canvas/RoomCanvasPanel';
import {
  useComputerShown,
  useConversationCanvases,
  useOpenCanvasById,
} from '../canvas/canvasIndex';
import { useCanvasOpenRequest } from '../canvas/useCanvasOpenRequest';
import { ChatUiActionContext, useChatUiActions } from '../ui-actions/ChatUiActionProvider';
import type { ChatUiAction } from '../matrix/protocol/chatUiProtocol';
import type { RoomViewHeaderProps } from './RoomViewHeader';
import { RoomView } from './RoomView';
import { isThreadRouteReady } from '../event-store/threads/threadRouteUtils';
import { useRoomEscapeReadReceipts } from './useRoomEscapeReadReceipts';
import { useRoomThreadRouteGuards } from '../threads/useRoomThreadRouteGuards';
import { useRoomViewMode } from '../navigation/useRoomViewMode';
import { useThreadRootEvent } from '../threads/useThreadRootEvent';
import { useInitializeOpenThread } from '../threads/useInitializeOpenThread';
import { RoomMessageAnnouncer } from '../timeline/RoomMessageAnnouncer';
import {
  isActiveCallShownIn,
  useActiveCall,
  useCallActions,
  useCallPanel,
  useInCall,
} from '../calls/callStore';
import type { CallPanel as CallPanelComponent } from '../calls/CallPanel';
import { transcriptPanelAtom, useTranscriptPanel } from '../calls/transcription/transcriptPanel';
import { type PartLoadRetry, lazyPart } from '../lib/lazyPart';
import { PartUnavailable } from '../ui/PartUnavailable';
import { PluginSidePanel } from './PluginSidePanel';
import { usePluginPanel } from './usePluginPanel';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import { useAlive } from '../lib/hooks/useAlive';

/** The computer opens wide enough for a desktop screen beside the conversation. */
const COMPUTER_DEFAULT_WIDTH = 672;
const COMPUTER_MAX_WIDTH = 1600;
/**
 * Without its chunk (offline when the panel is first needed) the call panel says so and offers
 * Retry. A call already on in this room gets End too, as the panel's own End did not load and Retry
 * may not reload.
 */
function CallPanelUnavailable({
  room,
  onClose,
  retryLoad,
}: ComponentProps<typeof CallPanelComponent> & PartLoadRetry) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const { endCall } = useCallActions(mx);
  const callHere = isActiveCallShownIn(useActiveCall(), room.roomId);
  return (
    <PartUnavailable retryLoad={retryLoad}>
      {callHere && (
        <Button
          type="button"
          size="300"
          radii="300"
          variant="Critical"
          fill="Soft"
          onClick={() => {
            // The call is over for this device either way; a failed leave leaves nothing to do.
            endCall().catch(() => undefined);
          }}
        >
          <Text size="B300">{t('featureUi.call.callControls.end')}</Text>
        </Button>
      )}
      <Button
        type="button"
        size="300"
        radii="300"
        variant="Secondary"
        fill="None"
        onClick={onClose}
      >
        <Text size="B300">{t('featureUi.calls.panel.dismiss')}</Text>
      </Button>
    </PartUnavailable>
  );
}

// Calls load on first use, so rooms without one never load them.
const CallPanel = lazyPart(
  () => import('../calls/CallPanel').then((module) => ({ default: module.CallPanel })),
  CallPanelUnavailable
);
const LiveTranscriptPanel = lazyPart(
  () =>
    import('../calls/transcription/LiveTranscriptPanel').then((module) => ({
      default: module.LiveTranscriptPanel,
    })),
  CallPanelUnavailable
);
const HeaderCallButtons = lazyPart(() =>
  import('../calls/HeaderCallButtons').then((module) => ({ default: module.HeaderCallButtons }))
);
const HeaderCallMenuEntries = lazyPart(() =>
  import('../calls/HeaderCallButtons').then((module) => ({
    default: module.HeaderCallMenuEntries,
  }))
);

/** The call panel fits two tiles side by side; wider, it fits more. A plugin's panel opens as wide. */
const CALL_DEFAULT_WIDTH = 400;
const CALL_MAX_WIDTH = 1200;
/** The live transcript is read like a conversation, no wider than a readable line or two. */
const TRANSCRIPT_MAX_WIDTH = 800;

const CONVERSATION_STYLE: CSSProperties = { minWidth: 0 };
// Behind a side panel in its place, the conversation takes no room in the row but stays as it was
// laid out, its scroll position too (`content-visibility`); a browser without that lays it out with
// no width, clipped.
const HIDDEN_CONVERSATION_STYLE: CSSProperties = {
  ...CONVERSATION_STYLE,
  flex: '0 0 0',
  overflow: 'hidden',
  contentVisibility: 'hidden',
};

/** A canvas on screen and the conversation it was opened in. */
type ShownCanvas = { event: MatrixEvent; conversation: string };

/**
 * A side panel of the room: its name on its frame (a panel without one has no frame), whether it
 * takes the conversation's place, and what it shows.
 */
type PanelEntry = RoomPanel & {
  label?: string;
  covers: boolean;
  render: () => ReactNode;
  /** Opens it in its own state, for the header's toggle; panels opened otherwise have none. */
  show?: () => void;
};

/** The computer agents of the room and the server each one runs on. */
const useRoomComputer = (
  members: ReturnType<typeof useRoomMembers>,
  roomServers: ReturnType<typeof useRoomAgentServers>,
  myUserId: string
) => {
  const bindsOpenIdTokens = useBindsOpenIdTokens();
  const publishedComputer = bindsOpenIdTokens
    ? roomServers.find((server) => server.computer)?.apiUrl
    : undefined;
  const configuredApiUrl = useComputerApiUrl();
  const discoveredApiUrl = useComputerApiUrl(publishedComputer);
  const apiUrl = configuredApiUrl ?? discoveredApiUrl;

  const agents = useMemo<ComputerAgent[]>(() => {
    // With no server to reach, as when the user turned computers off, no agent's computer opens.
    if (!apiUrl) return [];
    const joinedAgents = members.filter(
      (member) =>
        member.membership === 'join' &&
        member.userId !== myUserId &&
        isMindroomAgentUserId(member.userId)
    );
    return joinedAgents.flatMap((member) => {
      const published = roomServers.find((server) => server.agentUserId === member.userId);
      const name = (member as { name?: string }).name ?? member.userId;
      if (configuredApiUrl) {
        // A configured server serves every agent but the ones whose MindRoom says it has none.
        return published && !published.computer ? [] : [{ userId: member.userId, name }];
      }
      if (!bindsOpenIdTokens || !published?.computer) return [];
      return [{ userId: member.userId, name, serverUrl: published.apiUrl }];
    });
  }, [apiUrl, bindsOpenIdTokens, configuredApiUrl, members, myUserId, roomServers]);

  return { agents, apiUrl: agents.length > 0 ? apiUrl : undefined };
};

/** What the room's URL asks for: an event, a thread, and whether to show the event in place. */
const useRoomRoute = () => {
  const params = useParams();
  const [search] = useSearchParams();
  return {
    eventId: params.eventId,
    routedThreadId: search.get('threadId') ?? undefined,
    focusEventInRoom: search.get('focusEvent') === '1',
  };
};

/**
 * A room: its view, and beside it one side panel at a time (an agent's computer, a canvas, the
 * call, the members, or a plugin's panel). The room also carries out the UI requests agents send
 * (`io.mindroom.ui_action`).
 */
export function Room() {
  return (
    <PanelRow>
      <RoomContent />
    </PanelRow>
  );
}

function RoomContent() {
  const room = useRoom();
  const { eventId, routedThreadId, focusEventInRoom } = useRoomRoute();
  const { roomId } = room;
  const client = useMatrixClient();
  const ownUserId = client.getSafeUserId();
  const mobile = useScreenSizeContext() === ScreenSize.Mobile;
  const { t } = useTranslation();
  const members = useRoomMembers(client, roomId);
  const clientConfig = useClientConfig();
  const [membersOpen, setMembersOpen] = useMembersDrawer();
  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
  const hasMindroomAgents = useMemo(() => hasActiveMindroomAgent(members), [members]);
  const {
    viewMode: chosenViewMode,
    setViewMode,
    availableViewModes,
  } = useRoomViewMode(roomId, hasMindroomAgents);
  // The Full view shows no thread routes, so a link to a thread brings the threads back, as an
  // action from a thread does. A direct chat between people always shows Threads.
  const threadLinkInFullView =
    !!routedThreadId && chosenViewMode === 'classic' && !!availableViewModes?.includes('threaded');
  const viewMode = threadLinkInFullView ? 'threaded' : chosenViewMode;
  useEffect(() => {
    if (threadLinkInFullView) setViewMode('threaded');
  }, [setViewMode, threadLinkInFullView]);
  const { navigateRoom, navigateRoomThread } = useRoomNavigate();
  const setSettingsModal = useSetAtom(settingsModalAtom);

  // The URL may name a reply; panels and agent requests belong to the thread's root.
  const threadId = useThreadRootEvent(room, routedThreadId);
  useInitializeOpenThread(room, threadId);
  const routeReady = isThreadRouteReady(room, routedThreadId);
  const conversation = `${roomId}\n${routedThreadId ?? ''}`;

  const joinRequestCount = useMemo(
    () => members.filter((member) => member.membership === 'knock').length,
    [members]
  );

  const roomServers = useRoomAgentServers(room);
  const computerTarget = useRoomComputer(members, roomServers, ownUserId);
  const computer = useRoomComputerState({
    mx: client,
    roomId,
    threadId: routedThreadId,
    available: !!computerTarget.apiUrl,
    apiUrl: computerTarget.apiUrl,
  });
  const {
    close: closeComputer,
    toggle: toggleComputer,
    show: showComputer,
    reportInteraction,
  } = computer;
  const computerOpen = computer.open && !!computerTarget.apiUrl;
  const computerShown = useComputerShown(client, roomId, threadId);

  const canvasEnabled = clientConfig.mindroom?.canvas?.enabled === true;
  const conversationCanvases = useConversationCanvases(client, roomId, threadId);
  const [shownCanvas, setShownCanvas] = useState<ShownCanvas>();
  // A canvas belongs to the conversation it opened in; another route shows none.
  const canvas =
    canvasEnabled && shownCanvas?.conversation === conversation ? shownCanvas : undefined;
  const openCanvasId = canvas?.event.getId() ?? undefined;
  const closeCanvas = useCallback(() => setShownCanvas(undefined), []);

  // A canvas does not open while this device is in a call (PANEL-09).
  const [callOpen, setCallOpen] = useCallPanel(roomId);
  const inCall = useInCall();
  const transcript = useTranscriptPanel(roomId);

  const pluginPanels = useMemo(
    () => enabledSidePanels(registeredPlugins, clientConfig),
    [clientConfig]
  );
  const pluginActions = usePluginHeaderActions(registeredPlugins, clientConfig);
  // A plugin's panel belongs to the room it opened in. Over the page the members go away with the
  // navigation that shows a room, so they keep no remembered panel from opening again there.
  const membersOverPage = useMembersOverlay() || mobile;
  const {
    here: pluginPanel,
    show: showPluginPanel,
    close: closePluginPanel,
  } = usePluginPanel(
    roomId,
    pluginPanels,
    computerOpen || !!canvas || callOpen || transcript.open || (membersOpen && !membersOverPage)
  );

  const closeCall = () => setCallOpen(false);
  const closeMembers = () => setMembersOpen(false);

  // One side panel at a time (useRoomPanels), the first open one of these. Opening one closes the
  // others, except that the members stay open behind the call or its live transcript and show
  // again when it closes. The computer and a canvas have their own Expand, which fills the room as
  // their frame's Fill does.
  const panels: PanelEntry[] = [
    {
      id: 'computer',
      open: computerOpen,
      close: closeComputer,
      label: t('mindroomUi.computer.title'),
      covers: mobile,
      render: () =>
        computerTarget.apiUrl && (
          <ResizablePanel
            side="end"
            storageKey={`mindroom.computer.width:${ownUserId}`}
            defaultWidth={COMPUTER_DEFAULT_WIDTH}
            minContentWidth={CONVERSATION_MIN_WIDTH}
            maxPanelWidth={COMPUTER_MAX_WIDTH}
            passthrough={mobile}
            resizeLabel={t('mindroomUi.computer.resize')}
            collapseLabel={t('mindroomUi.computer.close')}
            onCollapse={closeComputer}
            testId="resizable-computer-panel"
          >
            <ComputerPanel
              agents={computerTarget.agents}
              apiUrl={computerTarget.apiUrl}
              mx={client}
              roomId={roomId}
              threadId={threadId}
              continuationReady={routeReady}
              requestedAgent={computer.requestedAgent}
              onInteractionChange={reportInteraction}
              onClose={closeComputer}
              expanded={layout === 'filled'}
              onToggleExpanded={mobile ? undefined : () => toggleFilled('computer')}
            />
          </ResizablePanel>
        ),
    },
    {
      id: 'canvas',
      open: !!canvas,
      close: closeCanvas,
      label: t('mindroomUi.canvases.canvas'),
      covers: mobile,
      render: () =>
        canvas && (
          <RoomCanvasPanel
            mx={client}
            room={room}
            event={canvas.event}
            onClose={closeCanvas}
            expanded={layout === 'filled'}
            onToggleExpanded={() => toggleFilled('canvas')}
            libraries={clientConfig.mindroom?.canvas?.libraries === true}
          />
        ),
    },
    {
      id: 'call',
      open: callOpen,
      close: closeCall,
      // The call buttons, a ring and a call started elsewhere open it in the call store.
      opensElsewhere: true,
      label: t('featureUi.calls.panel.title'),
      covers: mobile,
      render: () => (
        <ResizablePanel
          side="end"
          storageKey={`mindroom.call.width:${ownUserId}`}
          defaultWidth={CALL_DEFAULT_WIDTH}
          minContentWidth={CONVERSATION_MIN_WIDTH}
          maxPanelWidth={CALL_MAX_WIDTH}
          passthrough={mobile}
          resizeLabel={t('featureUi.calls.panel.resize')}
          collapseLabel={t('featureUi.calls.panel.close')}
          onCollapse={closeCall}
          testId="resizable-call-panel"
        >
          <Suspense fallback={null}>
            <CallPanel room={room} onClose={closeCall} />
          </Suspense>
        </ResizablePanel>
      ),
    },
    {
      id: 'transcript',
      open: transcript.open,
      // Another panel takes its place for good; its own close brings back the call panel it
      // replaced (transcriptPanel.ts).
      close: transcript.dismiss,
      // The call controls and the call row open it in the call store.
      opensElsewhere: true,
      label: t('featureUi.calls.transcription.liveTranscript'),
      covers: mobile,
      render: () => (
        <ResizablePanel
          side="end"
          storageKey={`mindroom.callTranscript.width:${ownUserId}`}
          defaultWidth={CALL_DEFAULT_WIDTH}
          minContentWidth={CONVERSATION_MIN_WIDTH}
          maxPanelWidth={TRANSCRIPT_MAX_WIDTH}
          passthrough={mobile}
          resizeLabel={t('featureUi.calls.transcription.resize')}
          collapseLabel={t('featureUi.calls.transcription.close')}
          onCollapse={transcript.close}
          testId="resizable-transcript-panel"
        >
          <Suspense fallback={null}>
            <LiveTranscriptPanel room={room} onClose={transcript.close} />
          </Suspense>
        </ResizablePanel>
      ),
    },
    ...pluginPanels.map(
      (panel): PanelEntry => ({
        id: panel.id,
        open: pluginPanel?.id === panel.id,
        close: closePluginPanel,
        show: () => showPluginPanel(panel.id),
        label: panel.label,
        covers: mobile,
        render: () => (
          <ResizablePanel
            side="end"
            storageKey={`mindroom.panel.width:${ownUserId}:${panel.id}`}
            defaultWidth={CALL_DEFAULT_WIDTH}
            minContentWidth={CONVERSATION_MIN_WIDTH}
            maxPanelWidth={CALL_MAX_WIDTH}
            passthrough={mobile}
            resizeLabel={t('mindroomUi.plugins.sidePanel.resize', { label: panel.label })}
            collapseLabel={t('mindroomUi.plugins.sidePanel.close', { label: panel.label })}
            onCollapse={closePluginPanel}
            testId="resizable-plugin-panel"
          >
            <PluginSidePanel
              panel={panel}
              roomId={roomId}
              request={pluginPanel?.request}
              onClose={closePluginPanel}
            />
          </ResizablePanel>
        ),
      })
    ),
    {
      id: 'members',
      open: membersOpen,
      close: closeMembers,
      show: () => setMembersOpen(true),
      yieldsTo: ['call', 'transcript'],
      covers: false,
      render: () => (
        <ResizableMembersPanel onClose={closeMembers}>
          <MembersDrawer key={roomId} room={room} members={members} />
        </ResizableMembersPanel>
      ),
    },
  ];
  const { shown, layout, setLayout, request } = useRoomPanels(roomId, panels);
  // Transcript, in the call's controls or on its row, asks for the panel as the room's own buttons
  // ask for theirs, also while it shows: folded, it unfolds.
  const store = useStore();
  useEffect(
    () =>
      store.sub(transcriptPanelAtom, () => {
        if (store.get(transcriptPanelAtom)?.roomId === roomId)
          request('transcript', () => undefined);
      }),
    [request, roomId, store]
  );
  // Beside the conversation the shown panel has a frame, which fills the room with it or folds it
  // to a tab at the room's edge. Phones show the panel over the conversation, with no frame; the
  // members, a list their header button already shows and hides, have none either.
  const frame: PanelFrame | undefined =
    !mobile && shown?.label !== undefined
      ? { label: shown.label, layout, setLayout: (next) => setLayout(shown.id, next) }
      : undefined;
  const folded = layout === 'folded';
  function toggleFilled(id: string) {
    setLayout(id, layout === 'filled' ? 'beside' : 'filled');
  }
  // What a plugin's code may do with its panels here (useRoomSidePanel). It may call long after it
  // got these, once a save ends, say: they act on the room and the panel shown then, and not at all
  // once this page has gone.
  const shownId = shown?.id;
  const now = useLatestRef({ roomId, shownId, threadId, mobile });
  const alive = useAlive();
  // `open` and `close` keep their identity while the room shows, so plugin code that depends on them
  // does not run again when another panel shows.
  const openPluginPanel = useCallback<PluginPanelControls['open']>(
    (id, panelRequest) => {
      if (
        alive() &&
        now.current.roomId === roomId &&
        pluginPanels.some((panel) => panel.id === id)
      ) {
        request(id, () => showPluginPanel(id, panelRequest));
      }
    },
    [alive, now, pluginPanels, request, roomId, showPluginPanel]
  );
  // The thread shown whose one call to open a plugin's panel beside it came; it gets another once
  // another thread or the room's own timeline has shown.
  const calledBeside = useRef<string>();
  useEffect(() => {
    if (calledBeside.current !== threadId) calledBeside.current = undefined;
  }, [threadId]);
  const openPluginPanelBesideThread = useCallback<PluginPanelControls['openBesideThread']>(
    (id, besideThread, panelRequest) => {
      const { shownId: shownNow, threadId: threadNow, mobile: phone } = now.current;
      // A thread's ID names it in one room only, so a call from a room no longer shown does nothing.
      if (
        !alive() ||
        threadNow !== besideThread ||
        calledBeside.current === besideThread ||
        !pluginPanels.some((panel) => panel.id === id)
      ) {
        return;
      }
      calledBeside.current = besideThread;
      if (phone) return;
      // Shown already, folded or filling the room, it stays so.
      if (shownNow === id) showPluginPanel(id, panelRequest);
      else if (shownNow === undefined) request(id, () => showPluginPanel(id, panelRequest));
    },
    [alive, now, pluginPanels, request, showPluginPanel]
  );
  const closeShownPluginPanel = useCallback<PluginPanelControls['close']>(
    (id) => {
      if (alive() && now.current.roomId === roomId && now.current.shownId === id) {
        closePluginPanel();
      }
    },
    [alive, closePluginPanel, now, roomId]
  );
  const pluginPanelControls = useMemo<PluginPanelControls>(
    () => ({
      shown: shownId,
      open: openPluginPanel,
      openBesideThread: openPluginPanelBesideThread,
      close: closeShownPluginPanel,
    }),
    [closeShownPluginPanel, openPluginPanel, openPluginPanelBesideThread, shownId]
  );

  const showCanvas = useCallback(
    (event: MatrixEvent, filled = false) =>
      request('canvas', () => {
        setShownCanvas({ event, conversation });
        setLayout('canvas', filled ? 'filled' : 'beside');
      }),
    [conversation, request, setLayout]
  );
  const onComputerToggle = useCallback(() => {
    if (computer.open) toggleComputer();
    else request('computer', toggleComputer);
  }, [computer.open, request, toggleComputer]);
  /**
   * The header's toggle of a panel it opens by itself, the members or a plugin's: folded, the
   * panel unfolds as its tab unfolds it, with what it shows.
   */
  const onPanelToggle = (id: string) => {
    const panel = panels.find((candidate) => candidate.id === id);
    if (!panel?.show) return;
    if (shown?.id !== id) request(id, panel.show);
    else if (folded) setLayout(id, 'beside');
    else panel.close();
  };

  // While the person controls a computer, agents may not take the view away from it.
  const controlling = computerOpen && computer.interaction.locked;
  const controlledAgent = computer.interaction.agentUserId;
  const unavailable = useCallback(
    (action: ChatUiAction): string | undefined => {
      if (action.action === 'show_computer') {
        if (!computerTarget.agents.some((agent) => agent.userId === action.agentUserId)) {
          return t('mindroomUi.uiActions.computerUnavailable');
        }
        return controlling && controlledAgent && controlledAgent !== action.agentUserId
          ? t('mindroomUi.uiActions.releaseControl')
          : undefined;
      }
      if (action.action === 'show_canvas') {
        if (!canvasEnabled) return t('mindroomUi.uiActions.canvasDisabled');
        if (inCall) return t('mindroomUi.uiActions.canvasDuringCall');
      }
      return controlling ? t('mindroomUi.uiActions.releaseControl') : undefined;
    },
    [canvasEnabled, computerTarget.agents, controlledAgent, controlling, inCall, t]
  );

  const perform = useCallback(
    (action: ChatUiAction) => {
      switch (action.action) {
        case 'show_computer':
          request('computer', () => showComputer(action.agentUserId));
          break;
        case 'show_canvas':
          showCanvas(action.event);
          break;
        case 'open_panel':
          request('members', () => setMembersOpen(true));
          break;
        case 'open_settings':
          setSettingsModal({
            // The registry resolves the section, earlier page ids included, to its page.
            initialPage: action.section,
            requestId: action.eventId,
          });
          break;
        default:
      }
    },
    [request, setMembersOpen, setSettingsModal, showCanvas, showComputer]
  );

  // The Full view shows no thread routes, so an action from a thread brings the threads back.
  const showConversation = useCallback(
    (target: string | undefined) => {
      if (!target) {
        navigateRoom(roomId);
        return;
      }
      if (viewMode === 'classic') setViewMode('threaded');
      navigateRoomThread(roomId, target);
    },
    [navigateRoom, navigateRoomThread, roomId, setViewMode, viewMode]
  );

  const uiActions = useChatUiActions({
    mx: client,
    room,
    threadId,
    autoOpenFromHomeservers: clientConfig.mindroom?.uiActions?.autoOpenFromHomeservers,
    ready: routeReady,
    perform,
    navigate: showConversation,
    unavailable,
  });

  // A canvas chosen in the header may still load; any change of what the side panel shows
  // (or of the conversation) since then wins over its late answer.
  const panelContext = [
    conversation,
    openCanvasId ?? '',
    ...panels.filter((panel) => panel.open).map((panel) => panel.id),
  ].join('\n');
  const onCanvasOpen = useOpenCanvasById(client, room, panelContext, uiActions.activate);

  // The Canvases page opens its canvas across the whole room; during a call, the conversation shows
  // its request with the reason instead.
  const { read: readUiAction } = uiActions;
  const openRequestedCanvas = useCallback(
    (event: MatrixEvent) => {
      if (!inCall && readUiAction(event)?.action === 'show_canvas') showCanvas(event, true);
    },
    [inCall, readUiAction, showCanvas]
  );
  useCanvasOpenRequest(client, room, canvasEnabled, openRequestedCanvas);

  // On phones a panel covers the conversation; filling the room, it takes the conversation's place.
  // The conversation stays mounted under it, with its draft and a recording in progress, out of
  // reach and out of sight (conversationBehindPanelAtom), as under a plugin's cover.
  const behindPanel = !!shown?.covers || layout === 'filled';
  const conversationRef = useRef<HTMLDivElement>(null);
  useInert(conversationRef, behindPanel);
  const setBehindPanel = useSetAtom(conversationBehindPanelAtom);
  useLayoutEffect(() => {
    if (!behindPanel) return undefined;
    setBehindPanel(true);
    // Focus left in it, as in the composer when a click on Fill does not take the focus (Safari),
    // goes: a browser need not move it off an element that turns inert, and keys would reach it.
    const box = conversationRef.current;
    const focused = box?.ownerDocument.activeElement;
    if (focused && box?.contains(focused)) (focused as HTMLElement).blur();
    return () => setBehindPanel(false);
  }, [behindPanel, setBehindPanel]);

  const onThreadLoadError = useRoomThreadRouteGuards({
    eventId,
    roomId,
    threadId: routedThreadId,
    viewMode,
  });
  useRoomEscapeReadReceipts({ hideActivity, roomId, threadId });

  const powerLevels = usePowerLevels(room);
  // The header's side panel controls, whose state the room owns, and the plugins' actions.
  const headerPanels: RoomViewHeaderProps = {
    computerAvailable: !!computerTarget.apiUrl,
    computerOpen,
    computerShown,
    onComputerToggle,
    canvases: canvasEnabled && !inCall ? conversationCanvases : undefined,
    openCanvasId,
    onCanvasOpen,
    onCanvasClose: closeCanvas,
    shownPanel: folded ? undefined : shown?.id,
    onPanelToggle,
    pluginPanels,
    pluginActions,
    calls: (placement) => (
      <Suspense fallback={null}>
        {placement.at === 'menu' ? (
          <HeaderCallMenuEntries threadId={threadId} requestClose={placement.requestClose} />
        ) : (
          <HeaderCallButtons threadId={threadId} phone={placement.phone} />
        )}
      </Suspense>
    ),
  };

  // The panel shown, keyed by which it is: opening or closing one moves it in or out, and one
  // taking another's place changes width without closing first. It holds the plugin panel controls
  // of the room it shows in, so one still moving out after a room switch acts on no other room.
  const sidePanel = usePanelSlot(
    shown && (
      <PanelFrameProvider key={shown.id} value={frame}>
        <PluginPanelControlsContext.Provider value={pluginPanelControls}>
          {shown.render()}
        </PluginPanelControlsContext.Provider>
      </PanelFrameProvider>
    )
  );

  return (
    <PowerLevelsContextProvider value={powerLevels}>
      <ChatUiActionContext.Provider value={uiActions}>
        <PluginPanelControlsContext.Provider value={pluginPanelControls}>
          <Box
            ref={conversationRef}
            grow="Yes"
            direction="Column"
            style={behindPanel ? HIDDEN_CONVERSATION_STYLE : CONVERSATION_STYLE}
          >
            <RoomMessageAnnouncer room={room} threadId={routedThreadId} myUserId={ownUserId} />
            <RoomView
              room={room}
              eventId={eventId}
              threadId={routedThreadId}
              focusEventInRoom={focusEventInRoom}
              hasMindroomAgents={hasMindroomAgents}
              joinRequestCount={joinRequestCount}
              onThreadLoadError={onThreadLoadError}
              {...headerPanels}
            />
          </Box>
          {sidePanel}
        </PluginPanelControlsContext.Provider>
      </ChatUiActionContext.Provider>
    </PowerLevelsContextProvider>
  );
}
