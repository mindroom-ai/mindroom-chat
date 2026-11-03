import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import type { MatrixEvent, Room } from 'matrix-js-sdk';
import { Icon, Icons, Overlay, OverlayBackdrop, OverlayCenter, Text, type IconSrc } from 'folds';
import { MenuItem, Modal } from '../../components/glass/GlassPrimitives';
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
  const deactivateAndClose = () => {
    close();
    return true;
  };

  return (
    <>
      <Overlay backdrop={<OverlayBackdrop />} open={open}>
        <OverlayCenter>
          <FocusTrap
            focusTrapOptions={{
              returnFocusOnDeactivate: false,
              initialFocus: false,
              escapeDeactivates: deactivateAndClose,
              clickOutsideDeactivates: deactivateAndClose,
            }}
          >
            <Modal variant="Surface" size="500">
              {open && renderDialog(close)}
            </Modal>
          </FocusTrap>
        </OverlayCenter>
      </Overlay>
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

/** "View Source": the event as JSON. */
export function MessageSourceCodeItem({
  mEvent,
  onClose,
}: {
  room: Room;








      label={t('mindroomUi.messages.messageInspectionActions.viewSource')}
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
}: {
  room: Room;
  eventId: string;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <MenuDialogItem
      icon={Icons.CheckTwice}
      label={t('mindroomUi.messages.messageInspectionActions.readReceipts')}
      onClose={onClose}
      renderDialog={(requestClose) => (
        <EventReaders room={room} eventId={eventId} requestClose={requestClose} />
      )}
    />
  );
}
