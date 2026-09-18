# Redesign visual do estado bloqueado (Photo Vault) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the decorative locked-state screen of the Photo Vault gallery with a visual that looks like the real gallery (skeleton grid) heavily blurred behind a single centered lock control, with a shake+red flash on failure and a green flash + open-icon + blur fade-out on success, without weakening any existing security guarantee.

**Architecture:** `ProgressPhotosScreen` keeps its existing hard early-return, gated by a new pure function `shouldShowPhotoVaultLocked(unlocked, showLocked) = !unlocked || showLocked`, computed fresh on every render directly from the real vault status — so `PhotoVaultGrid` can never mount while `unlocked` is false, regardless of any local animation state. `showLocked` only ever *extends* the locked view a little further after a real unlock, until `PhotoVaultLockedState` finishes its success animation and calls `onRevealComplete`. `PhotoVaultLockedState` renders a new static `PhotoVaultGallerySkeleton` (no real data) inside an `expo-blur` `BlurTargetView`, blurred by a sibling animated `BlurView` (Android real blur via `blurMethod="dimezisBlurViewSdk31Plus"`), with a centered lock button driven by Reanimated shared values (shake, color flash, blur intensity).

**Tech Stack:** React Native / Expo SDK 56, TypeScript, `react-native-reanimated` 4.3.1 (already installed), `expo-blur` (new dependency), Vitest (structural/string-based tests plus one plain unit test, no component renderer in this repo).

Spec: `docs/superpowers/specs/2026-09-14-photovault-locked-visual-redesign-design.md`

**No commits.** Every step below only edits files on disk. Do not run `git add`, `git commit`, `git rm`, or `git push` at any point while executing this plan.

---

### Task 1: Add the `expo-blur` dependency

**Files:**
- Modify: `package.json`, `package-lock.json` (via the install command, not by hand)

- [ ] **Step 1: Install via the Expo CLI (picks the SDK 56-compatible version)**

Run: `npx expo install expo-blur`
Expected: `package.json` gains an `"expo-blur": "~<version>"` entry compatible with `expo: ~56.0.20`; lockfile updates.

- [ ] **Step 2: Verify**

Run: `grep -n '"expo-blur"' package.json`
Expected: one line showing the new dependency.

---

### Task 2: Add an "open" lock icon variant

**Files:**
- Modify: `src/components/ui/Icon.tsx:5-13` (the `IconName` union), `:84-85` (the `switch`, add a case right after `'lock'`)

- [ ] **Step 1: Add `'lock-open'` to the union**

In `src/components/ui/Icon.tsx`, change:

```ts
  | 'heart' | 'apple' | 'lock' | 'mail' | 'eye' | 'settings'
```

to:

```ts
  | 'heart' | 'apple' | 'lock' | 'lock-open' | 'mail' | 'eye' | 'settings'
```

- [ ] **Step 2: Add the render case**

Right after the existing `case 'lock':` block (`src/components/ui/Icon.tsx:84-85`), add:

