import { describe, expect, it } from 'vitest';

import {
  EMPTY_POSE_DRAFTS,
  draftDateKey,
  emptyPoseDrafts,
  filledPoses,
  partitionSavablePoses,
  setPoseDraft,
  stagedDraftUris,
  type PoseDraftPhoto,
  type PoseDrafts,
} from '../photoVaultPoseDrafts';
import type { ProgressPhotoPose } from '../photoVaultIdentity';

function pic(name: string, takenAt = new Date(2026, 7, 15, 12, 0)): PoseDraftPhoto {
  return { sourceUri: `file:///cache/photo-vault/tmp/${name}.jpg`, takenAt };
}

/** Applies a sequence of assignments, collecting everything released. */
function apply(
  steps: Array<[ProgressPhotoPose, PoseDraftPhoto | null]>,
): { drafts: PoseDrafts; released: string[] } {
  let drafts = emptyPoseDrafts();
  const released: string[] = [];
  for (const [pose, photo] of steps) {
    const result = setPoseDraft(drafts, pose, photo);
    drafts = result.drafts;
    if (result.released) released.push(result.released);
  }
  return { drafts, released };
}

const A = pic('a');
const B = pic('b');
const C = pic('c');

describe('drafts are independent per pose', () => {
  it('1. choosing front leaves side empty', () => {
    const { drafts } = apply([['front', A]]);

    expect(drafts.front).toBe(A);
    // The bug this replaced: side used to display front's photo.
    expect(drafts.side).toBeNull();
    expect(drafts.back).toBeNull();
  });

  it('2. returning to front still shows its own photo', () => {
    const { drafts } = apply([
      ['front', A],
      ['side', B],
    ]);

    expect(drafts.front).toBe(A);
    expect(drafts.side).toBe(B);
  });

  it('3. each pose keeps its own image', () => {
    const { drafts } = apply([
      ['front', A],
      ['side', B],
      ['back', C],
    ]);

    expect(drafts.front).toBe(A);
    expect(drafts.side).toBe(B);
    expect(drafts.back).toBe(C);
  });

  it('4. replacing side leaves front and back untouched', () => {
    const start = apply([
      ['front', A],
      ['side', B],
      ['back', C],
    ]).drafts;
    const D = pic('d');

    const { drafts, released } = setPoseDraft(start, 'side', D);

    expect(drafts.side).toBe(D);
    expect(drafts.front).toBe(A);
    expect(drafts.back).toBe(C);
    // The photo it replaced must not stay staged.
    expect(released).toBe(B.sourceUri);
  });

  it('14. no pose ever exposes another pose photo', () => {
    const { drafts } = apply([
      ['front', A],
      ['side', B],
      ['back', C],
    ]);

    const uris = (['front', 'side', 'back'] as const).map((p) => drafts[p]?.sourceUri);
    expect(new Set(uris).size).toBe(3);
  });

  it('does not mutate the map it was given', () => {
    const start = apply([['front', A]]).drafts;
    const snapshot = { ...start };

    setPoseDraft(start, 'side', B);

    expect(start).toEqual(snapshot);
  });
});

describe('removing a draft', () => {
  it('clears only that pose and releases its file', () => {
    const start = apply([
      ['front', A],
      ['side', B],
      ['back', C],
    ]).drafts;

    const { drafts, released } = setPoseDraft(start, 'side', null);

    expect(drafts.side).toBeNull();
    expect(drafts.front).toBe(A);
    expect(drafts.back).toBe(C);
    expect(released).toBe(B.sourceUri);
  });

  it('releases nothing when the pose was already empty', () => {
    const { released } = setPoseDraft(emptyPoseDrafts(), 'front', null);
    expect(released).toBeNull();
  });

  it('releases nothing when the same photo is set again', () => {
    const start = apply([['front', A]]).drafts;
    const { released } = setPoseDraft(start, 'front', A);
    expect(released).toBeNull();
  });
});

