/** Corner radius, in px, of a phone's navigation drawer and members sheet over the page. */
export const PHONE_SHEET_RADIUS = 28;

/** An element's corner radii in px: top-left, top-right, bottom-right, bottom-left. */
export const cornersOf = (element: Element): number[] => {
  const style = getComputedStyle(element);
  return [
    style.borderTopLeftRadius,
    style.borderTopRightRadius,
    style.borderBottomRightRadius,
    style.borderBottomLeftRadius,
  ].map((radius) => parseFloat(radius));
};

/** An element's border widths in px: top, right, bottom, left. */
export const borderWidthsOf = (element: Element): number[] => {
  const style = getComputedStyle(element);
  return [
    style.borderTopWidth,
    style.borderRightWidth,
    style.borderBottomWidth,
    style.borderLeftWidth,
  ].map((width) => parseFloat(width));
};
