import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
  type Ref,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { MatrixEvent } from 'matrix-js-sdk';
import { Box, Icon, IconButton, Icons, Spinner, Text } from 'folds';
import { PageScroll } from '../ui/page/PageScroll';
import { Dialog, Header } from '../ui/glass/GlassPrimitives';
import { MenuEntry } from '../ui/MenuEntry';
import { ModalLayer } from '../ui/ModalLayer';
import { glassDenseOverBackdrop } from '../ui/styles/Glass.css';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { saveFile } from '../native/nativeFileSave';
import { getMindroomAiRunInfo, type MindroomAiRunInfo } from '../matrix/protocol/aiRun';
import { getMindroomLongTextSource, type MindroomLongTextSource } from '../matrix/protocol/longText';
import {
  downloadMindroomLongTextSidecarBlob,
  getMindroomLongTextDownloadName,
} from './content/longTextDownload';
import { useMindroomLongTextResolvedContent } from './content/LongTextText';
import { MindroomReplyDetails } from './reply/ReplyDetails';
import { isMindroomAgentUserIdForViewer } from '../matrix/protocol/agentIdentity';
import * as css from './MessageControls.css';

/** What a message hands to its header and menu so both open the same reply details. */
export type MindroomAiRunControlsRenderProps = {
  open: boolean;
  openDetails: () => void;
  closeDetails: () => void;
};

/**
 * MindRoom state of one message for its controls: the reply's run metadata and, for a reply
 * whose text overflowed into a sidecar file, that file (loaded while the menu is open, so Copy
 * Text copies the whole reply).
 */
export const useMindroomMessageControls = (
  content: Record<string, unknown>,
  menuOpen: boolean,
  mEvent?: MatrixEvent
) => {
  const viewerId = useMatrixClient().getUserId() ?? undefined;
  const sender = mEvent?.getSender();
  const aiRunInfo = useMemo(() => {
    const info = getMindroomAiRunInfo(content);
    // Anyone can write the run keys; a cost counts only from MindRoom's own accounts.
    if (!info || info.costUsd === undefined) return info;
    return isMindroomAgentUserIdForViewer(sender, viewerId)
      ? info
      : { ...info, costUsd: undefined };
  }, [content, sender, viewerId]);
  const longTextSource = useMemo(() => getMindroomLongTextSource(content), [content]);
  const resolvedLongTextContent = useMindroomLongTextResolvedContent(longTextSource, menuOpen);

  return {
    aiRunInfo,
    eventId: mEvent?.getId(),
    longTextSource,
    resolvedLongTextContent,
    longTextLoading: !!longTextSource && menuOpen && resolvedLongTextContent === undefined,
  };
};

const getRefElement = (ref: Ref<HTMLDivElement> | undefined): HTMLElement | null => {
  if (!ref || typeof ref === 'function') return null;
  return (ref as MutableRefObject<HTMLDivElement | null>).current;
};

/** The dialog's title, which both of its triggers also carry as their name. */
const useReplyDetailsLabel = (): string =>
  useTranslation().t('mindroomUi.messages.mindroomMessageControls.replyDetails');

/** Title on the left, a close button on the right; stays put while the details scroll. */
function ReplyDetailsHeader({
  title,
  onClose,
  closeRef,
}: {
  title: string;
  onClose: () => void;
  closeRef: Ref<HTMLButtonElement>;
}) {
  const { t } = useTranslation();
  const closeLabel = t('mindroomUi.messages.mindroomMessageControls.close');
  return (
    <Header variant="Surface" size="500" style={{ paddingInline: 12, paddingBlock: 0 }}>
      <Box alignItems="Center" grow="Yes">
        <Text size="H4">{title}</Text>
      </Box>
      <IconButton ref={closeRef} onClick={onClose} aria-label={closeLabel} size="300">
        <Icon src={Icons.Cross} />
      </IconButton>
    </Header>
  );
}

type MindroomAiRunControlsProps = {
  info: MindroomAiRunInfo;
  eventId?: string;
  /** The message element; focus returns there when the dialog closes. */
  forwardedRef?: Ref<HTMLDivElement>;
  children: (controls: MindroomAiRunControlsRenderProps) => ReactNode;
};

