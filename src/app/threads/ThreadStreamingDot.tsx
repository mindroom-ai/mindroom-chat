import { useEffect, useRef, type ComponentProps } from 'react';
import { usePaneCollapsed } from '../lib/hooks/usePaneCollapsed';
import { observeElementVisibility } from '../lib/hooks/usePauseWhenHidden';
import * as css from '../messages/ThreadIndicator.css';

type ThreadStreamingDotProps = Pick<ComponentProps<'span'>, 'role' | 'aria-label' | 'aria-hidden'>;

export function ThreadStreamingDot(props: ThreadStreamingDotProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const collapsed = usePaneCollapsed();
  useEffect(() => {
    const dot = ref.current;
    if (!dot) return undefined;
    if (collapsed) {
      dot.style.animationPlayState = 'paused';
      return undefined;
    }
    return observeElementVisibility(dot, (visible) => {
      dot.style.animationPlayState = visible ? 'running' : 'paused';
    });
  }, [collapsed]);

  return <span {...props} ref={ref} className={css.ThreadStreamingDot} />;
}
