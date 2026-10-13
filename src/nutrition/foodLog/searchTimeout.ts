export const FOOD_LOG_SEARCH_TIMEOUT_MS = 10_000;

/** Bounds UI waiting time. Firestore has no cancellable getDocs API; a late
 * transport completion is ignored and is never inserted into the cache. */
export function withFoodLogSearchTimeout<T>(promise: Promise<T>, timeoutMs = FOOD_LOG_SEARCH_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CATALOG_SEARCH_TIMEOUT')), timeoutMs);
    promise.then((value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); });
  });
}
