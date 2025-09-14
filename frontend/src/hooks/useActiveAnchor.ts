import { useEffect, useState } from 'react';

/**
 * Observe a list of anchor elements inside a scroll container and
 * return the id of the anchor that is closest to the top (in view).
 */
export function useActiveAnchor(
  container: React.RefObject<HTMLElement>,
  anchorIds: string[]
) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const rootEl = container.current;
    if (!rootEl || anchorIds.length === 0) return;

    const anchors = anchorIds
      .map((id) => document.getElementById(`diff-${id}`))
      .filter(Boolean) as HTMLElement[];
    if (anchors.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Find entry with the smallest root boundingClientRect top distance (visible)
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          const id = visible[0].target.getAttribute('data-anchor-id');
          if (id) setActiveId(id);
          return;
        }

        // Fallback: if none visible, pick the one just above viewport
        const above = anchors
          .map((el) => ({
            el,
            top: el.getBoundingClientRect().top - rootEl.getBoundingClientRect().top,
          }))
          .filter((x) => x.top <= 8) // small threshold
          .sort((a, b) => b.top - a.top);
        if (above[0]) {
          const id = above[0].el.getAttribute('data-anchor-id');
          if (id) setActiveId(id);
        }
      },
      { root: rootEl, threshold: [0, 1.0] }
    );

    anchors.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [container, anchorIds.join('|')]);

  return activeId;
}

