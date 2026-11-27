export const dispatchTransitionEnd = (element: HTMLElement, propertyName?: string): void => {
  element.dispatchEvent(
    new TransitionEvent('transitionend', propertyName ? { propertyName } : undefined)
  );
};

export const dispatchTransitionCancel = (element: HTMLElement, propertyName?: string): void => {
  element.dispatchEvent(
    new TransitionEvent('transitioncancel', propertyName ? { propertyName } : undefined)
  );
};

/** Dispatches `transitionend` for every active inline CSS transition on or under `root`. */
export const finishSwipeTransitions = (root: ParentNode = document.body): number => {
  const candidates: HTMLElement[] = [];
  if (root instanceof HTMLElement) candidates.push(root);
  root.querySelectorAll<HTMLElement>('*').forEach((element) => candidates.push(element));

  let count = 0;
  for (const element of candidates) {
    const transition = element.style.getPropertyValue('transition');
    if (!transition || transition === 'none') continue;
    for (const part of transition.split(/,(?![^(]*\))/)) {
      const propertyName = part.trim().split(/\s+/)[0];
      if (!propertyName) continue;
      count += 1;
      dispatchTransitionEnd(element, propertyName);
    }
  }
  return count;
};
