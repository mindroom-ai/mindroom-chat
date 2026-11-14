import { type ReactNode, useRef } from 'react';
import { Box, Text } from 'folds';
import { Dialog } from './glass/GlassPrimitives';
import { ModalLayer, type ModalLayerFocus } from './ModalLayer';
import * as css from './ActionDialog.css';

type ActionDialogProps = {
  /** The dialog's heading and accessible name. */
  label: string;
  onClose: () => void;
  /** While a request runs, Escape and outside clicks do nothing. */
  busy: boolean;
  /** Where focus starts; by default the first control. */
  initialFocus?: ModalLayerFocus['initialFocus'];
  children: ReactNode;
};

/**
 * A small titled dialog for an action that needs a confirmation, a reason or a text. It is never
 * taller than the window: what does not fit scrolls, first a part of the content that scrolls on
 * its own.
 */
export function ActionDialog({ label, onClose, busy, initialFocus, children }: ActionDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  return (
    <ModalLayer
      onClose={onClose}
      busy={busy}
      focus={{
        initialFocus,
        // With every control disabled the dialog itself keeps focus.
        fallbackFocus: () => dialogRef.current ?? document.body,
      }}
    >
      <Dialog
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: 'min(28rem, calc(100vw - 2rem))',
          maxHeight: 'calc(100dvh - 2rem)',
          padding: '1rem',
        }}
      >
        <Box className={css.Body} direction="Column" gap="300">
          <Text size="H4">{label}</Text>
          {children}
        </Box>
      </Dialog>
    </ModalLayer>
  );
}
