import { Icon, IconButton, Icons, Tooltip, Text, config, toRem } from 'folds';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ScreenSize, useScreenSizeContext } from '../../hooks/useScreenSize';
import { TooltipProvider } from '../directional';

export type PhoneBackButtonProps = (
  | {
      /** The section list this page was opened from. */
      to: string;
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

function NavigateBack({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate();
  return <BackChevron label={label} onBack={() => navigate(to)} />;
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
    <NavigateBack to={props.to} label={label} />
  ) : (
    <BackChevron label={label} onBack={props.onBack} />
  );
}
