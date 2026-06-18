import {
  Box,
  Dialog,
  Header,
  Icon,
  IconButton,
  Icons,
  Menu,
  MenuItem,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  PopOut,
  RectCords,
  Spinner,
  Text,
  as,
  color,
  config,
} from 'folds';
import React, { ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import FocusTrap from 'focus-trap-react';
import FileSaver from 'file-saver';
import { MatrixEvent, Room } from 'matrix-js-sdk';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { useRoomMembers } from '../../hooks/useRoomMembers';
import { stopPropagation } from '../../utils/keyboard';
import { assignElementRef } from '../../utils/react';
import { MindroomAiRunInfo, getMindroomAiRunInfo } from './aiRun';
import {
  MindroomAiRunContextBarSegment,
  formatMindroomAiRunNumber,
  formatMindroomAiRunTimeToFirstToken,
  getMindroomAiRunContextBarSegments,
  getMindroomAiRunContextCacheLabel,
  getMindroomAiRunContextLabel,
  getMindroomAiRunModelLabel,
  getMindroomAiRunUsageCacheLabel,
  getMindroomAiRunUsageLabel,
} from './aiRunDisplay';
import { MindroomLongTextSource, getMindroomLongTextSource } from './longText';
import { getMindroomLongTextDownloadName } from './longTextDownload';
import {
  downloadMindroomLongTextSidecarBlob,
  useMindroomLongTextResolvedContent,
} from './MindroomLongTextText';
import {
  buildMindroomDelegateMessageContent,
  getMindroomDelegateAgents,
  getMindroomDelegateOriginalBody,
  shouldShowMindroomDelegateAction,
} from './delegation';
import * as css from './MindroomMessageControls.css';

export function useMindroomMessageControls(content: Record<string, unknown>, menuOpen: boolean) {
  const longTextSource = useMemo(() => getMindroomLongTextSource(content), [content]);
  const resolvedLongTextContent = useMindroomLongTextResolvedContent(longTextSource, menuOpen);
  const longTextLoading = longTextSource !== undefined && resolvedLongTextContent === undefined;
  const aiRunInfo = getMindroomAiRunInfo(content);

  return {
    aiRunInfo,
    longTextLoading,
    longTextSource,
    resolvedLongTextContent,
  };
}

function MindroomAiRunDetail({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <Text size="T200">
      {label}: {value}
    </Text>
  );
}

const getMindroomAiRunContextBarSegmentClassName = (
  key: MindroomAiRunContextBarSegment['key']
): string => {
  if (key === 'cacheRead') {
    return `${css.AiRunContextBarSegment} ${css.AiRunContextBarSegmentCacheRead}`;
  }
  if (key === 'newInput') {
    return `${css.AiRunContextBarSegment} ${css.AiRunContextBarSegmentNewInput}`;
  }
  return `${css.AiRunContextBarSegment} ${css.AiRunContextBarSegmentReserve}`;
};

function MindroomAiRunContextBar({ info }: { info: MindroomAiRunInfo }) {
  const segments = getMindroomAiRunContextBarSegments(info);
  if (!segments) return null;

  return (
    <div className={css.AiRunContextBar} aria-label="Request context window">
      {segments.map((segment) => (
        <div
          key={segment.key}
          className={getMindroomAiRunContextBarSegmentClassName(segment.key)}
          style={{ width: `${segment.percentage}%` }}
          title={segment.title}
          aria-label={`${segment.label}: ${formatMindroomAiRunNumber(segment.tokens)} tokens`}
        />
      ))}
    </div>
  );
}

function MindroomAiRunInfoDialog({
  info,
  open,
  onClose,
  returnFocusRef,
}: {
  info: MindroomAiRunInfo;
  open: boolean;
  onClose: () => void;
  returnFocusRef: React.RefObject<HTMLElement | null>;
}) {
  const modelLabel = getMindroomAiRunModelLabel(info);
  const usageLabel = getMindroomAiRunUsageLabel(info);
  const usageCacheLabel = getMindroomAiRunUsageCacheLabel(info);
  const contextLabel = getMindroomAiRunContextLabel(info);
  const contextCacheLabel = getMindroomAiRunContextCacheLabel(info);
  const toolsLabel = formatMindroomAiRunNumber(info.toolCount);
  const ttftLabel = formatMindroomAiRunTimeToFirstToken(info.timeToFirstToken);

  return (
    <Overlay open={open} backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap
          focusTrapOptions={{
            initialFocus: false,
            setReturnFocus: () => returnFocusRef.current ?? false,
            onDeactivate: onClose,
            clickOutsideDeactivates: true,
            escapeDeactivates: stopPropagation,
          }}
        >
          <Dialog variant="Surface">
            <Header
              style={{
                padding: `0 ${config.space.S200} 0 ${config.space.S400}`,
                borderBottomWidth: config.borderWidth.B300,
              }}
              variant="Surface"
              size="500"
            >
              <Box grow="Yes">
                <Text size="H4">AI Run Metadata</Text>
              </Box>
              <IconButton size="300" onClick={onClose} radii="300" aria-label="Close">
                <Icon src={Icons.Cross} />
              </IconButton>
            </Header>
            <Box
              style={{ padding: config.space.S400, maxWidth: '24rem' }}
              direction="Column"
              gap="100"
            >
              <MindroomAiRunDetail label="Status" value={info.status} />
              <MindroomAiRunDetail label="Model" value={modelLabel} />
              <MindroomAiRunDetail label="Tokens" value={usageLabel} />
              <MindroomAiRunDetail label="Run Cache" value={usageCacheLabel} />
              <MindroomAiRunDetail label="Request Context" value={contextLabel} />
              <MindroomAiRunContextBar info={info} />
              <MindroomAiRunDetail label="Request Cache" value={contextCacheLabel} />
              <MindroomAiRunDetail label="Tools" value={toolsLabel} />
              <MindroomAiRunDetail label="TTFT" value={ttftLabel} />
              <MindroomAiRunDetail label="Run" value={info.runId} />
              <MindroomAiRunDetail label="Session" value={info.sessionId} />
            </Box>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}

export function MindroomAiRunInfoButton({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      className={css.AiRunInfoButton}
      aria-label="Open AI run metadata"
      aria-haspopup="dialog"
      aria-pressed={open}
      onClick={onOpen}
    >
      <Icon size="50" src={Icons.Info} />
    </button>
  );
}

export const MindroomAiRunMenuItem = as<
  'button',
  {
    onOpen: () => void;
  }
>(({ onOpen, ...props }, ref) => (
  <MenuItem
    size="300"
    after={<Icon size="100" src={Icons.Info} />}
    radii="300"
    onClick={onOpen}
    aria-haspopup="dialog"
    {...props}
    ref={ref}
  >
    <Text className={css.MenuItemText} as="span" size="T300" truncate>
      Token usage
    </Text>
  </MenuItem>
));

export type MindroomAiRunControlsRenderProps = {
  dialog: ReactNode;
  messageBaseRef: React.Ref<HTMLDivElement>;
  onOpen: () => void;
  open: boolean;
};

export function MindroomAiRunControls({
  info,
  forwardedRef,
  children,
}: {
  info: MindroomAiRunInfo;
  forwardedRef: React.Ref<HTMLDivElement> | undefined;
  children: (props: MindroomAiRunControlsRenderProps) => ReactNode;
}) {
  const messageBaseRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  const handleMessageBaseRef = useCallback(
    (node: HTMLDivElement | null) => {
      messageBaseRef.current = node;
      assignElementRef(forwardedRef, node);
    },
    [forwardedRef]
  );

  return children({
    dialog: (
      <MindroomAiRunInfoDialog
        info={info}
        open={open}
        onClose={() => setOpen(false)}
        returnFocusRef={messageBaseRef}
      />
    ),
    messageBaseRef: handleMessageBaseRef,
    onOpen: () => setOpen(true),
    open,
  });
}

export const MindroomDownloadOriginalMenuItem = as<
  'button',
  {
    source: MindroomLongTextSource;
    onClose?: () => void;
  }
>(({ source, onClose, ...props }, ref) => {
  const mx = useMatrixClient();
  const useAuthentication = useMediaAuthentication();

  const [downloadState, download] = useAsyncCallback(
    useCallback(async () => {
      const blob = await downloadMindroomLongTextSidecarBlob(mx, source, useAuthentication);
      FileSaver.saveAs(blob, getMindroomLongTextDownloadName(source));
      onClose?.();
    }, [mx, source, useAuthentication, onClose])
  );

  return (
    <MenuItem
      size="300"
      after={
        downloadState.status === AsyncStatus.Loading ? (
          <Spinner fill="Soft" size="100" />
        ) : (
          <Icon size="100" src={Icons.Download} />
        )
      }
      radii="300"
      onClick={download}
      aria-disabled={downloadState.status === AsyncStatus.Loading}
      {...props}
      ref={ref}
    >
      <Text className={css.MenuItemText} as="span" size="T300" truncate>
        {downloadState.status === AsyncStatus.Loading
          ? 'Downloading Original...'
          : 'Download Original'}
      </Text>
    </MenuItem>
  );
});

const getDelegateErrorMessage = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : 'Unable to delegate. Please try again.';

export function MindroomDelegateMenuItem({
  content,
  mEvent,
  onClose,
  room,
}: {
  content: Record<string, unknown>;
  mEvent: MatrixEvent;
  onClose?: () => void;
  room: Room;
}) {
  const mx = useMatrixClient();
  const [agentMenuAnchor, setAgentMenuAnchor] = useState<RectCords>();
  const [submittingAgentId, setSubmittingAgentId] = useState<string>();
  const [errorMessage, setErrorMessage] = useState<string>();
  const members = useRoomMembers(mx, room.roomId);
  const agents = useMemo(() => getMindroomDelegateAgents(members), [members]);
  const routerEventId = mEvent.getId() ?? undefined;
  const threadRootId = mEvent.threadRootId;
  const originalBody = getMindroomDelegateOriginalBody(content);
  const showDelegate = shouldShowMindroomDelegateAction({
    agents,
    content,
    eventId: routerEventId,
    senderId: mEvent.getSender() ?? undefined,
    threadRootId,
  });

  if (!showDelegate || !routerEventId || !threadRootId) return null;

  const handleOpenAgents = (evt: React.MouseEvent<HTMLButtonElement>) => {
    setErrorMessage(undefined);
    setAgentMenuAnchor(evt.currentTarget.getBoundingClientRect());
  };

  const handleDelegate = async (agentId: string) => {
    if (submittingAgentId) return;

    setErrorMessage(undefined);
    setSubmittingAgentId(agentId);

    try {
      await mx.sendMessage(
        room.roomId,
        buildMindroomDelegateMessageContent({
          originalBody,
          selectedAgentId: agentId,
          routerEventId,
          threadRootId,
        })
      );
      setAgentMenuAnchor(undefined);
      onClose?.();
    } catch (error) {
      setErrorMessage(getDelegateErrorMessage(error));
    } finally {
      setSubmittingAgentId(undefined);
    }
  };

  return (
    <PopOut
      anchor={agentMenuAnchor}
      position="Bottom"
      align={agentMenuAnchor?.width === 0 ? 'Start' : 'End'}
      offset={agentMenuAnchor?.width === 0 ? 0 : undefined}
      content={
        <Menu>
          <Box direction="Column" gap="100">
            {agents.map((agentId) => (
              <MenuItem
                key={agentId}
                size="300"
                after={
                  submittingAgentId === agentId ? (
                    <Spinner fill="Soft" size="100" />
                  ) : (
                    <Icon size="100" src={Icons.User} />
                  )
                }
                radii="300"
                onClick={() => {
                  void handleDelegate(agentId);
                }}
                aria-disabled={submittingAgentId !== undefined}
              >
                <Text className={css.MenuItemText} as="span" size="T300" truncate>
                  {agentId}
                </Text>
              </MenuItem>
            ))}
            {errorMessage && (
              <Box style={{ padding: config.space.S200 }}>
                <Text style={{ color: color.Critical.Main }} as="span" size="T200" priority="400">
                  {errorMessage}
                </Text>
              </Box>
            )}
          </Box>
        </Menu>
      }
    >
      <MenuItem
        size="300"
        after={<Icon size="100" src={Icons.User} />}
        radii="300"
        onClick={handleOpenAgents}
        aria-haspopup="menu"
        aria-pressed={agentMenuAnchor !== undefined}
      >
        <Text className={css.MenuItemText} as="span" size="T300" truncate>
          Delegate to
        </Text>
      </MenuItem>
    </PopOut>
  );
}
