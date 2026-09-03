/**
 * Serializes accepted execution mutations and remembers failed logical keys.
 * A successful retry for the same key clears its failure. `flush()` is the
 * authoritative finish barrier: it waits for every accepted write and fails
 * while any mutation remains unreconciled.
 */
export class WorkoutMutationQueue {
  private tail: Promise<void> = Promise.resolve();
  private readonly failedKeys = new Map<string, unknown>();
  private readonly failedOperations = new Map<string, () => Promise<void>>();

  enqueue(key: string, operation: () => Promise<void>): Promise<void> {
    const exposed = this.tail.then(operation);
    const settled = exposed.then(
      () => {
        this.failedKeys.delete(key);
        this.failedOperations.delete(key);
      },
      (error) => {
        this.failedKeys.set(key, error);
        this.failedOperations.set(key, operation);
      },
    );
    this.tail = settled;
    return exposed;
  }

  async flush(): Promise<void> {
    await this.tail;
    if (this.failedOperations.size > 0) {
      // A set may have failed transiently after the UI accepted it and moved
      // forward. Retry every latest logical mutation once at the finish
      // barrier; stable keys make this safe and a second failure remains a
      // hard block instead of being swept to SKIPPED.
      const retries = [...this.failedOperations.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, operation]) => this.enqueue(key, operation));
      await Promise.allSettled(retries);
      await this.tail;
    }
    if (this.failedKeys.size > 0) {
      throw new Error(`WORKOUT_MUTATIONS_UNRECONCILED:${[...this.failedKeys.keys()].sort().join(',')}`);
    }
  }

  reset(): void {
    this.tail = Promise.resolve();
    this.failedKeys.clear();
    this.failedOperations.clear();
  }
}
