import { style, styleVariants } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

export const ModalSurface = style({
  display: 'flex',
  flexDirection: 'column',
  maxHeight: '85dvh',
  minHeight: 0,
  width: '100%',
});

export const ModalHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: config.space.S300,
  paddingBlock: config.space.S300,
  paddingInline: config.space.S400,
  borderBlockEnd: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  flexShrink: 0,
});

export const ModalBody = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S400,
  padding: config.space.S400,
  overflowY: 'auto',
  minHeight: 0,
});

export const ModalFooter = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  flexWrap: 'wrap',
  gap: config.space.S200,
  paddingBlock: config.space.S300,
  paddingInline: config.space.S400,
  borderBlockStart: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  flexShrink: 0,
});

export const StatusPill = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S100,
  paddingBlock: toRem(3),
  paddingInline: config.space.S200,
  borderRadius: config.radii.Pill,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  flexShrink: 0,
});

export const StatusPillTone = styleVariants({
  active: {
    backgroundColor: color.Success.Container,
    color: color.Success.OnContainer,
    border: `${config.borderWidth.B300} solid ${color.Success.ContainerLine}`,
  },
  waiting: {
    backgroundColor: color.Warning.Container,
    color: color.Warning.OnContainer,
    border: `${config.borderWidth.B300} solid ${color.Warning.ContainerLine}`,
  },
  neutral: {
    backgroundColor: color.SurfaceVariant.Container,
    color: color.SurfaceVariant.OnContainer,
    border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  },
  critical: {
    backgroundColor: color.Critical.Container,
    color: color.Critical.OnContainer,
    border: `${config.borderWidth.B300} solid ${color.Critical.ContainerLine}`,
  },
});

export const StatusDot = style({
  width: toRem(8),
  height: toRem(8),
  borderRadius: config.radii.Pill,
  flexShrink: 0,
});

export const StatusDotTone = styleVariants({
  active: { backgroundColor: color.Success.Main },
  waiting: { backgroundColor: color.Warning.Main },
  neutral: { backgroundColor: color.SurfaceVariant.OnContainer },
  critical: { backgroundColor: color.Critical.Main },
});

export const StatusBanner = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  paddingBlock: config.space.S200,
  paddingInline: config.space.S300,
  borderRadius: config.radii.R400,
});

export const StatusBannerTone = styleVariants({
  active: {
    backgroundColor: color.Success.Container,
    color: color.Success.OnContainer,
    border: `${config.borderWidth.B300} solid ${color.Success.ContainerLine}`,
  },
  waiting: {
    backgroundColor: color.Warning.Container,
    color: color.Warning.OnContainer,
    border: `${config.borderWidth.B300} solid ${color.Warning.ContainerLine}`,
  },
  critical: {
    backgroundColor: color.Critical.Container,
    color: color.Critical.OnContainer,
    border: `${config.borderWidth.B300} solid ${color.Critical.ContainerLine}`,
  },
});

export const DisclosureBox = style({
  padding: config.space.S300,
  borderRadius: config.radii.R400,
  backgroundColor: color.SurfaceVariant.Container,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
});

export const PermissionList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S200,
});

export const PermissionItem = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: config.space.S300,
  paddingBlock: config.space.S200,
  paddingInline: config.space.S300,
  borderRadius: config.radii.R400,
  backgroundColor: color.SurfaceVariant.Container,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  flexWrap: 'wrap',
});

export const SasCodeBox = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: config.space.S100,
  paddingBlock: config.space.S400,
  paddingInline: config.space.S300,
  borderRadius: config.radii.R400,
  backgroundColor: color.Background.Container,
  border: `${config.borderWidth.B300} solid ${color.Primary.ContainerLine}`,
});

export const SasCodeDigits = style({
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  fontSize: toRem(28),
  fontWeight: 700,
  letterSpacing: toRem(6),
  fontVariantNumeric: 'tabular-nums',
  userSelect: 'all',
});

export const AgentPickerButton = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: config.space.S300,
  width: '100%',
  paddingBlock: config.space.S300,
  paddingInline: config.space.S300,
  textAlign: 'start',
  font: 'inherit',
  color: 'inherit',
  cursor: 'pointer',
  borderRadius: config.radii.R400,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  backgroundColor: color.SurfaceVariant.Container,
  selectors: {
    '&:hover': {
      backgroundColor: color.SurfaceVariant.ContainerHover,
    },
    '&:focus-visible': {
      outline: `2px solid ${color.Primary.Main}`,
      outlineOffset: toRem(2),
    },
  },
});

export const LimitsSection = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S200,
  padding: config.space.S300,
  borderRadius: config.radii.R400,
  backgroundColor: color.SurfaceVariant.Container,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
});

export const LimitsOptionButton = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: config.space.S200,
  width: '100%',
  paddingBlock: config.space.S200,
  paddingInline: config.space.S300,
  textAlign: 'start',
  font: 'inherit',
  color: 'inherit',
  cursor: 'pointer',
  borderRadius: config.radii.R300,
  border: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  backgroundColor: color.Surface.Container,
  selectors: {
    '&:disabled': {
      opacity: 0.6,
      cursor: 'default',
    },
  },
});

export const LimitsOptionSelected = style({
  borderColor: color.Primary.Main,
  backgroundColor: color.Primary.Container,
  color: color.Primary.OnContainer,
});

export const ChecklistBox = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S100,
  maxHeight: toRem(180),
  overflowY: 'auto',
  padding: config.space.S200,
  borderRadius: config.radii.R300,
  backgroundColor: color.Surface.Container,
  border: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
});

export const ChecklistRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  paddingBlock: config.space.S100,
  paddingInline: config.space.S100,
  borderRadius: config.radii.R300,
  cursor: 'pointer',
});

export const FolderRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: config.space.S200,
  paddingBlock: config.space.S100,
  paddingInline: config.space.S200,
  borderRadius: config.radii.R300,
  backgroundColor: color.Surface.Container,
  border: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
});

export const CodeCopyBox = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  maxWidth: '100%',
  paddingBlock: config.space.S100,
  paddingInlineStart: config.space.S300,
  paddingInlineEnd: config.space.S100,
  borderRadius: config.radii.R300,
  backgroundColor: color.Background.Container,
  border: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
});

export const MonospaceText = style({
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  overflowWrap: 'anywhere',
});

export const ShellApprovalRoot = style({
  display: 'flex',
  flexDirection: 'column',
  minHeight: '100dvh',
  padding: config.space.S300,
  boxSizing: 'border-box',
  backgroundColor: color.Background.Container,
  color: color.Background.OnContainer,
});

export const ShellApprovalCard = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S300,
  flexGrow: 1,
  padding: config.space.S300,
  borderRadius: config.radii.R400,
  backgroundColor: color.Surface.Container,
  border: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
});

export const ShellApprovalHeader = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S100,
  minWidth: 0,
});

export const ShellApprovalSubtitle = style({
  minWidth: 0,
  overflowWrap: 'anywhere',
});

export const ShellCommandBox = style({
  margin: 0,
  padding: config.space.S200,
  borderRadius: config.radii.R300,
  backgroundColor: color.Background.Container,
  border: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  fontSize: toRem(12),
  lineHeight: 1.45,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  overflowY: 'auto',
  maxHeight: toRem(110),
  userSelect: 'text',
});
