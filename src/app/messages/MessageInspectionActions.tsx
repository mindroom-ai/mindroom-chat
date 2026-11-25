import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { Icons, type IconSrc } from 'folds';
import { Modal, type SurfaceAppearance } from '../ui/glass/GlassPrimitives';
import { MenuEntry } from '../ui/MenuEntry';
import { ModalLayer } from '../ui/ModalLayer';
import { EventSourceViewer } from './viewers/EventSourceViewer';
import { EventReaders } from './EventReaders';

type MenuDialogItemProps = {
  icon: IconSrc;
  label: string;
  /** The dialog's accessible name. */
  dialogLabel: string;
  modalAppearance?: SurfaceAppearance;
  onClose?: () => void;
  renderDialog: (requestClose: () => void) => React.ReactNode;
};

/** A message menu item that opens a modal; closing the modal also closes the menu. */
function MenuDialogItem({
  icon,
  label,
  dialogLabel,
  modalAppearance,
  onClose,
  renderDialog,
}: MenuDialogItemProps) {
  const [open, setOpen] = useState(false);
  // Leaving the dialog also dismisses the menu that opened it.
  const close = () => {
    onClose?.();
    setOpen(false);
  };

  return (
    <>
      <ModalLayer
        open={open}
        onClose={close}
        focus={{ initialFocus: false, returnFocusOnDeactivate: false }}
      >
        <Modal
          variant="Surface"
          size="500"
          appearance={modalAppearance}
          role="dialog"
          aria-modal="true"
          aria-label={dialogLabel}
        >
          {open && renderDialog(close)}
        </Modal>
      </ModalLayer>
      <MenuEntry label={label} icon={icon} aria-haspopup="dialog" onSelect={() => setOpen(true)} />
    </>
  );
}

/** What every inspection menu item gets from the message menu. */
type InspectionItemProps = {
  room: Room;
  onClose?: () => void;
};

/** "View Source": the event as an interactive JSON source viewer. */
export function MessageSourceCodeItem({
  mEvent,
  onClose,
}: InspectionItemProps & { mEvent: MatrixEvent }) {
  const { t } = useTranslation();
  const sourceCode = t('sharedUi.welcomePage.sourceCode');
  return (
    <MenuDialogItem
      label={t('mindroomUi.messages.messageInspectionActions.viewSource')}
      dialogLabel={sourceCode}
      modalAppearance="plain"
      icon={Icons.BlockCode}
      onClose={onClose}
      renderDialog={(requestClose) => (
        <EventSourceViewer name={sourceCode} mEvent={mEvent} requestClose={requestClose} />
      )}
    />
  );
}

/** "Read receipts": who has read up to this event. */
export function MessageReadReceiptItem({
  room,
  eventId,
  onClose,
}: InspectionItemProps & { eventId: string }) {
  const { t } = useTranslation();
  const readReceipts = t('mindroomUi.messages.messageInspectionActions.readReceipts');
  return (
    <MenuDialogItem
      label={readReceipts}
      dialogLabel={readReceipts}
      icon={Icons.CheckTwice}
      onClose={onClose}
      renderDialog={(requestClose) => (
        <EventReaders room={room} eventId={eventId} requestClose={requestClose} />
      )}
    />
  );
}
