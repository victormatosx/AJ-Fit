/** A notice is consumed only after native layout and a foreground frame. */
export function createNutritionNoticePresentation(dependencies: {
  schedule: (callback: () => void) => number;
  cancel: (id: number) => void;
  isCurrent: () => boolean;
  markSeen: () => Promise<void>;
}) {
  let disposed = false;
  let presented = false;
  let frame: number | null = null;
  return {
    onLayout() {
      if (disposed || presented || frame != null) return;
      frame = dependencies.schedule(() => {
        frame = null;
        if (disposed || !dependencies.isCurrent()) return;
        presented = true;
        void dependencies.markSeen().catch(() => { presented = false; });
      });
    },
    dispose() { disposed = true; if (frame != null) dependencies.cancel(frame); },
  };
}
