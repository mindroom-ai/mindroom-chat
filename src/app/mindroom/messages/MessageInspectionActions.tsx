import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { Icon, Icons, Text, type IconSrc } from 'folds';
import { MenuItem, Modal } from '../../components/glass/GlassPrimitives';
import { ModalLayer } from '../../components/ModalLayer';
import { TextViewer } from '../../components/text-viewer';
import { EventReaders } from '../../components/event-readers';
import * as css from '../../features/room/message/styles.css';

type MenuDialogItemProps = {
  icon: IconSrc;
  label: string;
  onClose?: () => void;
  renderDialog: (requestClose: () => void) => React.ReactNode;
};

/** A message menu item that opens a modal; closing the modal also closes the menu. */
function MenuDialogItem({ icon, label, onClose, renderDialog }: MenuDialogItemProps) {
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
        <Modal variant="Surface" size="500">
          {open && renderDialog(close)}
        </Modal>
      </ModalLayer>
      <MenuItem
        size="300"
        radii="300"
        after={<Icon size="100" src={icon} />}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Text className={css.MessageMenuItemText} as="span" size="T300" truncate>
          {label}
        </Text>
      </MenuItem>
    </>
  );
}

/** The raw event JSON; an encrypted event shows its decrypted form too, an edited one its edit. */
const getEventSource = (mEvent: MatrixEvent): string => {
  const source: Record<string, unknown> = mEvent.isEncrypted()
    ? { encrypted: mEvent.event, decrypted: mEvent.getEffectiveEvent?.() }
    : { ...mEvent.event };
  const edit = mEvent.replacingEvent();
  const text = JSON.stringify(source, null, 2);
  if (!edit) return text;
  return `${text}\n\n${JSON.stringify(
    edit.isEncrypted() ? edit.getEffectiveEvent() : edit.event,
    null,
    2
  )}`;
};

/** What every inspection menu item gets from the message menu. */
type InspectionItemProps = {
  room: Room;
  onClose?: () => void;
};

/** "View Source": the event as JSON. */
export function MessageSourceCodeItem({
  mEvent,
  onClose,
}: InspectionItemProps & { mEvent: MatrixEvent }) {
  const { t } = useTranslation();
  // The JSON is built when the dialog renders, so it shows the event's current decryption and edit.
  return (
    <MenuDialogItem
      label={t('mindroomUi.messages.messageInspectionActions.viewSource')}
      icon={Icons.BlockCode}
      onClose={onClose}
      renderDialog={(requestClose) => (
        <TextViewer
          name={t('sharedUi.welcomePage.sourceCode')}
          langName="json"
          text={getEventSource(mEvent)}
          requestClose={requestClose}
        />
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
  return (
    <MenuDialogItem
      label={t('mindroomUi.messages.messageInspectionActions.readReceipts')}
      icon={Icons.CheckTwice}
      onClose={onClose}
      renderDialog={(requestClose) => (
        <EventReaders room={room} eventId={eventId} requestClose={requestClose} />
      )}
    />
  );
}
