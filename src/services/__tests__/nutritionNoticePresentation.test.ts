import { describe, expect, it, vi } from 'vitest';
import { createNutritionNoticePresentation } from '../nutritionNoticePresentation';
describe('nutrition notice presentation acknowledgement', () => {
  function fixture() {
    let frame!: () => void; let current = true;
    const markSeen = vi.fn(async () => {}); const cancel = vi.fn();
    const notice = createNutritionNoticePresentation({ schedule: (callback) => { frame = callback; return 1; }, cancel,
      isCurrent: () => current, markSeen });
    return { notice, markSeen, cancel, tick: () => frame(), changeIdentityOrBackground: () => { current = false; } };
  }
  it('does not consume on scheduling, then acknowledges a presented foreground frame once', () => {
    const f = fixture(); expect(f.markSeen).not.toHaveBeenCalled();
    f.notice.onLayout(); expect(f.markSeen).not.toHaveBeenCalled();
    f.tick(); f.notice.onLayout(); expect(f.markSeen).toHaveBeenCalledTimes(1);
  });
  it('preserves the notice if unmounted before presentation, even with a stale frame callback', () => {
    const f = fixture(); f.notice.onLayout(); f.notice.dispose(); f.tick();
    expect(f.cancel).toHaveBeenCalledWith(1); expect(f.markSeen).not.toHaveBeenCalled();
  });
  it('does not acknowledge after identity/access/foreground eligibility changes', () => {
    const f = fixture(); f.notice.onLayout(); f.changeIdentityOrBackground(); f.tick(); expect(f.markSeen).not.toHaveBeenCalled();
  });
});
