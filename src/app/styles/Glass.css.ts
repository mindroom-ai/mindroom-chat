import { ComplexStyleRule, createVar } from '@vanilla-extract/css';
import { RecipeVariants, recipe } from '@vanilla-extract/recipes';
import { ContainerColor, color } from 'folds';

const surfaceContainer = createVar();
const surfaceContainerLine = createVar();
const surfaceOnContainer = createVar();

const variantStyle = (variant: ContainerColor): ComplexStyleRule => ({
  vars: {
    [surfaceContainer]: color[variant].Container,
    [surfaceContainerLine]: color[variant].ContainerLine,
    [surfaceOnContainer]: color[variant].OnContainer,
  },
});

const overlayMaterial: ComplexStyleRule = {
  selectors: {
    '&&': {
      background: surfaceContainer,
      borderColor: surfaceContainerLine,
      color: surfaceOnContainer,
    },
  },
  '@supports': {
    '(backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))': {
      selectors: {
        '&&': {
          background: `linear-gradient(135deg, rgb(255 255 255 / 12%), transparent 42%), color-mix(in srgb, ${surfaceContainer} 76%, transparent)`,
          backdropFilter: 'blur(28px) saturate(145%)',
          WebkitBackdropFilter: 'blur(28px) saturate(145%)',
          boxShadow:
            '0 24px 80px rgb(0 0 0 / 24%), 0 8px 24px rgb(0 0 0 / 12%), inset 0 1px 0 rgb(255 255 255 / 18%)',
        },
      },
    },
  },
  '@media': {
    '(prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)': {
      selectors: {
        '&&&': {
          background: surfaceContainer,
          backgroundImage: 'none',
          borderColor: surfaceContainerLine,
          backdropFilter: 'none',
          WebkitBackdropFilter: 'none',
          color: surfaceOnContainer,
        },
      },
    },
  },
};

const materialSheen = (backgroundImage: string): ComplexStyleRule => ({
  '@supports': {
    '(backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))': {
      selectors: {
        '&&': { backgroundImage },
      },
    },
  },
  '@media': {
    '(prefers-reduced-transparency: reduce), (prefers-contrast: more), (forced-colors: active)': {
      selectors: {
        '&&&': {
          backgroundImage: 'none',
          backdropFilter: 'none',
          WebkitBackdropFilter: 'none',
        },
      },
    },
  },
});

export const glassSurface = recipe({
  base: [],
  variants: {
    level: {
      overlay: overlayMaterial,
      panel: materialSheen(
        'linear-gradient(145deg, rgb(255 255 255 / 11%), transparent 48%, rgb(0 0 0 / 4%))'
      ),
      control: materialSheen(
        'linear-gradient(145deg, rgb(255 255 255 / 13%), transparent 52%, rgb(0 0 0 / 5%))'
      ),
    },
    variant: {
      Background: variantStyle('Background'),
      Surface: variantStyle('Surface'),
      SurfaceVariant: variantStyle('SurfaceVariant'),
      Primary: variantStyle('Primary'),
      Secondary: variantStyle('Secondary'),
      Success: variantStyle('Success'),
      Warning: variantStyle('Warning'),
      Critical: variantStyle('Critical'),
    },
  },
  defaultVariants: {
    level: 'panel',
    variant: 'Surface',
  },
});

export type GlassSurfaceVariants = RecipeVariants<typeof glassSurface>;
