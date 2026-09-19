import React, { useCallback, useMemo } from 'react';
import { Box, Line } from 'folds';
import { KnownMembership } from 'matrix-js-sdk';
import { useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAtomValue, useSetAtom } from 'jotai';
import { RoomView } from './MindroomRoomView';
import { MembersDrawer } from '../../features/room/MembersDrawer';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { PowerLevelsContextProvider, usePowerLevels } from '../../hooks/usePowerLevels';
import { useRoom } from '../../hooks/useRoom';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomMembers } from '../../hooks/useRoomMembers';
import { CallView } from '../../features/call/CallView';
import { RoomViewHeader } from './MindroomRoomViewHeader';
import { callChatAtom } from '../../state/callEmbed';
import { MindroomCallChatView } from './MindroomCallChatView';
import { getRoomSearchParams } from '../../pages/pathSearchParam';
import { useRoomThreadRouteGuards } from './useRoomThreadRouteGuards';
import { useRoomEscapeReadReceipts } from './useRoomEscapeReadReceipts';
import { useRoomViewMode } from './useRoomViewMode';
import { useThreadRootEvent } from './useThreadRootEvent';
import { hasActiveMindroomAgent, isMindroomAgentUserId } from '../matrix/agentIdentity';
import { MembershipFilter } from '../../hooks/useMemberFilter';
import { useClientConfig } from '../../hooks/useClientConfig';
import { resolveComputerApiUrl } from '../computer/api';
import { ComputerPanel } from '../computer/ComputerPanel';
import { useRoomComputerState } from '../computer/useRoomComputerState';
import type { ComputerAgent } from '../computer/types';
import { ResizableMembersPanel } from '../sidebar/ResizableMembersPanel';
import { useMembersDrawer } from '../sidebar/useMembersDrawer';
import { settingsModalAtom } from '../../state/settingsModal';
import {
  SettingsPages,
  SIMPLE_MODE_HIDDEN_SETTINGS_PAGES,
} from '../../features/settings/settingsPages';
import { useRoomNavigate } from '../../hooks/useRoomNavigate';
import { ChatUiActionContext, useChatUiActions } from '../ui-actions/ChatUiActionProvider';
import type { ChatUiAction, ChatUiSettingsSection } from '../ui-actions/chatUiProtocol';
import { useSimpleMode } from '../settings/useMindroomAccountSettings';

const UI_SETTINGS_PAGES: Record<ChatUiSettingsSection, SettingsPages> = {
  general: SettingsPages.GeneralPage,
  account: SettingsPages.AccountPage,
  notifications: SettingsPages.NotificationPage,
  devices: SettingsPages.DevicesPage,
  'emojis-stickers': SettingsPages.EmojisStickersPage,
  developer: SettingsPages.DeveloperToolsPage,
  about: SettingsPages.AboutPage,
};

