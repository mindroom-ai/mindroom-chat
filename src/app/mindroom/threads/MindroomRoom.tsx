import {
  type ComponentProps,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { MatrixEvent } from 'matrix-js-sdk';
import { Box } from 'folds';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoom } from '../../hooks/useRoom';
import { useRoomMembers } from '../../hooks/useRoomMembers';
import { usePowerLevels, PowerLevelsContextProvider } from '../../hooks/usePowerLevels';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { useClientConfig } from '../../hooks/useClientConfig';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { settingsModalAtom } from '../../state/settingsModal';
import { SettingsPages, type SettingsPage } from '../../features/settings/settingsPages';
import { MembersDrawer } from '../../features/room/MembersDrawer';
import { hasActiveMindroomAgent, isMindroomAgentUserId } from '../matrix/agentIdentity';
import { useMembersDrawer } from '../sidebar/useMembersDrawer';
import { ResizableMembersPanel } from '../sidebar/ResizableMembersPanel';
import { CONVERSATION_MIN_WIDTH, ResizablePanel } from '../sidebar/ResizablePanel';
import { ComputerPanel } from '../computer/ComputerPanel';
import { CloseComputerPanelContext } from '../computer/ComputerScreenUnavailable';
import type { ComputerAgent } from '../computer/types';
import { useComputerApiUrl } from '../computer/useComputerApiUrl';
import { useRoomComputerState } from '../computer/useRoomComputerState';
import { useBindsOpenIdTokens, useRoomMindroomServers } from '../server/useMindroomServers';
import { RoomCanvasPanel } from '../canvas/RoomCanvasPanel';
import {
  useComputerShown,
  useConversationCanvases,
  useOpenCanvasById,
} from '../canvas/canvasIndex';
import { useCanvasOpenRequest } from '../canvas/useCanvasOpenRequest';
import { ChatUiActionContext, useChatUiActions } from '../ui-actions/ChatUiActionProvider';
import type { ChatUiAction, ChatUiSettingsSection } from '../ui-actions/chatUiProtocol';
import type { RoomViewHeaderProps } from './MindroomRoomViewHeader';
import { RoomView } from './MindroomRoomView';
import { isThreadRouteReady } from './threadRouteUtils';
import { useRoomEscapeReadReceipts } from './useRoomEscapeReadReceipts';
import { useRoomThreadRouteGuards } from './useRoomThreadRouteGuards';
import { useRoomViewMode } from './useRoomViewMode';
import { useThreadRootEvent } from './useThreadRootEvent';
import { useInitializeOpenThread } from './useInitializeOpenThread';
import { RoomMessageAnnouncer } from '../../features/room/RoomMessageAnnouncer';
import { useCallPanel } from '../../features/calls/callStore';
import type { CallPanel as CallPanelComponent } from '../../features/calls/CallPanel';
import { lazyPart } from '../../utils/lazyPart';

/** The computer opens wide enough for a desktop screen beside the conversation. */
const COMPUTER_DEFAULT_WIDTH = 672;
const COMPUTER_MAX_WIDTH = 1600;
/** Without its chunk (offline before any call here) the call panel closes again. */
function CallPanelUnavailable({ onClose }: ComponentProps<typeof CallPanelComponent>) {
  useEffect(() => onClose(), [onClose]);
  return null;
}

// Calls load on first use, so rooms without one never load them.
const CallPanel = lazyPart(
  () => import('../../features/calls/CallPanel').then((module) => ({ default: module.CallPanel })),
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

/** The call panel fits two tiles side by side; wider, it fits more. */
const CALL_DEFAULT_WIDTH = 400;
const CALL_MAX_WIDTH = 1200;

/** Where each Settings section an agent may ask for lives in the Settings dialog. */
const SETTINGS_PAGE_FOR_SECTION: Record<ChatUiSettingsSection, SettingsPage> = {
  general: SettingsPages.GeneralPage,
  account: SettingsPages.AccountPage,
  notifications: SettingsPages.NotificationPage,
  devices: SettingsPages.DevicesPage,
  'emojis-stickers': SettingsPages.EmojisStickersPage,
  developer: SettingsPages.DeveloperToolsPage,
  about: SettingsPages.AboutPage,
};

/** The side-panel controls of the room header; the room owns their state. */
type HeaderPanelControls = Pick<
  RoomViewHeaderProps,
  | 'computerAvailable'
  | 'computerOpen'
  | 'computerShown'
  | 'onComputerToggle'
  | 'canvasOpen'
  | 'canvases'
  | 'openCanvasId'
  | 'onCanvasOpen'
  | 'onCanvasClose'
  | 'calls'
>;

/** A canvas on screen and the conversation it was opened in. */
type ShownCanvas = { event: MatrixEvent; expanded: boolean; conversation: string };

/** The computer agents of the room and the server each one runs on. */
const useRoomComputer = (
  members: ReturnType<typeof useRoomMembers>,
  roomServers: ReturnType<typeof useRoomMindroomServers>,
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
  }, [bindsOpenIdTokens, configuredApiUrl, members, myUserId, roomServers]);

  return { agents, apiUrl: agents.length > 0 ? apiUrl : undefined };
};

