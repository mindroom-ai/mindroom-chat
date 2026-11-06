import { Icon, IconButton, Icons, Tooltip, Text, config, toRem } from 'folds';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { TooltipProvider } from '../directional';
import { previousHistoryPathname } from '../../routes/historyStack';

export type PhoneBackButtonProps = (
  | {
      /** The section list this page was opened from. */
      to: string;
      /**
       * Other pages this page may have been opened from, such as a space's lobby: when the page
       * before this one is one of them, the chevron steps back to it instead of the list.
       */
      openedFrom?: string[];
    }
  | {
      /** Leaves the page another way, such as closing a thread. */
      onBack: () => void;
    }
) & {
  /** What the button says to screen readers and in its tooltip; "Back" when not given. */
  label?: string;
};

function BackChevron({ label, onBack }: { label: string; onBack: () => void }) {
  // A 44 px touch target that never shrinks beside a long title. Its start overhangs a page
  // header's start padding (S200 on a balanced PageHeader), so the chevron lands on the page's
  // content inset near the screen edge and the title follows right after it. The negative block
  // margins keep a header or banner row as tall as a 32 px button would make it, and no padding
  // leaves the whole target to the icon.
  const target = toRem(44);
  const targetStyle = {
    flexShrink: 0,
    width: target,
    height: target,
    padding: 0,
    marginInlineStart: `calc(-1 * ${config.space.S200})`,
    marginBlock: toRem(-6),
  };
  // At 32 px the chevron is as tall as the header's 24 px icons draw theirs, with a 2 px stroke
  // like the view switch's: an iOS back chevron, not a small arrow.
  const chevron = toRem(32);
  return (
    <TooltipProvider
      position="Bottom"
      offset={4}
      tooltip={
        <Tooltip>
          <Text size="T200">{label}</Text>
        </Tooltip>
      }
    >
      {(anchorRef) => (
        <IconButton
          ref={anchorRef}
          size="400"
          radii="300"
          variant="Surface"
          fill="None"
          aria-label={label}
          onClick={onBack}
          style={targetStyle}
        >
          <Icon
            src={Icons.ChevronLeft}
            style={{ width: chevron, height: chevron }}
            data-directional
          />
        </IconButton>
      )}
    </TooltipProvider>
  );
}

/** A pathname as one form, so an encoded and a decoded spelling of a path compare equal. */
const samePath = (left: string, right: string): boolean => {
  const normal = (path: string) => {
    const withSlash = path.endsWith('/') ? path : `${path}/`;
    try {
      return decodeURIComponent(withSlash);
    } catch {
      return withSlash;
    }
  };
  return normal(left) === normal(right);
};

type NavigateBackProps = { to: string; openedFrom?: string[]; label: string };

function NavigateBack({ to, openedFrom = [], label }: NavigateBackProps) {
  const navigate = useNavigate();
  // Back to the list, or to another page the page was opened from, steps back in history, so
  // the browser's own back then goes on from there instead of reopening the page. Opened from
  // elsewhere, the list takes the page's place in history.
  const onBack = () => {
    const previous = previousHistoryPathname();
    const cameFrom =
      previous !== undefined && [to, ...openedFrom].some((path) => samePath(previous, path));
    if (cameFrom) navigate(-1);
    else navigate(to, { replace: true });
  };
  return <BackChevron label={label} onBack={onBack} />;
}

/**
 * Leads a full-screen page on phones, where a section's list and its pages take turns on screen:
 * the chevron returns to the list, or leaves a thread. Wider screens show both side by side, so
 * it renders nothing there.
 */
export function PhoneBackButton(props: PhoneBackButtonProps) {
  const { t } = useTranslation();
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  if (!phone) return null;
  const label = props.label ?? t('mindroomUi.threads.mindroomRoomViewHeader.back');
  return 'to' in props ? (
    <NavigateBack to={props.to} openedFrom={props.openedFrom} label={label} />
  ) : (
    <BackChevron label={label} onBack={props.onBack} />
  );
}
