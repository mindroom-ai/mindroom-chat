import React, { ChangeEventHandler, FormEventHandler, useState } from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import {
  Box,
  Button,
  Icon,
  Icons,
  Input,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Text,
  color,
  config,
} from 'folds';
import { Dialog, Header, IconButton } from '../glass/GlassPrimitives';
import { parseMatrixToRoom, parseMatrixToRoomEvent } from '../../plugins/matrix-to';
import { isRoomAlias, isRoomId } from '../../utils/matrix';
import { stopPropagation } from '../../utils/keyboard';

type JoinAddress = {
  roomIdOrAlias: string;
  viaServers?: string[];
  eventId?: string;
};

/** Reads what the user typed as a room alias, a room ID, or a matrix.to link to a room or event. */
export const parseJoinAddress = (value: string): JoinAddress | undefined => {
  const address = value.trim();
  if (isRoomAlias(address) || isRoomId(address)) return { roomIdOrAlias: address };
  const event = parseMatrixToRoomEvent(address);
  if (event) return event;
  return parseMatrixToRoom(address);
};

const EXAMPLE_ADDRESSES = [
  '#community:server',
  'https://matrix.to/#/#community:server',
  'https://matrix.to/#/!xYzAj?via=server',
];

type JoinAddressPromptProps = {






  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);

  const handleChange: ChangeEventHandler<HTMLInputElement> = (evt) => {
    setValue(evt.target.value);





    const address = parseJoinAddress(value);
    if (!address) {
      setInvalid(true);
      return;
    }












































                  {EXAMPLE_ADDRESSES.map((example) => (
                    <Text as="li" key={example} size="T200" priority="300">
                      <i>{example}</i>
                    </Text>
                  ))}
                </Box>
              </Box>
              <Box direction="Column" gap="100">
                <Text as="label" htmlFor="join-address-input" size="L400">
                  {t('sharedUi.joinAddressPrompt.address')}
                </Text>
                <Input
                  id="join-address-input"
                  name="addressInput"
                  value={value}
                  onChange={handleChange}
                  variant="Background"
                  size="500"
                  radii="300"
                  autoComplete="off"
                  autoFocus
                  required
                  aria-invalid={invalid}
                />
                {invalid && (
                  <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
                    <b>{t('sharedUi.joinAddressPrompt.invalidAddress')}</b>
                  </Text>
                )}
              </Box>
              <Button type="submit" variant="Primary" size="500">
                <Text size="B500">{t('sharedUi.joinAddressPrompt.open')}</Text>
              </Button>
            </Box>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
