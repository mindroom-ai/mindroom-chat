import {
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
import { flushSync } from 'react-dom';
import { NavigationType, useLocation, useNavigationType, useSearchParams } from 'react-router-dom';
import { useSetAtom, useStore } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { MatrixEvent } from 'matrix-js-sdk';
import { Box } from 'folds';
import { useJoinedRoom } from '../matrix/hooks/useJoinedRoom';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useRoom } from '../matrix/hooks/useRoom';
import { useRoomMembers } from '../matrix/hooks/useRoomMembers';
import { usePowerLevels, PowerLevelsContextProvider } from '../matrix/hooks/usePowerLevels';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { useInert } from '../lib/hooks/useInert';
import { canvasesEnabled } from '../config/canvases';
import { useClientConfig } from '../config/useClientConfig';
import { useRoomNavigate } from '../navigation/useRoomNavigate';
import { useSetting } from '../preferences/useSetting';
import { settingsAtom } from '../preferences/settings';
import { settingsModalAtom } from '../navigation/settingsModal';
import { bumpRecentRoom } from '../navigation/recentRooms';
import { conversationBehindPanelAtom } from '../navigation/conversationCover';
import {
  animateSwipeElements,
  type InteractiveSwipeScene,
  SWIPE_PRIORITY,
} from '../navigation/interactiveSwipe';
import { RoomPanelEdgeSwipeContext } from '../navigation/roomPanelEdgeSwipeContext';
import { useEdgeSwipeBack } from '../navigation/useEdgeSwipeBack';
import { useRoomRouteParams } from '../navigation/useRoomRouteParams';
import { MembersDrawer } from '../members/MembersDrawer';
import { ensureActiveRunsPowerLevel } from '../matrix/createRoom';
import { hasActiveMindroomAgent } from '../matrix/protocol/agentIdentity';
import { useMembersDrawer } from '../members/useMembersDrawer';
import { ResizableMembersPanel } from '../members/ResizableMembersPanel';
import { PanelRow, useMembersOverlay } from '../members/PanelRow';
import {
  CONVERSATION_MIN_WIDTH,
  ResizablePanel,
  SIDE_PANEL_MAX_WIDTH,
} from '../ui/panels/ResizablePanel';
import { layoutParentOf, usePanelSlot } from '../ui/panels/panelPresence';
import { type PanelFrame, PanelFrameProvider } from '../ui/panels/panelFrameContext';
import { type RoomPanel, useRoomPanels } from '../ui/panels/roomPanels';
import { usePluginClientConfig } from '../plugins/pluginConfig';
import { registeredPlugins } from '../plugins/registry';
import {
  type PluginPanelControls,
  PluginPanelControlsContext,
  usePluginSidePanels,
} from '../plugins/sidePanels';
import { usePluginHeaderActions } from '../plugins/headerActions';
import { ComputerPanel } from '../computer/ComputerPanel';
import { useRoomComputerState } from '../computer/useRoomComputerState';
import { useRoomAgentServers } from '../computer/useAgentServers';
import { useRoomComputer } from '../computer/useRoomComputer';
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
import {
  isConfirmedMatrixEventId,
  isThreadRouteReady,
} from '../event-store/threads/threadRouteUtils';
import { parseCrossRoomForkParams } from '../event-store/threads/threadFork';
import { isEventId } from '../lib/matrixIds';
import { useRoomEscapeReadReceipts } from './useRoomEscapeReadReceipts';
import { useRoomThreadRouteGuards } from '../threads/useRoomThreadRouteGuards';
import { useRoomViewMode } from '../navigation/useRoomViewMode';
import { isReturnToRoom } from '../routes/historyStack';
import { getRoomThreadExitTargetFromHistoryState } from '../routes/roomNavigateState';
import { useThreadRootEvent } from '../threads/useThreadRootEvent';
import { useInitializeOpenThread } from '../threads/useInitializeOpenThread';
import { RoomMessageAnnouncer } from '../timeline/RoomMessageAnnouncer';
import {
  callPanelRequestAtom,
  callPanelRoomAtom,
  useCallPanel,
  useInCall,
} from '../calls/callStore';
import { CallPanelPart, CallPanelUnavailable } from '../calls/CallPanelPart';
import { transcriptPanelAtom, useTranscriptPanel } from '../calls/transcription/transcriptPanel';
import {
  conversationToShow,
  subagentsPanelAtom,
  useSubagentsPanel,
} from '../navigation/subagentsPanel';
import { SubagentsPanelPart } from '../subagents/SubagentsPanelPart';
import { subagentConversation } from '../messages/live/subagentRunStore';
import { useCallViewFloats } from '../calls/window/callWindowState';
import { lazyPart } from '../lib/lazyPart';
import { PluginSidePanel } from './PluginSidePanel';
import { MessageLinkCards } from './MessageLinkCards';
import { usePluginPanel } from './usePluginPanel';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import { useAlive } from '../lib/hooks/useAlive';
import {
  callTranscriptWidthStorageKey,
  callWidthStorageKey,
  computerWidthStorageKey,
  pluginPanelWidthStorageKey,
  secondThreadWidthStorageKey,
  subagentsWidthStorageKey,
} from '../preferences/accountStorageKeys';
import { SecondThreadContext, type SecondThreadControl } from '../navigation/secondThread';
import { SecondThreadPanel } from './SecondThreadPanel';
import { SecondThreadDropZone } from './SecondThreadDropZone';
import { useSecondThread } from './useSecondThread';
import { ROOM_COMPOSER, THREAD_COLUMN_COMPOSER } from './composerSelectors';
import {
  composerOfferAtom,
  getRoomInputDraftKey,
  roomIdToMsgDraftAtomFamily,
} from '../composer/roomInputDrafts';
import { shownConversationViewsAtom } from '../navigation/conversationView';
import { createParagraphElement } from '../editor/utils';
import { confirmedVoiceThreadId as confirmed } from '../composer/RoomInputExtensions';
import * as swipeCss from './RoomSidePanelSwipe.css';

