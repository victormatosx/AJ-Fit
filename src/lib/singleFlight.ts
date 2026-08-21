/**
 * Synchronous in-process barrier for an async operation.
 *
 * The first caller installs the Promise before the operation starts. Every
 * caller arriving while it is pending receives that same Promise. `finally`
 * releases the barrier after success or failure, including provider
 * cancellation errors, so a later legitimate attempt can always start.
 */
export type SingleFlight<T> = {
  run(operation: () => Promise<T>): Promise<T>;
  isRunning(): boolean;
};

export function createSingleFlight<T>(): SingleFlight<T> {
  let inFlight: Promise<T> | null = null;

  return {
    run(operation) {
      if (inFlight) return inFlight;

      let tracked: Promise<T>;
      tracked = Promise.resolve()
        .then(operation)
        .finally(() => {
          if (inFlight === tracked) inFlight = null;
        });
      inFlight = tracked;
      return tracked;
    },

    isRunning() {
      return inFlight !== null;
    },
  };
}