/** Owns the Reply details dialog of an agent reply; the children render its triggers. */
export function MindroomAiRunControls({
  info,
  eventId,
  forwardedRef,
  children,
}: MindroomAiRunControlsProps) {
  const [open, setOpen] = useState(false);
  const openDetails = useCallback(() => setOpen(true), []);
  const closeDetails = useCallback(() => setOpen(false), []);
  const controls = useMemo(
    () => ({ open, openDetails, closeDetails }),
    [open, openDetails, closeDetails]
  );
  const title = useReplyDetailsLabel();
  // The dialog opens with focus on Close, so Escape, Enter or Space can dismiss it at once.
  const closeRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      {children(controls)}
      <ModalLayer
        open={open}
        onClose={closeDetails}
        focus={{
          initialFocus: () => closeRef.current ?? false,
          setReturnFocus: () => getRefElement(forwardedRef) ?? false,
        }}
      >
        <Dialog
          className={glassDenseOverBackdrop}
          variant="Background"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          // As wide as the details, which set their own width for desktop and phone.
          style={{ width: 'fit-content', maxWidth: 'calc(100vw - 24px)' }}
        >
          <PageScroll
            header={<ReplyDetailsHeader title={title} onClose={closeDetails} closeRef={closeRef} />}
            className={css.ReplyDetailsScroll}
          >
            <MindroomReplyDetails info={info} eventId={eventId} />
          </PageScroll>
        </Dialog>
      </ModalLayer>
    </>
  );
}

/** The small "i" beside the sender name of an agent reply. */
export function MindroomAiRunInfoButton(props: { open: boolean; onOpen: () => void }) {
  const label = useReplyDetailsLabel();
  const info = <Icon size="50" src={Icons.Info} />;
  return (
    <button
      aria-label={label}
      aria-expanded={props.open}
      aria-haspopup="dialog"
      className={css.AiRunInfoButton}
      onClick={props.onOpen}
      type="button"
    >
      {info}
    </button>
  );
}

/** "Reply details" in the message menu of an agent reply. */
export function MindroomAiRunMenuItem(props: { onOpen: () => void }) {
  const label = useReplyDetailsLabel();
  return (
    <MenuEntry label={label} icon={Icons.Info} aria-haspopup="dialog" onSelect={props.onOpen} />
  );
}

type DownloadState = 'idle' | 'saving' | 'failed';

/**
 * Save the sidecar file holding the full text of a long reply. A failed save offers a retry that
 * reuses the downloaded file; a cancelled native save picker leaves the menu open.
 */
export function MindroomDownloadOriginalMenuItem({
  source,
  onClose,
}: {
  source: MindroomLongTextSource;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const [state, setState] = useState<DownloadState>('idle');
  const activeRef = useRef(false);
  const blobRef = useRef<{ source: MindroomLongTextSource; blob: Blob }>();

  const handleClick = async () => {
    if (activeRef.current) return;
    activeRef.current = true;
    setState('saving');
    try {
      let blob = blobRef.current?.source === source ? blobRef.current.blob : undefined;
      if (!blob) {
        blob = await downloadMindroomLongTextSidecarBlob(mx, source, true);
        blobRef.current = { source, blob };
      }
      const saved = await saveFile(blob, getMindroomLongTextDownloadName(source));
      setState('idle');
      if (saved) onClose?.();
    } catch {
      setState('failed');
    } finally {
      activeRef.current = false;
    }
  };

  const label =
    state === 'failed'
      ? t('mindroomUi.messages.mindroomMessageControls.retryDownloadOriginal')
      : t('mindroomUi.messages.mindroomMessageControls.downloadOriginal');

  return (
    <MenuEntry
      label={label}
      icon={state === 'failed' ? Icons.Warning : Icons.Download}
      critical={state === 'failed'}
      after={state === 'saving' ? <Spinner size="100" variant="Secondary" /> : undefined}
      aria-busy={state === 'saving'}
      onSelect={() => {
        void handleClick();
      }}
    />
  );
}
