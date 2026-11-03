import React, {
  useCallback,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
  type Ref,
} from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import type { MatrixEvent } from 'matrix-js-sdk';
import {
  Box,
  Icon,
  IconButton,
  Icons,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Spinner,
  Text,
} from 'folds';
import { PageScroll } from '../../components/page';
import { Dialog, Header, MenuItem } from '../../components/glass/GlassPrimitives';
import { glassDenseOverBackdrop } from '../../styles/Glass.css';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { saveFile } from '../native/nativeFileSave';
import { getMindroomAiRunInfo, type MindroomAiRunInfo } from './aiRun';
import { getMindroomLongTextSource, type MindroomLongTextSource } from './longText';
import {
  downloadMindroomLongTextSidecarBlob,
  getMindroomLongTextDownloadName,
} from './longTextDownload';
import { useMindroomLongTextResolvedContent } from './MindroomLongTextText';
import { MindroomReplyDetails } from './MindroomReplyDetails';
import * as css from './MindroomMessageControls.css';

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
  const aiRunInfo = useMemo(() => getMindroomAiRunInfo(content), [content]);
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
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const openDetails = useCallback(() => setOpen(true), []);
  const closeDetails = useCallback(() => setOpen(false), []);
  const controls = useMemo(
    () => ({ open, openDetails, closeDetails }),
    [open, openDetails, closeDetails]
  );
  const title = t('mindroomUi.messages.mindroomMessageControls.replyDetails');

  return (
    <>
      {children(controls)}
      <Overlay open={open} backdrop={<OverlayBackdrop />}>
        <OverlayCenter>
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              clickOutsideDeactivates: true,
              escapeDeactivates: true,
              onDeactivate: closeDetails,
              setReturnFocus: () => getRefElement(forwardedRef) ?? false,
            }}
          >
            <Dialog
              className={glassDenseOverBackdrop}
              variant="Background"
              role="dialog"
              aria-modal="true"
              aria-label={title}
              style={{ width: '28rem', maxWidth: 'calc(100vw - 24px)' }}
            >
              <PageScroll
                className={css.ReplyDetailsScroll}
                header={
                  <Header size="500" variant="Surface" style={{ padding: '0 12px' }}>
                    <Box grow="Yes" alignItems="Center">
                      <Text size="H4">{title}</Text>
                    </Box>
                    <IconButton
                      size="300"
                      aria-label={t('mindroomUi.messages.mindroomMessageControls.close')}
                      onClick={closeDetails}
                    >
                      <Icon src={Icons.Cross} />
                    </IconButton>
                  </Header>
                }
              >
                <MindroomReplyDetails info={info} eventId={eventId} />
              </PageScroll>
            </Dialog>
          </FocusTrap>
        </OverlayCenter>
      </Overlay>
    </>
  );
}

/** The small "i" beside the sender name of an agent reply. */
export function MindroomAiRunInfoButton({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className={css.AiRunInfoButton}
      aria-label={t('mindroomUi.messages.mindroomMessageControls.replyDetails')}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={onOpen}
    >
      <Icon size="50" src={Icons.Info} />
    </button>
  );
}

export function MindroomAiRunMenuItem({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <MenuItem
      size="300"
      radii="300"
      after={<Icon size="100" src={Icons.Info} />}
      aria-haspopup="dialog"
      onClick={onOpen}
    >
      <Text className={css.MenuItemText} as="span" size="T300" truncate>
        {t('mindroomUi.messages.mindroomMessageControls.replyDetails')}
      </Text>
    </MenuItem>
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
    <MenuItem
      size="300"
      radii="300"
      variant={state === 'failed' ? 'Critical' : undefined}
      after={
        state === 'saving' ? (
          <Spinner size="100" variant="Secondary" />
        ) : (
          <Icon size="100" src={state === 'failed' ? Icons.Warning : Icons.Download} />
        )
      }
      aria-busy={state === 'saving'}
      onClick={() => {
        void handleClick();
      }}
    >
      <Text className={css.MenuItemText} as="span" size="T300" truncate>
        {label}
      </Text>
    </MenuItem>
  );
}
