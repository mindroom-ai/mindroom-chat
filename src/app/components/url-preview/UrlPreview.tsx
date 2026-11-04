import classNames from 'classnames';
import { Box, Text, as } from 'folds';
import { useGlassHighlight } from '../glass/liquid/useLiquidGlass';
import * as css from './UrlPreview.css';

/** A link preview card; the pointer highlight follows the cursor like other inline cards. */
export const UrlPreview = as<'div'>(({ className, ...cardProps }, forwardedRef) => {
  const highlightRef = useGlassHighlight<HTMLDivElement>(forwardedRef);
  const cardClass = classNames(css.UrlPreview, className);
  return <Box shrink="No" {...cardProps} className={cardClass} ref={highlightRef} />;
});

/** The preview's image; its class sizes it inside the card. */
export const UrlPreviewImg = as<'img'>(({ alt, className, ...imgProps }, ref) => {
  const imgClass = classNames(css.UrlPreviewImg, className);
  return <img alt={alt} {...imgProps} className={imgClass} ref={ref} />;
});

/** Title and description column beside the image. */
export const UrlPreviewContent = as<'div'>(({ className, ...contentProps }, ref) => {
  const contentClass = classNames(css.UrlPreviewContent, className);
  return <div {...contentProps} className={contentClass} ref={ref} />;
});

/** Secondary text under the title; callers may change its size or priority. */
export const UrlPreviewDescription = as<'p'>(({ className, ...textProps }, ref) => {
  const descriptionClass = classNames(css.UrlPreviewDescription, className);
  return <Text priority="300" size="T200" {...textProps} className={descriptionClass} ref={ref} />;
});