/**
 * A room: its view, and beside it one side panel at a time (an agent's computer, a canvas, the
 * call, or the members). The room also carries out the UI requests agents send
 * (`io.mindroom.ui_action`).
 */
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

export function Room() {
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
  // action from a thread does. A direct chat between people offers no modes and keeps the guard's
  // redirect to the room timeline.
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

  const roomServers = useRoomMindroomServers(room);
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
  const [computerExpanded, setComputerExpanded] = useState(false);
  useEffect(() => {
    if (!computerOpen) setComputerExpanded(false);
  }, [computerOpen]);
  const computerShown = useComputerShown(client, roomId, threadId);

  const canvasEnabled = clientConfig.mindroom?.canvas?.enabled === true;
  const conversationCanvases = useConversationCanvases(client, roomId, threadId);
  const [shownCanvas, setShownCanvas] = useState<ShownCanvas>();
  // A canvas belongs to the conversation it opened in; another route shows none.
  const canvas =
    canvasEnabled && shownCanvas?.conversation === conversation ? shownCanvas : undefined;
  const openCanvasId = canvas?.event.getId() ?? undefined;
  const closeCanvas = useCallback(() => setShownCanvas(undefined), []);
  const showCanvas = useCallback(
    (event: MatrixEvent, expanded = false) => {
      setShownCanvas({ event, expanded, conversation });
      closeComputer();
      setMembersOpen(false);
    },
    [closeComputer, conversation, setMembersOpen]
  );

  const onComputerToggle = useCallback(() => {
    if (!computer.open) {
      closeCanvas();
      setMembersOpen(false);
    }
    toggleComputer();
  }, [closeCanvas, computer.open, setMembersOpen, toggleComputer]);

  // The call panel is one more side panel: opening it closes a canvas or the computer, and opening
  // either of those closes it. The members panel only steps aside while the call shows.
  const [callOpen, setCallOpen] = useCallPanel(roomId);
  const mediaPanelOpen = computerOpen || !!canvas;
  const lastPanels = useRef({ callOpen, mediaPanelOpen });
  useEffect(() => {
    const last = lastPanels.current;
    lastPanels.current = { callOpen, mediaPanelOpen };
    if (callOpen && !last.callOpen) {
      closeCanvas();
      closeComputer();
    } else if (mediaPanelOpen && !last.mediaPanelOpen && callOpen) {
      setCallOpen(false);
    }
  }, [callOpen, closeCanvas, closeComputer, mediaPanelOpen, setCallOpen]);
  const callShown = callOpen && !mediaPanelOpen;

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
      if (action.action === 'show_canvas' && !canvasEnabled) {
        return t('mindroomUi.uiActions.canvasDisabled');
      }
      return controlling ? t('mindroomUi.uiActions.releaseControl') : undefined;
    },
    [canvasEnabled, computerTarget.agents, controlledAgent, controlling, t]
  );

  const perform = useCallback(
    (action: ChatUiAction) => {
      switch (action.action) {
        case 'show_computer':
          closeCanvas();
          setMembersOpen(false);
          showComputer(action.agentUserId);
          break;
        case 'show_canvas':
          showCanvas(action.event);
          break;
        case 'open_panel':
          closeCanvas();
          closeComputer();
          setCallOpen(false);
          setMembersOpen(true);
          break;
        case 'open_settings':
          setSettingsModal({
            initialPage: SETTINGS_PAGE_FOR_SECTION[action.section],
            requestId: action.eventId,
          });
          break;
        default:
      }
    },
    [
      closeCanvas,
      closeComputer,
      setCallOpen,
      setMembersOpen,
      setSettingsModal,
      showCanvas,
      showComputer,
    ]
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
    computerOpen ? 'computer' : '',
    membersOpen ? 'members' : '',
  ].join('\n');
  const onCanvasOpen = useOpenCanvasById(client, room, panelContext, uiActions.activate);

  // The Canvases page opens its canvas across the whole room.
  const { read: readUiAction } = uiActions;
  const openRequestedCanvas = useCallback(
    (event: MatrixEvent) => {
      if (readUiAction(event)?.action === 'show_canvas') showCanvas(event, true);
    },
    [readUiAction, showCanvas]
  );
  useCanvasOpenRequest(client, room, canvasEnabled, openRequestedCanvas);

  // On phones a panel covers the conversation; expanded, it takes the conversation's column.
  const computerCoversConversation = computerOpen && (mobile || computerExpanded);
  const canvasCoversConversation = !!canvas && (mobile || canvas.expanded);
  const callCoversConversation = callShown && mobile;
  const conversationHidden =
    computerCoversConversation || canvasCoversConversation || callCoversConversation;
  const membersShown = membersOpen && !computerOpen && !canvas && !callShown;

  const onThreadLoadError = useRoomThreadRouteGuards({
    eventId,
    roomId,
    threadId: routedThreadId,
    viewMode,
  });
  useRoomEscapeReadReceipts({ conversationHidden, hideActivity, roomId, threadId });

  const powerLevels = usePowerLevels(room);
  const headerPanels: HeaderPanelControls = {
    computerAvailable: !!computerTarget.apiUrl,
    computerOpen,
    computerShown,
    onComputerToggle,
    canvasOpen: !!canvas,
    canvases: canvasEnabled ? conversationCanvases : undefined,
    openCanvasId,
    onCanvasOpen,
    onCanvasClose: closeCanvas,
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

  return (
    <PowerLevelsContextProvider value={powerLevels}>
      <ChatUiActionContext.Provider value={uiActions}>
        <Box grow="Yes" style={{ minWidth: 0, minHeight: 0 }}>
          {!conversationHidden && (
            <Box grow="Yes" direction="Column" style={{ minWidth: 0 }}>
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
          )}
          {computerOpen && computerTarget.apiUrl && (
            <ResizablePanel
              side="end"
              storageKey={`mindroom.computer.width:${ownUserId}`}
              defaultWidth={COMPUTER_DEFAULT_WIDTH}
              minContentWidth={CONVERSATION_MIN_WIDTH}
              maxPanelWidth={COMPUTER_MAX_WIDTH}
              fullWidth={!mobile && computerExpanded}
              passthrough={mobile}
              resizeLabel={t('mindroomUi.computer.resize')}
              collapseLabel={t('mindroomUi.computer.close')}
              onCollapse={closeComputer}
              testId="resizable-computer-panel"
            >
              {/* A screen whose chunk cannot load closes the panel through this. */}
              <CloseComputerPanelContext.Provider value={closeComputer}>
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
                  expanded={!mobile && computerExpanded}
                  onToggleExpanded={
                    mobile ? undefined : () => setComputerExpanded((expanded) => !expanded)
                  }
                />
              </CloseComputerPanelContext.Provider>
            </ResizablePanel>
          )}
          {canvas && (
            <RoomCanvasPanel
              mx={client}
              room={room}
              event={canvas.event}
              onClose={closeCanvas}
              expanded={canvas.expanded}
              onToggleExpanded={() =>
                setShownCanvas((shown) => shown && { ...shown, expanded: !shown.expanded })
              }
              libraries={clientConfig.mindroom?.canvas?.libraries === true}
            />
          )}
          {callShown && (
            <ResizablePanel
              side="end"
              storageKey={`mindroom.call.width:${ownUserId}`}
              defaultWidth={CALL_DEFAULT_WIDTH}
              minContentWidth={CONVERSATION_MIN_WIDTH}
              maxPanelWidth={CALL_MAX_WIDTH}
              passthrough={mobile}
              resizeLabel={t('featureUi.calls.panel.resize')}
              collapseLabel={t('featureUi.calls.panel.close')}
              onCollapse={() => setCallOpen(false)}
              testId="resizable-call-panel"
            >
              <Suspense fallback={null}>
                <CallPanel room={room} onClose={() => setCallOpen(false)} />
              </Suspense>
            </ResizablePanel>
          )}
          {membersShown && (
            <ResizableMembersPanel onClose={() => setMembersOpen(false)}>
              <MembersDrawer key={roomId} room={room} members={members} />
            </ResizableMembersPanel>
          )}
        </Box>
      </ChatUiActionContext.Provider>
    </PowerLevelsContextProvider>
  );
}
