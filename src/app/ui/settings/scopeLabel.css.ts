import { style } from '@vanilla-extract/css';
import { config } from 'folds';

// An icon and its words on one line, as quiet as the description above them allows.
const iconBesideText = { display: 'inline-flex', alignItems: 'center' } as const;

/** The line under a setting that says where it applies. */
export const ScopeLabel = style({ ...iconBesideText, gap: config.space.S100, opacity: 0.8 });
