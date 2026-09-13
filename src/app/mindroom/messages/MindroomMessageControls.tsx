import {
  Box,
  Dialog,
  Header,
  Icon,
  IconButton,
  Icons,
  MenuItem,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Spinner,
  Text,
  as,
  config,
} from 'folds';
import React, { ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import FocusTrap from 'focus-trap-react';
import FileSaver from 'file-saver';
import { AsyncStatus, useAsyncCallback } from '../../hooks/useAsyncCallback';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useMediaAuthentication } from '../../hooks/useMediaAuthentication';
import { stopPropagation } from '../../utils/keyboard';
import { assignElementRef } from '../../utils/react';
import { MindroomAiRunInfo, getMindroomAiRunInfo } from './aiRun';
import {
  formatMindroomAiRunNumber,
  formatMindroomAiRunTimeToFirstToken,
  getMindroomAiRunContextLabel,
  getMindroomAiRunModelLabel,
  getMindroomAiRunUsageLabel,
} from './aiRunDisplay';
import {
  MindroomLongTextSource,
  getMindroomLongTextSource,
} from './longText';
import { getMindroomLongTextDownloadName } from './longTextDownload';
import {
  downloadMindroomLongTextSidecarBlob,
  useMindroomLongTextResolvedContent,
} from './MindroomLongTextText';
import * as css from './MindroomMessageControls.css';

export function useMindroomMessageControls(
  content: Record<string, unknown>,
  menuOpen: boolean
) {
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
  const contextLabel = getMindroomAiRunContextLabel(info);
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
              <MindroomAiRunDetail label="Request Context" value={contextLabel} />
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

export function MindroomAiRunInfoButton({
  open,
  onOpen,
}: {
  open: boolean;
  onOpen: () => void;
}) {
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