export function Room() {
  const { t } = useTranslation();
  const simpleMode = useSimpleMode();
  const { eventId } = useParams();
  const [searchParams] = useSearchParams();
  const room = useRoom();
  const mx = useMatrixClient();
  const roomSearchParams = useMemo(() => getRoomSearchParams(searchParams), [searchParams]);
  const { focusEvent, threadId } = roomSearchParams;

  const [isDrawer, setPeopleDrawer] = useMembersDrawer();
  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
  const screenSize = useScreenSizeContext();
  const powerLevels = usePowerLevels(room);
  const members = useRoomMembers(mx, room.roomId);
  const clientConfig = useClientConfig();
  const computerApiUrl = resolveComputerApiUrl(clientConfig.mindroom?.computers?.apiUrl);
  const computerAgents = useMemo<ComputerAgent[]>(
    () =>
      members
        .filter(
          (member) =>
            member.membership === KnownMembership.Join && isMindroomAgentUserId(member.userId)
        )
        .map((member) => ({
          userId: member.userId,
          name: member.name?.trim() || member.userId,
        })),
    [members]
  );
  const setSettingsModal = useSetAtom(settingsModalAtom);
  const { navigateRoom, navigateRoomThread } = useRoomNavigate();
  const computerAvailable = !!computerApiUrl && computerAgents.length > 0;
  const hasMindroomAgents = hasActiveMindroomAgent(members);
  const joinRequestCount = useMemo(
    () => members.filter(MembershipFilter.filterKnocked).length,
    [members]
  );
  const chat = useAtomValue(callChatAtom);
  const { viewMode, setViewMode } = useRoomViewMode(room.roomId);
  const routedThreadId = viewMode === 'classic' ? undefined : threadId;
  const {
    open: effectiveComputerOpen,
    requestedAgent,
    interaction: computerInteraction,
    toggle: toggleComputer,
    show: showComputer,
    close: closeComputer,
    reportInteraction,
  } = useRoomComputerState({
    mx,
    roomId: room.roomId,
    threadId: routedThreadId,
    available: computerAvailable,
  });
  const computerThreadId = useThreadRootEvent(room, routedThreadId);
  const continuationReady =
    !routedThreadId ||
    computerThreadId !== routedThreadId ||
    !!room.findEventById(routedThreadId) ||
    !!room.getThread(routedThreadId)?.rootEvent;
  const handleComputerToggle = useCallback(() => {
    if (!effectiveComputerOpen) setPeopleDrawer(false);
    toggleComputer();
  }, [effectiveComputerOpen, setPeopleDrawer, toggleComputer]);
  const handleThreadLoadError = useRoomThreadRouteGuards({
    eventId,
    roomId: room.roomId,
    threadId,
    viewMode,
  });
  useRoomEscapeReadReceipts({ hideActivity, roomId: room.roomId, threadId: routedThreadId });

  const callView = room.isCallRoom();
  const uiUnavailable = useCallback(
    (action: ChatUiAction): string | undefined => {
      if (callView) return t('mindroomUi.uiActions.openConversation');
      if (
        action.action === 'open_settings' &&
        simpleMode &&
        SIMPLE_MODE_HIDDEN_SETTINGS_PAGES.includes(UI_SETTINGS_PAGES[action.section])
      ) {
        return t('mindroomUi.uiActions.settingsUnavailable');
      }
      if (
        effectiveComputerOpen &&
        computerInteraction.locked &&
        !(
          action.action === 'show_computer' &&
          action.agentUserId === computerInteraction.agentUserId &&
          action.threadId === computerThreadId
        )
      ) {
        return t('mindroomUi.uiActions.releaseControl');
      }
      if (
        action.action === 'show_computer' &&
        (!computerApiUrl || !computerAgents.some((agent) => agent.userId === action.agentUserId))
      ) {
        return t('mindroomUi.uiActions.computerUnavailable');
      }
      return undefined;
    },
    [
      callView,
      simpleMode,
      effectiveComputerOpen,
      computerInteraction,
      computerApiUrl,
      computerAgents,
      computerThreadId,
      t,
    ]
  );
  const performUiAction = useCallback(
    (action: ChatUiAction) => {
      if (action.action === 'show_computer') {
        setPeopleDrawer(false);
        showComputer(action.agentUserId);
      } else if (action.action === 'open_settings') {
        setSettingsModal({
          initialPage: UI_SETTINGS_PAGES[action.section],
          requestId: action.eventId,
        });
      } else {
        closeComputer();
        setPeopleDrawer(true);
      }
    },
    [closeComputer, setPeopleDrawer, setSettingsModal, showComputer]
  );
  const navigateUiAction = useCallback(
    (targetThreadId?: string) => {
      if (targetThreadId) {
        if (viewMode === 'classic') setViewMode('threaded');
        navigateRoomThread(room.roomId, targetThreadId);
      } else navigateRoom(room.roomId);
    },
    [navigateRoom, navigateRoomThread, room.roomId, setViewMode, viewMode]
  );
  const uiActions = useChatUiActions({
    mx,
    room,
    threadId: computerThreadId,
    autoOpenFromHomeservers: clientConfig.mindroom?.uiActions?.autoOpenFromHomeservers,
    ready: !callView && continuationReady,
    perform: performUiAction,
    unavailable: uiUnavailable,
    navigate: navigateUiAction,
  });

  return (
    <ChatUiActionContext.Provider value={uiActions}>
      <PowerLevelsContextProvider value={powerLevels}>
        <Box grow="Yes">
          {callView && (screenSize === ScreenSize.Desktop || !chat) && (
            <Box grow="Yes" direction="Column">
              <RoomViewHeader callView hasMindroomAgents={hasMindroomAgents} />
              <Box grow="Yes">
                <CallView />
              </Box>
            </Box>
          )}
          {!callView && (
            <Box grow="Yes" direction="Column">
              <Box grow="Yes">
                <RoomView
                  room={room}
                  computerAvailable={computerAvailable}
                  computerOpen={effectiveComputerOpen}
                  onComputerToggle={handleComputerToggle}
                  hasMindroomAgents={hasMindroomAgents}
                  joinRequestCount={joinRequestCount}
                  eventId={eventId}
                  focusEventInRoom={focusEvent === '1'}
                  threadId={routedThreadId}
                  onThreadLoadError={handleThreadLoadError}
                />
              </Box>
            </Box>
          )}

          {callView && chat && (
            <>
              {screenSize === ScreenSize.Desktop && (
                <Line variant="Background" direction="Vertical" size="300" />
              )}
              <MindroomCallChatView
                room={room}
                hasMindroomAgents={hasMindroomAgents}
                eventId={eventId}
                focusEventInRoom={focusEvent === '1'}
                threadId={routedThreadId}
                onThreadLoadError={handleThreadLoadError}
              />
            </>
          )}
          {!callView && effectiveComputerOpen && computerApiUrl && (
            <>
              {screenSize === ScreenSize.Desktop && (
                <Line variant="Background" direction="Vertical" size="300" />
              )}
              <ComputerPanel
                agents={computerAgents}
                apiUrl={computerApiUrl}
                mx={mx}
                roomId={room.roomId}
                threadId={computerThreadId}
                continuationReady={continuationReady}
                requestedAgent={requestedAgent}
                onInteractionChange={reportInteraction}
                onClose={closeComputer}
              />
            </>
          )}
          {!callView && isDrawer && !effectiveComputerOpen && (
            <ResizableMembersPanel key={room.roomId} onClose={() => setPeopleDrawer(false)}>
              <MembersDrawer room={room} members={members} />
            </ResizableMembersPanel>
          )}
        </Box>
      </PowerLevelsContextProvider>
    </ChatUiActionContext.Provider>
  );
}
