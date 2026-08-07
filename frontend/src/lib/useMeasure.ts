import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Width from a ResizeObserver, so the SVG is responsive without a chart library.
 *
 * The ref is a *callback* ref rather than a useRef + useEffect pair: a component
 * that returns early (empty state, loading) before mounting the measured node
 * would otherwise run its effect against a null ref and never observe anything,
 * leaving the chart stuck at its fallback width once the data arrives.
 */
export function useMeasure<T extends HTMLElement>() {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const node = useRef<T | null>(null);

  useEffect(() => () => observer.current?.disconnect(), []);

  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    node.current = el;
    if (!el) return;

    setWidth(el.getBoundingClientRect().width);
    observer.current = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    observer.current.observe(el);
  }, []);

  return { ref, width };
}