```tsx
    case 'lock-open':
      return <Svg {...common}><Rect {...p} x="4" y="11" width="16" height="10" rx="2" /><Path {...p} d="M8 11V7a4 4 0 017.9-1" /></Svg>;
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors (this is an additive change to a closed union with an exhaustive `switch`/`default`, so nothing else needs updating).

---

### Task 3: Create `PhotoVaultGallerySkeleton` (static placeholder grid)

This is the piece that lets the locked screen "look like the gallery" without ever touching real photo data. Pure presentation: no `Image`, no vault/crypto/network import, no real dates.

**Files:**
- Create: `src/components/photoVault/PhotoVaultGallerySkeleton.tsx`
- Test: `src/screens/__tests__/photoVaultUiStructure.test.ts` (new `describe` block)

- [ ] **Step 1: Write the failing test**

Add this new `describe` block to `src/screens/__tests__/photoVaultUiStructure.test.ts`, right after the existing `describe('locked state reveals no private photo data', ...)` block (i.e. after its closing `});` around line 182, before `describe('viewer and sheet close with the vault', ...)`):

```ts
describe('the locked gallery skeleton', () => {
  const SKELETON = readCode(
    'src/components/photoVault/PhotoVaultGallerySkeleton.tsx',
  );

  it('is built from generic shapes only, no photo data or network', () => {
    expect(SKELETON).toContain('testID="photo-vault-gallery-skeleton"');
    expect(SKELETON).not.toContain('<Image');
    expect(SKELETON).not.toContain('expo-image');
    expect(SKELETON).not.toContain('source=');
    expect(SKELETON).not.toContain(' uri');
    expect(SKELETON).not.toContain('photoVaultGallery');
    expect(SKELETON).not.toContain('progressPhotos');
    expect(SKELETON).not.toContain('photoVaultCrypto');
    expect(SKELETON).not.toContain('photoVaultKey');
    expect(SKELETON).not.toContain('downloadProgressPhoto');
    expect(SKELETON).not.toContain('decrypt');
    expect(SKELETON).not.toContain('FlatList');
  });

  it('is hidden from assistive technology, since it carries no information', () => {
    expect(SKELETON).toContain('accessibilityElementsHidden');
    expect(SKELETON).toContain('importantForAccessibility="no-hide-descendants"');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/screens/__tests__/photoVaultUiStructure.test.ts -t "the locked gallery skeleton"`
Expected: FAIL — `ENOENT` / cannot read `PhotoVaultGallerySkeleton.tsx` (file does not exist yet).

- [ ] **Step 3: Create the component**

Create `src/components/photoVault/PhotoVaultGallerySkeleton.tsx`:

```tsx
import React, { memo } from 'react';
import { View } from 'react-native';

import { sizes, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme';

/**
 * A static stand-in for the real gallery grid, shown only behind the blur of
 * the locked state. It carries no photo data, no dates and no network or
 * vault import — the same generic shapes render whether the gallery is
 * empty or full, so the locked screen never reveals which.
 */

const CELL_HEIGHT = 148;
const SKELETON_ROWS = 3;

function SkeletonBar({ width }: { width: number }) {
  const { theme } = useTheme();
  return (
    <View
      style={{
        width,
        height: 10,
        borderRadius: 4,
        backgroundColor: theme.colors.surfaceElevated,
      }}
    />
  );
}

function SkeletonCell() {
  const { theme } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        height: CELL_HEIGHT,
        borderRadius: 10,
        backgroundColor: theme.colors.surface,
        borderWidth: sizes.hairline,
        borderColor: theme.colors.border,
      }}
    />
  );
}

function SkeletonRow() {
  return (
    <View style={{ paddingHorizontal: sizes.screenGutter, paddingBottom: spacing[5] }}>
      <View style={{ marginBottom: spacing[2.5] }}>
        <SkeletonBar width={72} />
      </View>
      <View style={{ flexDirection: 'row', gap: spacing[2] }}>
        <SkeletonCell />
        <SkeletonCell />
        <SkeletonCell />
      </View>
    </View>
  );
}

export const PhotoVaultGallerySkeleton = memo(function PhotoVaultGallerySkeleton() {
  return (
    <View
      testID="photo-vault-gallery-skeleton"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ paddingTop: spacing[5] }}
    >
      {Array.from({ length: SKELETON_ROWS }).map((_, index) => (
        <SkeletonRow key={index} />
      ))}
    </View>
  );
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/screens/__tests__/photoVaultUiStructure.test.ts -t "the locked gallery skeleton"`
Expected: PASS (2 tests).

---

### Task 4: Rewrite `PhotoVaultLockedState` (real blur on Android + centered lock + animations)

`expo-blur` on Android only produces a real blur when the content to blur is wrapped in a `BlurTargetView` and that view's ref is passed to `BlurView` as `blurTarget`, together with an explicit `blurMethod`. Without this, Android silently falls back to a flat semi-transparent tint instead of an actual blur (confirmed against the installed SDK 56 `expo-blur` README and `BlurView.types.ts`: `blurMethod` defaults to `'none'` on Android, and `blurTarget`/`BlurTargetView` are Android-only). This plan uses `blurMethod="dimezisBlurViewSdk31Plus"` — the method Expo's own docs recommend to get a real blur on Android 12+ (`RenderNode`-based) while automatically falling back to `'none'` (semi-transparent tint) on older Android instead of paying the slow `RenderScript` path. Either way, what is behind the blur is exclusively `PhotoVaultGallerySkeleton` — never real photo data — so a degraded/no blur on an old Android device is a cosmetic limitation, not a security one.

**Files:**
- Modify: `src/components/photoVault/PhotoVaultLockedState.tsx` (full rewrite)
- Test: `src/screens/__tests__/photoVaultUiStructure.test.ts` (replace the `describe('locked state reveals no private photo data', ...)` block, lines 96-182)

- [ ] **Step 1: Write the failing test — replace the old locked-state assertions**

In `src/screens/__tests__/photoVaultUiStructure.test.ts`:

1. Remove the `PROTECTED_INTRO` constant (lines 36-38):

```ts
const PROTECTED_INTRO = readCode(
  'src/components/photoVault/PhotoVaultProtectedIntro.tsx',
);
```

2. Replace the entire `describe('locked state reveals no private photo data', ...)` block (from `describe('locked state reveals no private photo data', () => {` to its matching closing `});`, i.e. current lines 96-182) with:

```ts
describe('locked state reveals no private photo data', () => {
  const LOCKED_CODE = readCode('src/components/photoVault/PhotoVaultLockedState.tsx');

  it('returns the locked component before rendering any content', () => {
    const lockedReturn = SCREEN.indexOf('<PhotoVaultLockedState');
    expect(lockedReturn).toBeGreaterThan(-1);
    expect(lockedReturn).toBeLessThan(SCREEN.indexOf('<PhotoVaultGrid'));
    expect(lockedReturn).toBeLessThan(SCREEN.indexOf('<PhotoVaultViewer'));
  });

  it('gates the real gallery on `unlocked` alone, never on local animation state', () => {
    // `shouldShowPhotoVaultLocked` is the ONLY thing deciding this branch, and
    // it is computed fresh every render directly from `unlocked` — so a stale
    // `showLocked` left over from a previous session can only ever keep the
    // locked view up for longer, never take it down early. See
    // photoVaultLockedVisibility.test.ts for the exhaustive truth table.
    expect(SCREEN).toContain('shouldShowPhotoVaultLocked');
    expect(SCREEN).toMatch(/if \(shouldShowPhotoVaultLocked\(unlocked, showLocked\)\) \{/);
    expect(SCREEN).toContain('useState(!unlocked)');
    expect(SCREEN).toContain('onRevealComplete={() => setShowLocked(false)}');
  });

  it('loads the gallery only after the vault reports unlocked', () => {
    expect(SCREEN).toMatch(
      /useEffect\(\(\) => \{\s*if \(unlocked\) void loadGallery\(\);\s*\}, \[unlocked\]\)/,
    );
  });

  it('uses the available locked height to keep the lock control centered', () => {
    expect(SCREEN).toContain("contentContainerStyle={{ flexGrow: 1, paddingBottom: 12 }}");
    expect(LOCKED_CODE).toContain('flex: 1');
  });

  it('shows the same blurred skeleton whether the gallery is empty or populated', () => {
    // The locked screen must never receive anything that could distinguish
    // an empty vault from a full one.
    expect(LOCKED_CODE).not.toContain('hasContent');
    expect(LOCKED_CODE).not.toContain('contentPresenceReady');
    expect(SCREEN).not.toContain('hasContent={hasPhotoVaultContent}');
    expect(SCREEN).not.toContain('contentPresenceReady={hasPhotoVaultContentReady}');
    expect(LOCKED_CODE).not.toContain('photos.length');
    expect(LOCKED_CODE).not.toContain('<Image');
    expect(LOCKED_CODE).not.toContain('formatDate');
  });

  it('builds the locked composition from the static skeleton and a real Android blur target, only', () => {
    expect(LOCKED_CODE).toContain('<PhotoVaultGallerySkeleton');
    expect(LOCKED_CODE).toContain('BlurTargetView');
    expect(LOCKED_CODE).toContain('blurTarget=');
    expect(LOCKED_CODE).toContain('blurMethod="dimezisBlurViewSdk31Plus"');
    expect(LOCKED_CODE).not.toContain('<Image');
    expect(LOCKED_CODE).not.toContain('source=');
    expect(LOCKED_CODE).not.toContain(' uri');
    expect(LOCKED_CODE).not.toContain('photoVaultGallery');
    expect(LOCKED_CODE).not.toContain('progressPhotos');
    expect(LOCKED_CODE).not.toContain('photoVaultCrypto');
    expect(LOCKED_CODE).not.toContain('photoVaultKey');
    expect(LOCKED_CODE).not.toContain('downloadProgressPhoto');
    expect(LOCKED_CODE).not.toContain('decrypt');
  });

  it('does not overwrite a persisted true from the gallery initial empty array', () => {
    expect(SCREEN).toMatch(
      /useEffect\(\(\) => \{\s*if \(unlocked\) void loadGallery\(\);\s*\}, \[unlocked\]\)/,
    );
    const lockedBranch = SCREEN.slice(
      SCREEN.indexOf('// ── Locked'),
      SCREEN.indexOf("return (\n    <View style={{ flex: 1 }}>", SCREEN.indexOf('// ── Locked')),
    );
    expect(lockedBranch).not.toContain('setHasPhotoVaultContent(false)');
  });

  it('clears the hint only after a confirmed delete leaves no photos', () => {
    const deleteFlow = SCREEN.slice(
      SCREEN.indexOf('const ok = await removeGalleryPhoto(photoId);'),
      SCREEN.indexOf('})();', SCREEN.indexOf('const ok = await removeGalleryPhoto(photoId);')),
    );
    expect(deleteFlow).toContain('if (!ok)');
    expect(deleteFlow).toContain('return;');
    expect(deleteFlow).toContain('getGalleryState().photos.length === 0');
    expect(deleteFlow).toContain('setHasPhotoVaultContent(false)');
  });

  it('announces the protected title for assistive technology', () => {
    // No visible text is rendered any more, but the region is still labeled.
    expect(LOCKED_CODE).toContain("t('progress.photos.locked.title')");
  });

  it('flashes red and shakes on a real auth failure, without visible error text', () => {
    expect(LOCKED_CODE).toContain('withSequence');
    expect(LOCKED_CODE).toContain('shakeX');
    expect(LOCKED_CODE).toContain('dangerFlash');
    expect(LOCKED_CODE).toContain('AccessibilityInfo.announceForAccessibility');
    expect(LOCKED_CODE).not.toMatch(/<Text/);
  });

  it('flashes green and fades the blur out on success, then reveals the gallery', () => {
    expect(LOCKED_CODE).toContain('successFlash');
    expect(LOCKED_CODE).toContain('setIconOpen(true)');
    expect(LOCKED_CODE).toContain('onRevealComplete');
    expect(LOCKED_CODE).toContain('runOnJS(onRevealComplete)');
  });

  it('never names a specific biometric mechanism', () => {
    expect(LOCKED_CODE).not.toMatch(/Face ID|Touch ID|impress[ãa]o digital/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/screens/__tests__/photoVaultUiStructure.test.ts -t "locked state reveals no private photo data"`
Expected: FAIL — `PhotoVaultLockedState.tsx` does not yet contain `PhotoVaultGallerySkeleton`, `BlurTargetView`, `withSequence`, etc.; `ProgressPhotosScreen.tsx` does not yet contain `shouldShowPhotoVaultLocked`.

- [ ] **Step 3: Rewrite the component**

Replace the full contents of `src/components/photoVault/PhotoVaultLockedState.tsx` with:

```tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Linking, Pressable, StyleSheet, View } from 'react-native';
import { BlurTargetView, BlurView } from 'expo-blur';
import Animated, {
  interpolateColor,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { Icon } from '../ui/Icon';
import { radii, spacing } from '../../theme/tokens';
import { useTheme } from '../../theme';
import type { PhotoVaultIssue } from '../../lib/photoVaultErrors';
import type { PhotoVaultStatus } from '../../lib/photoVaultLock';
import { PhotoVaultGallerySkeleton } from './PhotoVaultGallerySkeleton';

/**
 * What the user sees before the vault is open.
 *
 * Looks like the gallery itself — the caller renders the same header/footer
 * around this — with its content replaced by `PhotoVaultGallerySkeleton` (no
 * real photo data) and heavily blurred. The only control is a centered lock.
 * It never names a specific mechanism ("Face ID"), because the same build
 * runs on devices that will prompt for a fingerprint or screen lock instead.
 *
 * `BlurTargetView` + `blurTarget` + `blurMethod` are required for a REAL blur
 * on Android (SDK 56's `expo-blur`): without them Android only renders a flat
 * semi-transparent tint. `dimezisBlurViewSdk31Plus` gives a real blur on
 * Android 12+ and safely falls back to that flat tint on older Android
 * instead of paying for the slow RenderScript path — acceptable here because
 * the skeleton behind it never carries real data either way.
 */

interface Props {
  status: PhotoVaultStatus;
  issue: PhotoVaultIssue | null;
  onUnlock: () => void;
  /** Fires once the success animation finishes, so the caller can mount the real gallery. */
  onRevealComplete: () => void;
}

/** Issues that mean the device has nothing secure to authenticate with. */
const NOT_CONFIGURED: PhotoVaultIssue[] = [
  'vaultAuthNotConfigured',
  'vaultAuthNotEnrolled',
];

const LOCK_SIZE = 68;
const BLUR_INTENSITY = 92;

const AnimatedBlurView = Animated.createAnimatedComponent(BlurView);
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function useAuthErrorMessage(issue: PhotoVaultIssue | null): string | null {
  const { t } = useTranslation('home');

  switch (issue) {
    case 'vaultAuthCancelled':
      return t('progress.photos.authError.cancelled');
    case 'vaultAuthLockedOut':
      return t('progress.photos.authError.lockedOut');
    case 'vaultAuthUnavailable':
      return t('progress.photos.authError.unavailable');
    case 'vaultAuthFailed':
    case 'vaultUnlockFailed':
      return t('progress.photos.authError.failed');
    default:
      return null;
  }
}

export function PhotoVaultLockedState({
  status,
  issue,
  onUnlock,
  onRevealComplete,
}: Props) {
  const { t } = useTranslation('home');
  const { theme } = useTheme();
  const authenticating = status === 'authenticating';
  const notConfigured = issue !== null && NOT_CONFIGURED.includes(issue);
  const errorMessage = useAuthErrorMessage(issue);
  const [iconOpen, setIconOpen] = useState(false);
  const blurTargetRef = useRef<View | null>(null);

  const blurIntensity = useSharedValue(BLUR_INTENSITY);
  const shakeX = useSharedValue(0);
  const dangerFlash = useSharedValue(0);
  const successFlash = useSharedValue(0);

  const blurProps = useAnimatedProps(() => ({ intensity: blurIntensity.value }));

  const buttonStyle = useAnimatedStyle(() => {
    const backgroundColor =
      successFlash.value > 0
        ? interpolateColor(
            successFlash.value,
            [0, 1],
            [theme.colors.surfaceElevated, theme.colors.success],
          )
        : dangerFlash.value > 0
          ? interpolateColor(
              dangerFlash.value,
              [0, 1],
              [theme.colors.surfaceElevated, theme.colors.danger],
            )
          : theme.colors.surfaceElevated;

    return {
      backgroundColor,
      transform: [{ translateX: shakeX.value }],
    };
  });

  // A real auth failure or cancellation: shake, flash red, tell a screen
  // reader — without reintroducing any visible error text.
  useEffect(() => {
    if (status !== 'locked' || !issue || notConfigured) return;

    shakeX.value = withSequence(
      withTiming(-8, { duration: 45 }),
      withTiming(8, { duration: 80 }),
      withTiming(-6, { duration: 80 }),
      withTiming(6, { duration: 60 }),
      withTiming(0, { duration: 60 }),
    );
    dangerFlash.value = withSequence(
      withTiming(1, { duration: 120 }),
      withDelay(450, withTiming(0, { duration: 250 })),
    );
    if (errorMessage) AccessibilityInfo.announceForAccessibility(errorMessage);
    // Deliberately excludes `errorMessage`/`notConfigured`/the shared values:
    // this must re-run only when a NEW issue arrives while locked, not when
    // the translated message reference changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue, status]);

  // Success: the lock flashes green, its icon swaps, the blur fades out, and
  // only then does the caller get to mount the real gallery.
  useEffect(() => {
    if (status !== 'unlocked') return;

    successFlash.value = withTiming(1, { duration: 150 });
    setIconOpen(true);
    blurIntensity.value = withDelay(
      200,
      withTiming(0, { duration: 400 }, (finished) => {
        if (finished) runOnJS(onRevealComplete)();
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // A background lock mid-transition must snap the visual back to locked
  // immediately — the skeleton has no real data either way, but the lock
  // must never be left looking open while the vault is not.
  useEffect(() => {
    if (status === 'unlocked') return;
    blurIntensity.value = BLUR_INTENSITY;
    successFlash.value = 0;
    setIconOpen(false);
  }, [status, blurIntensity, successFlash]);

  const handlePress = useCallback(() => {
    if (notConfigured) {
      void Linking.openSettings();
      return;
    }
    onUnlock();
  }, [notConfigured, onUnlock]);

  const accessibilityLabel = notConfigured
    ? t('progress.photos.notConfigured.openSettings')
    : t('progress.photos.a11y.unlock');

  return (
    <View style={{ flex: 1 }} accessibilityLabel={t('progress.photos.locked.title')}>
      <BlurTargetView ref={blurTargetRef} style={{ flex: 1 }}>
        <PhotoVaultGallerySkeleton />
      </BlurTargetView>

      <AnimatedBlurView
        blurTarget={blurTargetRef}
        blurMethod="dimezisBlurViewSdk31Plus"
        animatedProps={blurProps}
        tint={theme.mode === 'light' ? 'light' : 'dark'}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />

      <View style={styles.center} pointerEvents="box-none">
        <AnimatedPressable
          onPress={handlePress}
          disabled={authenticating}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityState={{ disabled: authenticating, busy: authenticating }}
          hitSlop={spacing[3]}
          style={[
            {
              width: LOCK_SIZE,
              height: LOCK_SIZE,
              borderRadius: radii.pill,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1.5,
              borderColor: theme.colors.borderStrong,
              opacity: authenticating ? theme.opacity.disabled : 1,
            },
            buttonStyle,
          ]}
        >
          <Icon
            name={iconOpen ? 'lock-open' : 'lock'}
            size={26}
            color={theme.colors.textPrimary}
            stroke={1.8}
          />
          {notConfigured ? (
            <View style={styles.badge}>
              <Icon name="alert-triangle" size={12} color={theme.colors.warning} />
            </View>
          ) : null}
        </AnimatedPressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1a1330',
  },
});
```

- [ ] **Step 4: Run the tests to verify they still fail (screen not wired yet)**

Run: `npx vitest run src/screens/__tests__/photoVaultUiStructure.test.ts -t "locked state reveals no private photo data"`
Expected: FAIL only on `'gates the real gallery on unlocked alone...'` and possibly the order/height checks that depend on `ProgressPhotosScreen.tsx` (not updated until Task 5). The component-only assertions (skeleton import, `BlurTargetView`, `blurTarget=`, `blurMethod="dimezisBlurViewSdk31Plus"`, `withSequence`, `shakeX`, `dangerFlash`, `successFlash`, `runOnJS`) should now PASS.

---

### Task 5: Add the security-first `shouldShowPhotoVaultLocked` gate, then wire `ProgressPhotosScreen`

This is the fix for the re-lock race: the branch that decides whether `PhotoVaultGrid` mounts must be a pure function of `unlocked` (a value with no timing lag — it is derived straight from `status`, itself React state updated synchronously by the vault's subscription) OR-ed with `showLocked`. Never `showLocked` alone: that state is only set back to `true` inside a `useEffect`, which runs *after* the render commits, so gating on `showLocked` alone would let one render/commit through with the real gallery mounted the instant `unlocked` flips to `false` (e.g. the app backgrounds while unlocked). Extracted as a standalone pure function so the four truth-table cases can be tested directly, without needing a component renderer (this repo has none).

**Files:**
- Create: `src/lib/photoVaultLockedVisibility.ts`
- Test: `src/lib/__tests__/photoVaultLockedVisibility.test.ts`
- Modify: `src/screens/ProgressPhotosScreen.tsx:153` (add `showLocked` state), `:515-532` (branch + props)

- [ ] **Step 1: Write the failing test for the pure gate**

Create `src/lib/__tests__/photoVaultLockedVisibility.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { shouldShowPhotoVaultLocked } from '../photoVaultLockedVisibility';

/**
 * The security invariant restated as a truth table: whenever the vault is
 * NOT unlocked, the locked view must show, full stop — `showLocked` can only
 * ever keep it up for LONGER after a real unlock, never take it down early.
 */
describe('shouldShowPhotoVaultLocked', () => {
  it('unlocked=false, showLocked=false -> locked', () => {
    expect(shouldShowPhotoVaultLocked(false, false)).toBe(true);
  });

  it('unlocked=false, showLocked=true -> locked', () => {
    expect(shouldShowPhotoVaultLocked(false, true)).toBe(true);
  });

  it('unlocked=true, showLocked=true -> locked (mid reveal animation)', () => {
    expect(shouldShowPhotoVaultLocked(true, true)).toBe(true);
  });

  it('unlocked=true, showLocked=false -> real gallery', () => {
    expect(shouldShowPhotoVaultLocked(true, false)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/__tests__/photoVaultLockedVisibility.test.ts`
Expected: FAIL — `ENOENT` / cannot find module `../photoVaultLockedVisibility` (file does not exist yet).

- [ ] **Step 3: Create the pure module**

Create `src/lib/photoVaultLockedVisibility.ts`:

```ts
/**
 * Whether the Photo Vault screen must render the locked (blurred) tree.
 *
 * `unlocked` is the ONLY security-relevant input: whenever it is false, the
 * real gallery must never mount, no matter what `showLocked` says. That is
 * why this is `!unlocked || showLocked` and not just `showLocked` — the
 * latter is React state written inside a `useEffect`, which runs one commit
 * after a render, so gating on it alone would let a single render through
 * with the real gallery mounted the instant `unlocked` turns false (for
 * example, the app backgrounding while unlocked).
 *
 * `showLocked` only ever EXTENDS the locked view a little further after a
 * real unlock, so `PhotoVaultLockedState`'s success animation has time to
 * finish before the real gallery is revealed. It can never take the locked
 * view down on its own.
 */
export function shouldShowPhotoVaultLocked(
  unlocked: boolean,
  showLocked: boolean,
): boolean {
  return !unlocked || showLocked;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/__tests__/photoVaultLockedVisibility.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire `ProgressPhotosScreen`**

Add the import near the other `lib` imports in `src/screens/ProgressPhotosScreen.tsx` (alongside the existing `import type { PhotoVaultIssue } from '../lib/photoVaultErrors';`):

```ts
import { shouldShowPhotoVaultLocked } from '../lib/photoVaultLockedVisibility';
```

Then, right after the existing `const unlocked = status === 'unlocked';` line (`ProgressPhotosScreen.tsx:153`), add:

```tsx
  const unlocked = status === 'unlocked';
  /**
   * Extends the locked view a little further after a real unlock, so
   * `PhotoVaultLockedState` has time to finish its reveal animation before
   * the real gallery mounts. `shouldShowPhotoVaultLocked` below is what
   * actually gates the branch — `unlocked` alone decides the moment the
   * vault re-locks, this state can only ever prolong "locked", never
   * shorten it. See `lib/photoVaultLockedVisibility.ts`.
   */
  const [showLocked, setShowLocked] = useState(!unlocked);

  useEffect(() => {
    if (!unlocked) setShowLocked(true);
  }, [unlocked]);
```

- [ ] **Step 6: Replace the locked branch (`ProgressPhotosScreen.tsx:515-532`)**

Change:

```tsx
  // ── Locked ───────────────────────────────────────────────────────────────
  // Nothing about the vault's contents is rendered before this point.
  if (!unlocked) {
    return (
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 12 }}
        showsVerticalScrollIndicator={false}
      >
        {pageHeader}
        <PhotoVaultLockedState
          status={status === 'authenticating' ? 'authenticating' : 'locked'}
          issue={lastIssue}
          onUnlock={() => void unlock()}
        />
        {pageFooter}
      </ScrollView>
    );
  }
```

to:

```tsx
  // ── Locked ───────────────────────────────────────────────────────────────
  // Nothing about the vault's contents is rendered before this point.
  // `shouldShowPhotoVaultLocked` gates strictly on `unlocked`: the moment the
  // vault is not unlocked, this branch is taken, full stop. `showLocked` can
  // only extend it further, to let a successful unlock's reveal animation
  // finish before the real gallery below ever mounts.
  if (shouldShowPhotoVaultLocked(unlocked, showLocked)) {
    return (
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 12 }}
        showsVerticalScrollIndicator={false}
      >
        {pageHeader}
        <PhotoVaultLockedState
          status={status}
          issue={lastIssue}
          onUnlock={() => void unlock()}
          onRevealComplete={() => setShowLocked(false)}
        />
        {pageFooter}
      </ScrollView>
    );
  }
```

- [ ] **Step 7: Run the full structural test file**

Run: `npx vitest run src/screens/__tests__/photoVaultUiStructure.test.ts src/lib/__tests__/photoVaultLockedVisibility.test.ts`
Expected: PASS — every test in both files, including everything added in Tasks 3, 4 and 5.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. In particular, `PhotoVaultLockedState`'s `status` prop now accepts the full `PhotoVaultStatus` (`'locked' | 'authenticating' | 'unlocked'`), matching what `ProgressPhotosScreen` now passes directly.

---

### Task 6: Remove the old decorative intro

`PhotoVaultProtectedIntro` is now dead code — nothing imports it after Task 4.

**Files:**
- Delete: `src/components/photoVault/PhotoVaultProtectedIntro.tsx`

- [ ] **Step 1: Confirm nothing else imports it**

Run: `grep -rn "PhotoVaultProtectedIntro" src --include="*.tsx" --include="*.ts"`
Expected: no matches (Task 4 already removed the import from `PhotoVaultLockedState.tsx`, and Task 4's test rewrite already removed the `PROTECTED_INTRO` constant and its assertions from `photoVaultUiStructure.test.ts`).

- [ ] **Step 2: Delete the file**

Delete `src/components/photoVault/PhotoVaultProtectedIntro.tsx` from disk (no `git rm` — this plan makes no commits).

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS, including `src/i18n/__tests__/photoVaultLockedContent.test.ts` (unchanged — `progress.photos.locked.title` is still used, just as an accessibility label instead of visible text) and every other `photoVault*` test.

---

### Task 7: Final verification

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS, no regressions anywhere (not just `photoVault*` — the suite is fast enough to run whole).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no new warnings/errors in the touched files.

- [ ] **Step 4: Manual/visual check (documented limitation)**

This plan cannot start the Expo app or a simulator from this environment. Before considering the feature done, run the app (`npx expo start`) and manually verify on the Progress → Photos tab:
- Locked: header visible, grid-shaped blur behind it, centered closed lock, no card/text.
- Tap → OS biometric/passcode prompt appears; a second rapid tap does nothing extra.
- Cancel/fail → shake + brief red flash, stays locked and blurred, no visible error text (screen reader should announce the error — verify with VoiceOver/TalkBack if available).
- Success → lock flashes green, icon swaps to open, blur fades, real gallery appears and is fully functional (scroll, open a photo, add, delete, compare).
- Device with no biometrics/passcode configured → lock shows the alert badge; tap opens OS settings instead of prompting.
- On an Android device below SDK 31 specifically: locked view still shows (flat tint instead of a true blur), lock still works, no real photo data is ever visible.

**No commits are part of this plan.** When implementation is verified, stop here — do not run `git add`/`git commit`/`git push`.
