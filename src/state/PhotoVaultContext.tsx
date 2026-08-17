import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, StyleSheet, View, type AppStateStatus } from 'react-native';

import {
  getPhotoVaultStatus,
  handlePhotoVaultAppStateChange,
  initializePhotoVaultAppState,
  lockPhotoVault,
  subscribeToPhotoVaultStatus,
  unlockPhotoVault,
  type PhotoVaultStatus,
  type UnlockOutcome,
} from '../lib/photoVaultLock';
import { logPhotoVaultIssue, type PhotoVaultIssue } from '../lib/photoVaultErrors';
import {
  getVaultAuthCapability,
  type VaultAuthCapability,
} from '../services/localAuthentication';
import { pruneCachedThumbnailsExcept } from '../services/photoVaultEncryptedCache';
import { cleanupPhotoVaultShareFiles } from '../services/photoVaultFileCrypto';
import { deactivatePhotoVaultScreenProtection } from '../services/photoVaultScreenProtection';
import {
  isPhotoVaultComparisonShareInFlight,
  subscribeToPhotoVaultComparisonShareInFlight,
} from '../lib/photoVaultCompareShare';
import { canReleasePhotoVaultScreenProtection } from '../lib/photoVaultPrivacyLifecycle';
import { useAuth } from './AuthContext';

/**
 * React surface for the Photo Vault lock.
 *
 * Deliberately thin: the state machine lives in `lib/photoVaultLock`, and
 * services read `lib/photoVaultSession`. This component only mirrors that
 * state for the UI and owns the two things that genuinely belong to the app
 * lifecycle — the `AppState` listener and the reaction to an identity
 * change.
 */

interface PhotoVaultContextValue {
  status: PhotoVaultStatus;
  /** What the device can authenticate with; null until first inspected. */
  capability: VaultAuthCapability | null;
  /** Why the last unlock attempt did not succeed. Cleared on a new attempt. */
  lastIssue: PhotoVaultIssue | null;
  unlock: () => Promise<UnlockOutcome>;
  lock: () => void;
  refreshCapability: () => Promise<VaultAuthCapability>;
}

const PhotoVaultCtx = createContext<PhotoVaultContextValue | null>(null);