const SECOND_THREAD_PANEL = '[data-testid="second-thread-panel"]';
// The composers the focus goes back to from the second thread: the open thread's, else the room's.
const MAIN_COMPOSERS = [THREAD_COLUMN_COMPOSER, ROOM_COMPOSER];

/** The computer opens wide enough for a desktop screen beside the conversation. */
const COMPUTER_DEFAULT_WIDTH = 672;
// The live transcript loads on first use too, and says so as the call panel does when its chunk
// does not load.
const LiveTranscriptPanel = lazyPart(
  () =>
    import('../calls/transcription/LiveTranscriptPanel').then((module) => ({
      default: module.LiveTranscriptPanel,
    })),
  CallPanelUnavailable
);
// The call buttons load on first use, as the call panel does.
const HeaderCallButtons = lazyPart(() =>
  import('../calls/HeaderCallButtons').then((module) => ({ default: module.HeaderCallButtons }))
);

/** The call panel fits two tiles side by side; wider, it fits more. A plugin's panel opens as wide. */
const CALL_DEFAULT_WIDTH = 400;

const PANEL_SWIPE_DIM_MAX_OPACITY = 0.12;

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
  /** Draws its frame itself (a plugin's `frame: 'own'`): it has its layout on phones too. */
  ownFrame?: boolean;
  render: () => ReactNode;
  /** Opens it in its own state, for the header's toggle; panels opened otherwise have none. */
  show?: () => void;
};

/**
 * What the room's URL asks for: an event, a thread, whether to show the event in place, and the
 * fork point of a fork draft of the thread; and the router's key of the history entry that asks,
 * whether the router pushed that entry, and whether the app's Back put it in a thread's place.
 */
const useRoomRoute = () => {
  const { eventId } = useRoomRouteParams();
  const [search] = useSearchParams();
  const location = useLocation();
  return {
    eventId,
    hasThreadId: search.has('threadId'),
    routedThreadId: search.get('threadId') ?? undefined,
    focusEventInRoom: search.get('focusEvent') === '1',
    entryKey: location.key,
    entryPushed: useNavigationType() === NavigationType.Push,
    entryReturned: isReturnToRoom(location.state),
    hasForkRoom: search.has('forkRoom'),
    hasForkThread: search.has('forkThread'),
    forkRoom: search.get('forkRoom') ?? undefined,
    forkThread: search.get('forkThread') ?? undefined,
    forkAt: search.get('forkAt') ?? undefined,
  };
};

