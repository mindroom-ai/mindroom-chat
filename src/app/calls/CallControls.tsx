import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import {
  Box,
  Icon,
  IconButton,
  Icons,
  Line,
  Text,
  Tooltip,
  type IconSrc,
  type RectCords,
} from 'folds';
import { PopOut, TooltipProvider } from '../ui/directional';
import { Menu, MenuItem } from '../ui/glass/GlassPrimitives';
import type { CallDeviceKind, CallDevices } from './RoomCall';
import * as css from './CallPanel.css';

type ControlProps = {
  label: string;
  /** Its state, such as who paused, in its tooltip instead of its name and to screen readers. */
  description?: string;
  icon: IconSrc;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  /** Silenced audio (a muted microphone, sound off) is tinted red so nobody talks unheard. */
  off?: boolean;
  critical?: boolean;
  /** Something everyone in the call should know of, such as the transcript paused. */
  warning?: boolean;
  pressed?: boolean;
  expanded?: boolean;
  disabled?: boolean;
  /** Smaller, for a panel's header. */
  small?: boolean;
};

/** A round call control that names itself in a tooltip. */
export function CallControl({
  label,
  description,
  icon,
  onClick,
  off,
  critical,
  warning,
  pressed,
  expanded,
  disabled,
  small,
}: ControlProps) {
  let variant: 'Critical' | 'Warning' | 'SurfaceVariant' = 'SurfaceVariant';
  if (critical || off) variant = 'Critical';
  else if (warning) variant = 'Warning';
  return (
    <TooltipProvider
      position="Top"
      offset={4}
      tooltip={
        <Tooltip>
          <Text size="T200">{description ?? label}</Text>
        </Tooltip>
      }
    >
      {(anchorRef) => (
        <IconButton
          ref={anchorRef}
          size={small ? '300' : '500'}
          radii="Pill"
          variant={variant}
          fill="Soft"
          className={critical ? css.EndControl : undefined}
          aria-label={label}
          aria-description={description}
          aria-pressed={pressed}
          aria-expanded={expanded}
          aria-haspopup={expanded === undefined ? undefined : 'menu'}
          disabled={disabled}
          onClick={onClick}
        >
          <Icon size={small ? '200' : '400'} src={icon} />
        </IconButton>
      )}
    </TooltipProvider>
  );
}

type DeviceList = Record<CallDeviceKind, MediaDeviceInfo[]>;
const NO_DEVICES: DeviceList = { audioinput: [], videoinput: [], audiooutput: [] };

/** The browser's microphones, cameras and speakers; names appear once a device was allowed. */
export const useMediaDevices = (enabled: boolean): DeviceList => {
  const [devices, setDevices] = useState<DeviceList>(NO_DEVICES);
  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!enabled || !media?.enumerateDevices) return undefined;
    let active = true;
    const read = () => {
      media
        .enumerateDevices()
        .then((list) => {
          if (!active) return;
          setDevices({
            audioinput: list.filter((device) => device.kind === 'audioinput'),
            videoinput: list.filter((device) => device.kind === 'videoinput'),
            audiooutput: list.filter((device) => device.kind === 'audiooutput'),
          });
        })
        .catch(() => undefined);
    };
    read();
    media.addEventListener?.('devicechange', read);
    return () => {
      active = false;
      media.removeEventListener?.('devicechange', read);
    };
  }, [enabled]);
  return devices;
};

const DEVICE_KINDS: CallDeviceKind[] = ['audioinput', 'videoinput', 'audiooutput'];
const DEVICE_LABEL_KEYS = {
  audioinput: 'featureUi.calls.devices.microphone',
  videoinput: 'featureUi.calls.devices.camera',
  audiooutput: 'featureUi.calls.devices.speaker',
} as const;

type DeviceMenuProps = {
  chosen: CallDevices;
  onChoose: (kind: CallDeviceKind, deviceId: string) => void;
  requestClose: () => void;
};

/**
 * Picks the microphone, camera and speaker; a browser that cannot route audio has no speakers.
 * The ref reaches the menu, which the focus trap around it needs.
 */
const DeviceMenu = forwardRef<HTMLDivElement, DeviceMenuProps>(function DeviceMenu(
  { chosen, onChoose, requestClose },
  ref
) {
  const { t } = useTranslation();
  const devices = useMediaDevices(true);
  const kinds = DEVICE_KINDS.filter((kind) => devices[kind].length > 0);
  return (
    // Focusable itself, so the focus trap has a place while the browser still lists the devices.
    <Menu
      ref={ref}
      role="menu"
      tabIndex={-1}
      className={css.DeviceMenu}
      aria-label={t('featureUi.calls.devices.title')}
    >
      {kinds.map((kind, kindIndex) => {
        // The system default comes first; a device not chosen yet follows it.
        const selected = chosen[kind] ?? devices[kind][0]?.deviceId;
        return (
          <Box key={kind} direction="Column" role="group" aria-labelledby={`call-devices-${kind}`}>
            {kindIndex > 0 && <Line size="300" />}
            <Text
              id={`call-devices-${kind}`}
              className={css.DeviceGroupLabel}
              size="L400"
              priority="300"
            >
              {t(DEVICE_LABEL_KEYS[kind])}
            </Text>
            <Box direction="Column" gap="100" style={{ padding: '0 4px 4px' }}>
              {devices[kind].map((device, index) => {
                const checked = device.deviceId === selected;
                const name =
                  device.label ||
                  (device.deviceId === 'default'
                    ? t('featureUi.calls.devices.systemDefault')
                    : t('featureUi.calls.devices.unnamed', {
                        kind: t(DEVICE_LABEL_KEYS[kind]),
                        number: index + 1,
                      }));
                return (
                  <MenuItem
                    key={device.deviceId || `${kind}-${index}`}
                    size="300"
                    radii="300"
                    role="menuitemradio"
                    aria-checked={checked}
                    variant={checked ? 'Primary' : 'Surface'}
                    fill={checked ? 'Soft' : 'None'}
                    after={checked ? <Icon size="100" src={Icons.Check} /> : undefined}
                    onClick={() => {
                      onChoose(kind, device.deviceId);
                      requestClose();
                    }}
                  >
                    <Text as="span" size="T300" align="Left" truncate style={{ flexGrow: 1 }}>
                      {name}
                    </Text>
                  </MenuItem>
                );
              })}
            </Box>
          </Box>
        );
      })}
    </Menu>
  );
});

/** The settings control: opens the device menu above itself. */
export function DeviceControl({
  chosen,
  onChoose,
}: {
  chosen: CallDevices;
  onChoose: (kind: CallDeviceKind, deviceId: string) => void;
}) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<RectCords>();
  const menuRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setAnchor(undefined), []);
  return (
    <>
      <CallControl
        label={t('featureUi.call.callControls.settings')}
        icon={Icons.Setting}
        expanded={!!anchor}
        onClick={(event) => {
          const { x, y, width, height } = event.currentTarget.getBoundingClientRect();
          setAnchor((current) => (current ? undefined : { x, y, width, height }));
        }}
      />
      <PopOut
        anchor={anchor}
        position="Top"
        align="Center"
        offset={8}
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              fallbackFocus: () => menuRef.current ?? document.body,
              returnFocusOnDeactivate: true,
              clickOutsideDeactivates: () => {
                close();
                return true;
              },
              escapeDeactivates: () => {
                close();
                return true;
              },
            }}
          >
            <DeviceMenu ref={menuRef} chosen={chosen} onChoose={onChoose} requestClose={close} />
          </FocusTrap>
        }
      />
    </>
  );
}
