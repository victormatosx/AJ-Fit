import { useEffect, useState } from 'react';
import { loadNutritionRolloutConfig, nutritionFlagEnabled } from './rollout';

/**
 * Gates the whole Nutrition tab client-side (`08_frontend` round brief §3):
 * the tab must not even appear while `nutritionEnabled` is off or unresolved
 * — never just render a "disabled" screen behind a visible tab icon.
 * `null` means "still resolving"; callers should treat that like `false`
 * (hidden) to avoid a flash of the tab appearing then disappearing.
 */
export function useNutritionEnabled(uid: string | null): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    if (!uid) { setEnabled(null); return; }
    let cancelled = false;
    loadNutritionRolloutConfig().then((config) => {
      if (!cancelled) setEnabled(nutritionFlagEnabled(uid, 'nutritionEnabled', config));
    }).catch(() => { if (!cancelled) setEnabled(false); });
    return () => { cancelled = true; };
  }, [uid]);

  return enabled;
}