/**
 * A room: its view, and beside it one side panel at a time (an agent's computer, a canvas, the
 * call, its live transcript, the sub-agents, the members, or a plugin's panel). The room also
 * carries out the UI requests agents send (`io.mindroom.ui_action`).
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
  const {
    eventId,
    hasThreadId,
    routedThreadId,
    focusEventInRoom,
    entryKey,
    entryPushed,
    entryReturned,
    hasForkRoom,
    hasForkThread,
    forkRoom,
    forkThread,
    forkAt,
  } = useRoomRoute();
  const { roomId } = room;
  // Every room address, a thread's included, opens here: the palette lists this room among the
  // ones visited last. Messages arriving in it do not count.
  useEffect(() => {
    bumpRecentRoom(roomId);
  }, [roomId]);
  const client = useMatrixClient();
  useEffect(() => {
    void ensureActiveRunsPowerLevel(client, room);
  }, [client, room]);
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
  const rawCrossRoomFork = useMemo(
    () =>
      parseCrossRoomForkParams(
        { hasThreadId, threadId: routedThreadId, forkRoom, forkThread, forkAt },
        roomId
      ),
    [forkAt, forkRoom, forkThread, hasThreadId, roomId, routedThreadId]
  );
  const forkSourceRoom = useJoinedRoom(client, rawCrossRoomFork?.sourceRoomId);
  const crossRoomFork = useMemo(() => {
    if (!rawCrossRoomFork || !forkSourceRoom || forkSourceRoom.isSpaceRoom?.()) return undefined;
    if (forkSourceRoom.hasEncryptionStateEvent?.() && !room.hasEncryptionStateEvent?.()) {
      return undefined;
    }
    return {
      sourceRoom: forkSourceRoom,
      threadId: rawCrossRoomFork.threadId,
      forkAt: rawCrossRoomFork.forkAt,
    };
  }, [forkSourceRoom, rawCrossRoomFork, room]);
  const sameRoomForkAt =
    routedThreadId && !hasForkRoom && !hasForkThread && isEventId(forkAt) ? forkAt : undefined;
  const isForkDraft = !!sameRoomForkAt || !!crossRoomFork;

  // The Full view shows no thread routes, so a link to a thread brings the threads back, as an
  // action from a thread does. A direct chat between people always shows Threads.
  const threadLinkInFullView =
    (!!routedThreadId || !!crossRoomFork) &&
    chosenViewMode === 'classic' &&
    !!availableViewModes?.includes('threaded');
  const viewMode = threadLinkInFullView ? 'threaded' : chosenViewMode;
  useEffect(() => {
    if (threadLinkInFullView) setViewMode('threaded');
  }, [setViewMode, threadLinkInFullView]);
  const { navigatePath, navigateRoom, navigateRoomThread } = useRoomNavigate();
  const handleExitCrossRoomFork = useCallback(() => {
    const exitTarget = getRoomThreadExitTargetFromHistoryState(window.history.state);
    if (exitTarget && exitTarget.roomId === roomId && exitTarget.exitPath && navigatePath) {
      navigatePath(exitTarget.exitPath, { replace: true });
      return;
    }
    navigateRoom(roomId, undefined, { replace: true });
  }, [navigatePath, navigateRoom, roomId]);
  const setSettingsModal = useSetAtom(settingsModalAtom);

  // The URL may name a reply; panels and agent requests belong to the thread's root.
  const threadId = useThreadRootEvent(room, routedThreadId);
  const {
    threadId: secondId,
    focus: secondFocus,
    open: openSecond,
    close: closeSecond,
  } = useSecondThread(roomId, ownUserId, threadId);
  // Whether B's view held the focus as it went (SecondThreadPanel), for the handoff below.
  const secondHadFocus = useRef(false);
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

  const canvasEnabled = canvasesEnabled(clientConfig);
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
  // On desktop the call view floats over every page unless the person docked it here. The mode
  // alone: the room does not render again when the floating window moves.
  const callFloats = useCallViewFloats();
  const callInSidePanel = callOpen && !callFloats;
  const transcript = useTranscriptPanel(roomId);
  const subagents = useSubagentsPanel(roomId);

  const pluginClientConfig = usePluginClientConfig();
  const pluginPanels = usePluginSidePanels(registeredPlugins, pluginClientConfig);
  const pluginActions = usePluginHeaderActions(registeredPlugins, pluginClientConfig);
  const closeCall = () => setCallOpen(false);
  const closeMembers = () => setMembersOpen(false);
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
    computerOpen || !!canvas || callInSidePanel || transcript.open || subagents.open,
    { beside: membersOpen && !membersOverPage, close: closeMembers }
  );

  // The call side panel, while the call view does not float: a floating window is no side panel,
  // so the others neither close it nor are closed by it.
  const callPanel: PanelEntry = {
    id: 'call',
    open: callInSidePanel,
    close: closeCall,
    // The call buttons, a ring and a call started elsewhere open it in the call store.
    opensElsewhere: true,
    label: t('featureUi.calls.panel.title'),
    covers: mobile,
    render: () => (
      <ResizablePanel
        side="end"
        storageKey={callWidthStorageKey(ownUserId)}
        defaultWidth={CALL_DEFAULT_WIDTH}
        minContentWidth={CONVERSATION_MIN_WIDTH}
        maxPanelWidth={SIDE_PANEL_MAX_WIDTH}
        passthrough={mobile}
        resizeLabel={t('featureUi.calls.panel.resize')}
        collapseLabel={t('featureUi.calls.panel.close')}
        onCollapse={closeCall}
        testId="resizable-call-panel"
      >
        <Suspense fallback={null}>
          <CallPanelPart room={room} onClose={closeCall} />
        </Suspense>
      </ResizablePanel>
    ),
  };

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
            storageKey={computerWidthStorageKey(ownUserId)}
            defaultWidth={COMPUTER_DEFAULT_WIDTH}
            minContentWidth={CONVERSATION_MIN_WIDTH}
            maxPanelWidth={SIDE_PANEL_MAX_WIDTH}
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
            remote={clientConfig.mindroom?.canvas?.remoteAssets === true}
          />
        ),
    },
    ...(callFloats ? [] : [callPanel]),
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
          storageKey={callTranscriptWidthStorageKey(ownUserId)}
          defaultWidth={CALL_DEFAULT_WIDTH}
          minContentWidth={CONVERSATION_MIN_WIDTH}
          maxPanelWidth={SIDE_PANEL_MAX_WIDTH}
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
    {
      id: 'subagents',
      open: subagents.open,
      close: subagents.close,
      // Open in the store (navigation/subagentsPanel.ts), which a sub-agent job in the jobs bar
      // sets too; the room then makes room for it (below).
      show: subagents.show,
      label: t('mindroomUi.subagents.title'),
      covers: mobile,
      // Its runs' transcripts read like the live transcript, so it grows no wider.
      render: () => (
        <ResizablePanel
          side="end"
          storageKey={subagentsWidthStorageKey(ownUserId)}
          defaultWidth={CALL_DEFAULT_WIDTH}
          minContentWidth={CONVERSATION_MIN_WIDTH}
          maxPanelWidth={SIDE_PANEL_MAX_WIDTH}
          passthrough={mobile}
          resizeLabel={t('mindroomUi.subagents.resize')}
          collapseLabel={t('mindroomUi.subagents.hide')}
          onCollapse={subagents.close}
          testId="resizable-subagents-panel"
        >
          <Suspense fallback={null}>
            <SubagentsPanelPart
              room={room}
              threadId={subagentConversation(threadId, viewMode === 'classic')}
              onClose={subagents.close}
              // A fork draft's thread is read-only, so its jobs bar stops nothing, nor does the panel.
              readOnly={isForkDraft}
            />
          </Suspense>
        </ResizablePanel>
      ),
    },
    ...pluginPanels.map((panel): PanelEntry => ({
      id: panel.id,
      open: pluginPanel?.id === panel.id,
      close: closePluginPanel,
      show: () => showPluginPanel(panel),
      label: panel.label,
      covers: mobile,
      ownFrame: panel.frame === 'own',
      render: () => {
        const content = (
          <PluginSidePanel
            panel={panel}
            roomId={roomId}
            request={pluginPanel?.request}
            onClose={closePluginPanel}
          />
        );
        // One that draws its own frame has no box of the room's either: it sizes itself.
        if (panel.frame === 'own') return content;
        return (
          <ResizablePanel
            side="end"
            storageKey={pluginPanelWidthStorageKey(ownUserId, panel.id)}
            defaultWidth={CALL_DEFAULT_WIDTH}
            minContentWidth={CONVERSATION_MIN_WIDTH}
            maxPanelWidth={SIDE_PANEL_MAX_WIDTH}
            passthrough={mobile}
            resizeLabel={t('mindroomUi.plugins.sidePanel.resize', { label: panel.label })}
            collapseLabel={t('mindroomUi.plugins.sidePanel.close', { label: panel.label })}
            onCollapse={closePluginPanel}
            testId="resizable-plugin-panel"
          >
            {content}
          </ResizablePanel>
        );
      },
    })),
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
    {
      // A second thread beside the open one (Open in second column), never on phones. It has no
      // frame: it never fills the room nor folds.
      id: 'thread',
      open: !mobile && !!secondId,
      close: closeSecond,
      covers: false,
      render: () =>
        secondId && (
          <SecondThreadPanel
            room={room}
            threadId={secondId}
            autoFocus={secondFocus}
            onClose={closeSecond}
            onGone={(hadFocus) => {
              secondHadFocus.current = hadFocus;
            }}
            widthKey={secondThreadWidthStorageKey(ownUserId)}
          />
        ),
    },
  ];
  const { shown, layout, setLayout, request } = useRoomPanels(roomId, panels);
  const secondThread = useMemo<SecondThreadControl | undefined>(
    () =>
      mobile
        ? undefined
        : {
            offers: (target, rootId) =>
              target === roomId &&
              isConfirmedMatrixEventId(rootId) &&
              rootId !== threadId &&
              rootId !== secondId,
            open: (target, rootId) => {
              if (target === roomId) request('thread', () => openSecond(rootId));
            },
          },
    [mobile, openSecond, request, roomId, secondId, threadId]
  );
  // B as it shows, which a late SDK model of it loads for, as the open thread's does.
  const secondShown = shown?.id === 'thread' ? secondId : undefined;
  useInitializeOpenThread(room, secondShown);
  // The return shortcut, transcript and sub-agent jobs ask for their panels as the room's own
  // buttons do, even if the panel is already open but folded.
  const store = useStore();
  useEffect(() => {
    const takeRequest = () => {
      if (store.get(callPanelRequestAtom)?.roomId !== roomId) return;
      store.set(callPanelRequestAtom, undefined);
      if (store.get(callPanelRoomAtom) === roomId) request('call', () => undefined);
    };
    // Returning from another room sets the request before this room is shown.
    takeRequest();
    return store.sub(callPanelRequestAtom, takeRequest);
  }, [request, roomId, store]);
  useEffect(
    () =>
      store.sub(transcriptPanelAtom, () => {
        if (store.get(transcriptPanelAtom)?.roomId === roomId)
          request('transcript', () => undefined);
      }),
    [request, roomId, store]
  );
  // A sub-agent job of another conversation (the room's jobs bar lists every thread's) shows that
  // conversation, so the panel lists its run.
  const subagentsShown = useLatestRef({ threadId, classic: viewMode === 'classic' });
  useEffect(
    () =>
      store.sub(subagentsPanelAtom, () => {
        const opened = store.get(subagentsPanelAtom);
        if (opened?.roomId !== roomId) return;
        request('subagents', () => undefined);
        const shown = subagentsShown.current;
        const target = conversationToShow(opened.threadId, shown.threadId, shown.classic);
        if (target === null) navigateRoom(roomId);
        else if (target !== undefined) navigateRoomThread(roomId, target);
      }),
    [navigateRoom, navigateRoomThread, request, roomId, store, subagentsShown]
  );
  const folded = layout === 'folded';
  function toggleFilled(id: string) {
    setLayout(id, layout === 'filled' ? 'beside' : 'filled');
  }
  // What a plugin's code may do with its panels here (useRoomSidePanel). It may call long after it
  // got these, once a save ends, say: they act on the room and the panel shown then, and not at all
  // once this page has gone.
  const shownId = shown?.id;
  const now = useLatestRef({
    roomId,
    shownId,
    layout,
    pluginRequest: pluginPanel?.request,
    threadId,
    mobile,
    pluginPanels,
  });
  const alive = useAlive();
  // Beside the conversation the shown panel has a frame, which fills the room with it or folds it
  // to a tab at the room's edge. Phones show the panel over the conversation, with no frame; the
  // members, a list their header button already shows and hides, have none either. A panel that
  // draws its own frame gets its layout on phones too. The frame keeps its identity while the
  // layout stays, and acts only in the room it came from.
  const frameLabel = !mobile || shown?.ownFrame ? shown?.label : undefined;
  const frame = useMemo<PanelFrame | undefined>(
    () =>
      shownId === undefined || frameLabel === undefined
        ? undefined
        : {
            label: frameLabel,
            layout,
            setLayout: (next) => {
              if (now.current.roomId === roomId) setLayout(shownId, next);
            },
          },
    [frameLabel, layout, now, roomId, setLayout, shownId]
  );
  // `open` and `close` keep their identity while the room shows, so plugin code that depends on them
  // does not run again when another panel shows or the panels' labels change with the language.
  const openPluginPanel = useCallback<PluginPanelControls['open']>(
    (id, panelRequest) => {
      const panel = now.current.pluginPanels.find((candidate) => candidate.id === id);
      if (alive() && now.current.roomId === roomId && panel) {
        request(id, () => showPluginPanel(panel, panelRequest));
      }
    },
    [alive, now, request, roomId, showPluginPanel]
  );
  // The thread shown whose one call to open a plugin's panel beside it came; it gets another once
  // another thread or the room's own timeline has shown.
  const calledBeside = useRef<string>(undefined);
  useEffect(() => {
    if (calledBeside.current !== threadId) calledBeside.current = undefined;
  }, [threadId]);
  // It takes a new identity whenever the room shows another thread, so a renderer's effect that
  // depends on it asks again, also in a card that stays mounted as its thread opens.
  const openPluginPanelBesideThread = useCallback<PluginPanelControls['openBesideThread']>(
    (id, besideThread, panelRequest) => {
      const { shownId: shownNow, threadId: threadNow, mobile: phone } = now.current;
      const panel = now.current.pluginPanels.find((candidate) => candidate.id === id);
      if (
        !alive() ||
        now.current.roomId !== roomId ||
        threadNow !== threadId ||
        besideThread !== threadId ||
        calledBeside.current === besideThread ||
        !panel
      ) {
        return;
      }
      calledBeside.current = besideThread;
      if (phone) return;
      // Shown already, folded or filling the room, it stays so.
      if (shownNow === id) showPluginPanel(panel, panelRequest);
      else if (shownNow === undefined || (shownNow === 'members' && panel.opensOverMembers)) {
        request(id, () => showPluginPanel(panel, panelRequest));
      }
    },
    [alive, now, request, roomId, showPluginPanel, threadId]
  );
  const closeShownPluginPanel = useCallback<PluginPanelControls['close']>(
    (id) => {
      if (alive() && now.current.roomId === roomId && now.current.shownId === id) {
        closePluginPanel();
      }
    },
    [alive, closePluginPanel, now, roomId]
  );
  // Folded to a tab, a panel shows nothing of its request, so it does not count. It reads the room
  // as it is when called, so it keeps its identity while the room shows.
  const showsPluginRequest = useCallback<PluginPanelControls['showsRequest']>(
    (id, panelRequest) => {
      const { roomId: roomNow, shownId: shownNow, layout: layoutNow, pluginRequest } = now.current;
      if (!alive() || roomNow !== roomId || shownNow !== id || layoutNow === 'folded') return false;
      try {
        return JSON.stringify(pluginRequest) === JSON.stringify(panelRequest);
      } catch {
        // A request JSON cannot hold, such as one with a BigInt or a cycle, matches nothing.
        return false;
      }
    },
    [alive, now, roomId]
  );
  // Known once the room has the event the address names, which may be a reply, and the server has
  // confirmed the root, which a new thread's first message waits for.
  const shownThread = routeReady && isConfirmedMatrixEventId(threadId) ? threadId : undefined;
  const pluginPanelControls = useMemo<PluginPanelControls>(
    () => ({
      shown: shownId,
      thread: shownThread,
      open: openPluginPanel,
      openBesideThread: openPluginPanelBesideThread,
      close: closeShownPluginPanel,
      showsRequest: showsPluginRequest,
    }),
    [
      closeShownPluginPanel,
      openPluginPanel,
      openPluginPanelBesideThread,
      showsPluginRequest,
      shownId,
      shownThread,
    ]
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

  // With canvases off, a canvas asks for a text version in its thread's draft, never over work.
  const textRequest = useMemo(() => {
    const offer = (threadId: string | undefined, text: string) =>
      composerOfferAtom([ownUserId, roomId, threadId], [createParagraphElement(text)], confirmed);
    const fill = (action: ChatUiAction, text: string) => {
      if (store.get(offer(action.threadId, text)) !== 'empty') return;
      const draftKey = getRoomInputDraftKey(ownUserId, roomId, action.threadId);
      store.set(roomIdToMsgDraftAtomFamily(draftKey), [createParagraphElement(text)]);
      // Opened unless it shows: the thread in a view on screen, the room alone or beside a thread.
      const shown = store
        .get(shownConversationViewsAtom)
        .some((v) => v.roomId === roomId && v.threadId === action.threadId);
      if (!shown && (action.threadId || threadId)) showConversation(action.threadId);
    };
    return { offer, fill };
  }, [ownUserId, roomId, showConversation, store, threadId]);

  const uiActions = useChatUiActions({
    mx: client,
    room,
    threadId,
    autoOpenFromHomeservers: clientConfig.mindroom?.uiActions?.autoOpenFromHomeservers,
    ready: routeReady,
    perform,
    navigate: showConversation,
    unavailable,
    openCanvasId,
    textRequest: canvasEnabled ? undefined : textRequest,
  });

  // A canvas chosen in the header may still load; any change of what the side panel shows
  // (or of the conversation, or which thread the second thread panel shows) since then wins over
  // its late answer.
  const panelContext = [
    conversation,
    openCanvasId ?? '',
    secondShown ?? '',
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

  // On phones a panel covers the conversation, unless it draws its own frame and is folded; filling
  // the room, it takes the conversation's place. The conversation stays mounted under it, with its
  // draft and a recording in progress, out of reach and out of sight (conversationBehindPanelAtom),
  // as under a plugin's cover.
  const behindPanel = (!!shown?.covers && !(shown.ownFrame && folded)) || layout === 'filled';
  const conversationRef = useRef<HTMLDivElement>(null);
  useInert(conversationRef, behindPanel);
  // B gone however it closed (its Close, another panel or a call in its place) with the focus in
  // it hands the focus to the main composer: the open thread's, else the room's. Focus left on the
  // page's body or in the panel moving out moves; focus taken elsewhere stays.
  const secondWasShown = useRef(secondShown);
  useEffect(() => {
    const was = secondWasShown.current;
    secondWasShown.current = secondShown;
    const hadFocus = secondHadFocus.current;
    secondHadFocus.current = false;
    const box = conversationRef.current;
    const focused = box?.ownerDocument.activeElement;
    if (!was || secondShown || !box || !focused) return;
    const inShell = !!focused.closest(SECOND_THREAD_PANEL);
    if (!inShell && !(hadFocus && focused === box.ownerDocument.body)) return;
    MAIN_COMPOSERS.map((selector) => box.querySelector<HTMLElement>(selector))
      .find(Boolean)
      ?.focus();
  }, [secondShown]);
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
  const sidePanelHostRef = useRef<HTMLDivElement>(null);
  const shownRef = useLatestRef(shown);
  const callFloatsRef = useLatestRef(callFloats);
  const { close: closeTranscript } = transcript;
  const closeCoveringPanel = useCallback(() => {
    const current = shownRef.current;
    if (!current) return;
    if (current.id === 'transcript') {
      closeTranscript();
    } else {
      current.close();
    }
  }, [closeTranscript, shownRef]);
  const closeCoveringPanelRef = useLatestRef(closeCoveringPanel);
  const beginPanelClose = useCallback(
    ({ dirSign }: { axisSign: 1 | -1; dirSign: 1 | -1 }): InteractiveSwipeScene | null => {
      const currentShown = shownRef.current;
      const host = sidePanelHostRef.current;
      const conversation = conversationRef.current;
      if (!currentShown || !host) return null;
      const extent = host.getBoundingClientRect().width;
      if (extent <= 0) return null;

      const startShownId = currentShown.id;
      const stage = layoutParentOf(host);
      const useBackdrop =
        startShownId === 'transcript' &&
        !callFloatsRef.current &&
        store.get(transcriptPanelAtom)?.replacedCall === true;
      if (!useBackdrop && !conversation) return null;

      const hostParent = stage ?? host.parentElement;
      if (stage) stage.dataset.swipePanelStage = '';

      let backdrop: HTMLDivElement | null = null;
      let underLayer: HTMLElement;
      if (useBackdrop) {
        backdrop = host.ownerDocument.createElement('div');
        backdrop.className = swipeCss.PanelSwipeBackdrop;
        backdrop.dataset.swipePanelBackdrop = '';
        backdrop.dataset.swiping = '';
        backdrop.setAttribute('aria-hidden', 'true');
        hostParent?.appendChild(backdrop);
        underLayer = backdrop;
      } else {
        conversation!.dataset.swipeUnderPanel = '';
        conversation!.dataset.swiping = '';
        underLayer = conversation!;
      }

      const dim = host.ownerDocument.createElement('div');
      dim.className = swipeCss.PanelSwipeDim;
      dim.dataset.swipePanelDim = '';
      dim.dataset.swiping = '';
      dim.setAttribute('aria-hidden', 'true');
      hostParent?.appendChild(dim);

      host.dataset.swiping = '';
      host.dataset.swipeShadow = '';

      const applyPositions = (offsetPx: number, progress: number) => {
        host.style.translate = `${offsetPx * dirSign}px 0`;
        underLayer.style.translate = `${-0.3 * extent * (1 - progress) * dirSign}px 0`;
        dim.style.opacity = String(PANEL_SWIPE_DIM_MAX_OPACITY * (1 - progress));
      };
      applyPositions(0, 0);

      let cleaned = false;
      const resetDom = () => {
        if (cleaned) return;
        cleaned = true;
        delete host.dataset.swiping;
        delete host.dataset.swipeShadow;
        host.style.translate = '';
        if (backdrop) {
          backdrop.remove();
        } else if (conversation) {
          delete conversation.dataset.swipeUnderPanel;
          delete conversation.dataset.swiping;
          conversation.style.translate = '';
        }
        dim.remove();
        if (stage) {
          delete stage.dataset.swipePanelStage;
        }
      };

      return {
        extent,
        update(offsetPx, progress) {
          applyPositions(offsetPx, progress);
        },
        settle(commit, durationMs, currentOffsetPx) {
          const currentProgress =
            extent > 0 ? Math.min(1, Math.max(0, currentOffsetPx / extent)) : 0;
          const startPanelX = currentOffsetPx * dirSign;
          const targetPanelX = (commit ? extent : 0) * dirSign;
          const startUnderX = -0.3 * extent * (1 - currentProgress) * dirSign;
          const targetUnderX = (commit ? 0 : -0.3 * extent) * dirSign;
          const startDimOpacity = PANEL_SWIPE_DIM_MAX_OPACITY * (1 - currentProgress);
          const targetDimOpacity = commit ? 0 : PANEL_SWIPE_DIM_MAX_OPACITY;
          return animateSwipeElements(
            [
              {
                element: host,
                keyframes: [
                  { translate: `${startPanelX}px 0` },
                  { translate: `${targetPanelX}px 0` },
                ],
              },
              {
                element: underLayer,
                keyframes: [
                  { translate: `${startUnderX}px 0` },
                  { translate: `${targetUnderX}px 0` },
                ],
              },
              {
                element: dim,
                keyframes: [
                  { opacity: String(startDimOpacity) },
                  { opacity: String(targetDimOpacity) },
                ],
              },
            ],
            durationMs
          );
        },
        commit() {
          if (shownRef.current?.id !== startShownId) return;
          flushSync(() => {
            closeCoveringPanelRef.current();
          });
          resetDom();
        },
        cleanup() {
          resetDom();
        },
      };
    },
    [callFloatsRef, closeCoveringPanelRef, shownRef, store]
  );
  // Covered on phones, one Room-level start-edge swipe closes any covering side panel uniformly.
  useEdgeSwipeBack(closeCoveringPanel, mobile && behindPanel && !!shown, {
    priority: SWIPE_PRIORITY.PANEL,
    begin: beginPanelClose,
  });

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
    calls: (
      <Suspense fallback={null}>
        <HeaderCallButtons threadId={threadId} />
      </Suspense>
    ),
  };

  // The panel shown, keyed by which it is: opening or closing one moves it in or out, and one
  // taking another's place changes width without closing first. It holds the plugin panel controls
  // of the room it shows in, so one still moving out after a room switch acts on no other room.
  const sidePanel = usePanelSlot(
    shown && (
      <PanelFrameProvider key={shown.id} value={frame}>
        <PluginPanelControlsContext value={pluginPanelControls}>
          {shown.render()}
        </PluginPanelControlsContext>
      </PanelFrameProvider>
    )
  );

  return (
    <PowerLevelsContextProvider value={powerLevels}>
      <ChatUiActionContext value={uiActions}>
        <PluginPanelControlsContext value={pluginPanelControls}>
          <SecondThreadContext value={secondThread}>
            <Box
              ref={conversationRef}
              data-conversation-behind-panel={String(behindPanel)}
              data-plugin-panel-open={shown && shown.id === pluginPanel?.id ? '' : undefined}
              grow="Yes"
              direction="Column"
              style={behindPanel ? HIDDEN_CONVERSATION_STYLE : CONVERSATION_STYLE}
            >
              <RoomMessageAnnouncer room={room} threadId={routedThreadId} myUserId={ownUserId} />
              {/* Without an open thread the room's announcer reads B's replies too. */}
              {routedThreadId && secondShown && (
                <RoomMessageAnnouncer room={room} threadId={secondShown} myUserId={ownUserId} />
              )}
              <MessageLinkCards roomId={room.roomId}>
                <RoomView
                  room={room}
                  eventId={eventId}
                  threadId={routedThreadId}
                  forkAt={sameRoomForkAt}
                  crossRoomFork={crossRoomFork}
                  onExitCrossRoomFork={crossRoomFork ? handleExitCrossRoomFork : undefined}
                  focusEventInRoom={focusEventInRoom}
                  entryKey={entryKey}
                  entryPushed={entryPushed}
                  entryReturned={entryReturned}
                  hasMindroomAgents={hasMindroomAgents}
                  joinRequestCount={joinRequestCount}
                  onThreadLoadError={onThreadLoadError}
                  besideWhileSecond={!!secondShown}
                  {...headerPanels}
                />
              </MessageLinkCards>
            </Box>
            <RoomPanelEdgeSwipeContext value={mobile && behindPanel}>
              {sidePanel && (
                <div
                  ref={sidePanelHostRef}
                  className={
                    mobile && behindPanel
                      ? swipeCss.PhoneSidePanelHost
                      : swipeCss.PhoneSidePanelPassthrough
                  }
                  data-side-panel-host=""
                  data-phone-side-panel-host={mobile && behindPanel ? '' : undefined}
                >
                  {sidePanel}
                </div>
              )}
            </RoomPanelEdgeSwipeContext>
            {/* A thread card dragged on the page drops at the room's end edge into B. */}
            {secondThread && (
              <SecondThreadDropZone
                widthKey={secondThreadWidthStorageKey(ownUserId)}
                onOpen={secondThread.open}
              />
            )}
          </SecondThreadContext>
        </PluginPanelControlsContext>
      </ChatUiActionContext>
    </PowerLevelsContextProvider>
  );
}