describe('5. cancelling the session', () => {
  it('reports every staged file so none is orphaned', () => {
    const { drafts } = apply([
      ['front', A],
      ['side', B],
      ['back', C],
    ]);

    expect(stagedDraftUris(drafts).sort()).toEqual(
      [A.sourceUri, B.sourceUri, C.sourceUri].sort(),
    );
  });

  it('reports nothing for an untouched session', () => {
    expect(stagedDraftUris(EMPTY_POSE_DRAFTS)).toEqual([]);
  });
});

describe('what gets uploaded', () => {
  const free = () => false;

  it('6. saving with only front uploads front alone', () => {
    const { drafts } = apply([['front', A]]);
    const { savable } = partitionSavablePoses(drafts, free);

    expect(savable).toEqual(['front']);
  });

  it('7. front and side upload as two poses', () => {
    const { drafts } = apply([
      ['front', A],
      ['side', B],
    ]);

    expect(partitionSavablePoses(drafts, free).savable).toEqual(['front', 'side']);
  });

  it('8. all three upload independently, in slot order', () => {
    const { drafts } = apply([
      ['back', C],
      ['front', A],
      ['side', B],
    ]);

    // Assembly order does not decide upload order; the slot order does.
    expect(partitionSavablePoses(drafts, free).savable).toEqual(['front', 'side', 'back']);
  });

  it('uploads nothing when the session is empty', () => {
    expect(partitionSavablePoses(EMPTY_POSE_DRAFTS, free).savable).toEqual([]);
  });
});

describe('9. each draft keeps its own day', () => {
  it('derives a separate dateKey per pose', () => {
    const { drafts } = apply([
      ['front', pic('a', new Date(2026, 7, 10, 9, 0))],
      ['side', pic('b', new Date(2026, 7, 12, 9, 0))],
      ['back', pic('c', new Date(2026, 7, 10, 18, 0))],
    ]);

    // Three photos, two days — never collapsed onto the first one's day.
    expect(draftDateKey(drafts, 'front')).toBe('2026-08-10');
    expect(draftDateKey(drafts, 'side')).toBe('2026-08-12');
    expect(draftDateKey(drafts, 'back')).toBe('2026-08-10');
  });

  it('uses the local calendar, so a late evening photo keeps its day', () => {
    const { drafts } = apply([['front', pic('a', new Date(2026, 7, 15, 23, 30))]]);
    expect(draftDateKey(drafts, 'front')).toBe('2026-08-15');
  });

  it('has no day for an empty pose', () => {
    expect(draftDateKey(EMPTY_POSE_DRAFTS, 'front')).toBeNull();
  });
});

describe('10. an occupied slot blocks only its own pose', () => {
  it('keeps the other poses savable', () => {
    const { drafts } = apply([
      ['front', A],
      ['side', B],
      ['back', C],
    ]);
    const takenFront = (dateKey: string, pose: ProgressPhotoPose) =>
      dateKey === '2026-08-15' && pose === 'front';

    const { savable, blocked } = partitionSavablePoses(drafts, takenFront);

    expect(blocked).toEqual(['front']);
    expect(savable).toEqual(['side', 'back']);
  });

  it('checks occupancy against each draft own day', () => {
    const { drafts } = apply([
      ['front', pic('a', new Date(2026, 7, 10, 9, 0))],
      ['side', pic('b', new Date(2026, 7, 12, 9, 0))],
    ]);
    // Only the 12th is taken, and only for `side`.
    const taken = (dateKey: string, pose: ProgressPhotoPose) =>
      dateKey === '2026-08-12' && pose === 'side';

    const { savable, blocked } = partitionSavablePoses(drafts, taken);

    expect(blocked).toEqual(['side']);
    expect(savable).toEqual(['front']);
  });

  it('blocks nothing when every slot is free', () => {
    const { drafts } = apply([['front', A]]);
    expect(partitionSavablePoses(drafts, () => false).blocked).toEqual([]);
  });
});

describe('filledPoses', () => {
  it('lists assembled poses in the fixed slot order', () => {
    const { drafts } = apply([
      ['back', C],
      ['front', A],
    ]);

    expect(filledPoses(drafts)).toEqual(['front', 'back']);
  });

  it('is empty for a fresh session', () => {
    expect(filledPoses(EMPTY_POSE_DRAFTS)).toEqual([]);
  });
});