export function PhotoVaultProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  const [status, setStatus] = useState<PhotoVaultStatus>(getPhotoVaultStatus);
  const [capability, setCapability] = useState<VaultAuthCapability | null>(null);
  const [lastIssue, setLastIssue] = useState<PhotoVaultIssue | null>(null);
  const [privacyOverlayVisible, setPrivacyOverlayVisible] = useState(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const sensitiveSnapshotRef = useRef(false);

  /**
   * Releasing iOS capture protection reparents the current key window. During
   * a native share handoff the UIActivityViewController presentation/window
   * hierarchy can still be dismissing, so wait until the handoff (including
   * its file lease grace) has settled. The Vault remains locked and protected
   * while deferred; this never creates an unlock exception.
   */
  const deactivateScreenProtectionIfSafe = useCallback(() => {
    if (!canReleasePhotoVaultScreenProtection({
      appState: appStateRef.current,
      vaultStatus: getPhotoVaultStatus(),
      shareInFlight: isPhotoVaultComparisonShareInFlight(),
    })) return;
    void deactivatePhotoVaultScreenProtection();
  }, []);

  useEffect(() => subscribeToPhotoVaultStatus(setStatus), []);

  const lock = useCallback(() => {
    lockPhotoVault();
  }, []);

  const unlock = useCallback(async () => {
    setLastIssue(null);
    const outcome = await unlockPhotoVault(uid);
    if (!outcome.ok) setLastIssue(outcome.issue);
    return outcome;
  }, [uid]);

  const refreshCapability = useCallback(async () => {
    const next = await getVaultAuthCapability();
    setCapability(next);
    return next;
  }, []);

  /**
   * An unlocked vault locks immediately on `inactive`, before its private
   * frame can reach the app-switcher preview. The one safe exception is an
   * `inactive` transition while the vault's own OS prompt is authenticating:
   * no session exists then, native success waits for `active`, and a following
   * real `background` still cancels the attempt immediately.
   *
   * Returning to `active` deliberately does NOT start a new unlock or prompt.
   */
  useEffect(() => {
    initializePhotoVaultAppState(appStateRef.current);
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      const previous = appStateRef.current;
      appStateRef.current = next;

      const hadSensitiveContent =
        getPhotoVaultStatus() === 'unlocked' || sensitiveSnapshotRef.current;
      handlePhotoVaultAppStateChange(previous, next);

      if (next !== 'active') {
        if (hadSensitiveContent) {
          // An unlocked session was revoked synchronously by the lifecycle
          // state machine before scheduling any React work. The already-active
          // native capture guard remains installed while this neutral overlay
          // replaces the private tree.
          // The native protection is already active from unlock. This neutral
          // React overlay is an extra guard for the transition frame while the
          // viewer and grid are being removed from the tree.
          sensitiveSnapshotRef.current = true;
          setPrivacyOverlayVisible(true);
        }
        return;
      }

      // Returning to foreground never unlocks. Wait for two render frames so
      // the locked UI is committed before removing either privacy layer.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (appStateRef.current !== 'active') return;
          setPrivacyOverlayVisible(false);
          sensitiveSnapshotRef.current = false;
          deactivateScreenProtectionIfSafe();
        });
      });
    });
    const unsubscribeShareHandoff = subscribeToPhotoVaultComparisonShareInFlight(
      (inFlight) => {
        if (inFlight) return;
        // `shareAsync` has returned and the centralized handoff grace elapsed.
        // Give React one more frame to keep the locked tree committed before
        // asking the native module to restore the capture/window hierarchy.
        requestAnimationFrame(deactivateScreenProtectionIfSafe);
      },
    );
    return () => {
      subscription.remove();
      unsubscribeShareHandoff();
      void deactivatePhotoVaultScreenProtection();
    };
  }, [deactivateScreenProtectionIfSafe]);

  /**
   * An explicit lock/logout while foregrounded can release capture protection
   * after the safe locked frame. A background lock deliberately retains it
   * until foreground, protecting the native recent-apps snapshot.
   */
  useEffect(() => {
    if (status === 'unlocked') {
      sensitiveSnapshotRef.current = true;
      return;
    }
    if (appStateRef.current !== 'active') return;

    requestAnimationFrame(() => {
      if (appStateRef.current === 'active' && getPhotoVaultStatus() !== 'unlocked') {
        sensitiveSnapshotRef.current = false;
        setPrivacyOverlayVisible(false);
        deactivateScreenProtectionIfSafe();
      }
    });
  }, [deactivateScreenProtectionIfSafe, status]);

  /**
   * Any identity change — logout, or a switch to another account — ends the
   * session at once. The session module also re-checks the uid on every
   * operation, so a stale grant could not authorize a new user even if this
   * effect had not run yet.
   *
   * The encrypted thumbnail cache is cleared here too. It survives a lock by
   * design, but an identity change is different: leaving the previous account's
   * ciphertext on a shared device buys nothing, and the next account must never
   * inherit it. Expressed as "keep only the current uid" rather than "remove
   * the previous uid", so it stays correct without tracking who was signed in
   * before — including a logout (`null` keeps nothing) and namespaces left by
   * an account this install never saw sign in.
   *
   * Ordering is deliberate: `lockPhotoVault` closes the session first, which
   * bumps the session generation, and the prune then bumps the cache epoch.
   * An in-flight download from the old session fails both checks and can
   * neither repopulate React state nor recreate the namespace just removed.
   *
   * The Comparator's plaintext export queue (`photo-vault/share/`) is cleared
   * here too, for the same reason as the encrypted cache: it survives a lock
   * by design (the OS share sheet may still be reading a file), but an
   * identity change is a real session boundary, and no export queued by the
   * previous account may reach the next one. Wrapped in try/catch — unlike
   * the lock/prune calls above, a filesystem sweep can throw on a genuine
   * error, and that must not skip resetting `capability`/`lastIssue` below.
   */
  useEffect(() => {
    lockPhotoVault();
    pruneCachedThumbnailsExcept(uid);
    try {
      cleanupPhotoVaultShareFiles();
    } catch {
      logPhotoVaultIssue('identityChange', 'vaultShareCleanupFailed');
    }
    setCapability(null);
    setLastIssue(null);
  }, [uid]);

  const value = useMemo<PhotoVaultContextValue>(
    () => ({ status, capability, lastIssue, unlock, lock, refreshCapability }),
    [status, capability, lastIssue, unlock, lock, refreshCapability],
  );

  return (
    <PhotoVaultCtx.Provider value={value}>
      <View style={styles.root}>
        {children}
        {privacyOverlayVisible ? (
          <View
            testID="photo-vault-privacy-overlay"
            pointerEvents="auto"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.privacyOverlay}
          />
        ) : null}
      </View>
    </PhotoVaultCtx.Provider>
  );
}

export function usePhotoVault(): PhotoVaultContextValue {
  const ctx = useContext(PhotoVaultCtx);
  if (!ctx) throw new Error('usePhotoVault must be used within a PhotoVaultProvider');
  return ctx;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  privacyOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: '#020010',
    zIndex: 10_000,
    elevation: 10_000,
  },
});
