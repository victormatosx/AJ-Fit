export type SubscriptionPhase =
  | 'waiting-auth'
  | 'configuring'
  | 'syncing-identity'
  | 'ready'
  | 'error';

export type SubscriptionErrorKind =
  | 'configuration'
  | 'identity'
  | 'offline'
  | 'temporary';

export type SubscriptionFailure = {
  kind: SubscriptionErrorKind;
  message: string;
};

export type IdentityScopedSnapshot<TCustomerInfo> = {
  uid: string;
  generation: number;
  customerInfo: TCustomerInfo;
};

export type SubscriptionLifecycleState<TCustomerInfo> = {
  uid: string | null;
  generation: number;
  phase: SubscriptionPhase;
  refreshing: boolean;
  snapshot: IdentityScopedSnapshot<TCustomerInfo> | null;
  error: SubscriptionFailure | null;
};

export type SubscriptionLifecycleEvent<TCustomerInfo> =
  | { type: 'auth-waiting'; generation: number }
  | { type: 'identity-changed'; uid: string | null; generation: number }
  | { type: 'configuration-started'; uid: string | null; generation: number }
  | { type: 'identity-sync-started'; uid: string | null; generation: number }
  | {
      type: 'identity-resolved';
      uid: string | null;
      generation: number;
      customerInfo: TCustomerInfo | null;
    }
  | {
      type: 'identity-failed';
      uid: string | null;
      generation: number;
      error: SubscriptionFailure;
    }
  | { type: 'refresh-started'; uid: string; generation: number }
  | {
      type: 'customer-info-updated';
      uid: string;
      generation: number;
      customerInfo: TCustomerInfo;
    }
  | {
      type: 'refresh-failed';
      uid: string;
      generation: number;
      error: SubscriptionFailure;
    };

export function createInitialSubscriptionLifecycleState<TCustomerInfo>(): SubscriptionLifecycleState<TCustomerInfo> {
  return {
    uid: null,
    generation: 0,
    phase: 'waiting-auth',
    refreshing: false,
    snapshot: null,
    error: null,
  };
}

function isCurrentIdentity<TCustomerInfo>(
  state: SubscriptionLifecycleState<TCustomerInfo>,
  event: { uid: string | null; generation: number },
): boolean {
  return state.uid === event.uid && state.generation === event.generation;
}

/**
 * Pure identity-scoped state machine used by SubscriptionContext.
 *
 * Every asynchronous result carries both the Firebase UID and the generation
 * captured when it started. A result for an older identity is therefore a
 * no-op even if it resolves after a newer login, logout, listener callback,
 * purchase, restore, or foreground refresh.
 */
export function reduceSubscriptionLifecycle<TCustomerInfo>(
  state: SubscriptionLifecycleState<TCustomerInfo>,
  event: SubscriptionLifecycleEvent<TCustomerInfo>,
): SubscriptionLifecycleState<TCustomerInfo> {
  switch (event.type) {
    case 'auth-waiting':
      return {
        uid: null,
        generation: event.generation,
        phase: 'waiting-auth',
        refreshing: false,
        snapshot: null,
        error: null,
      };

    case 'identity-changed':
      return {
        uid: event.uid,
        generation: event.generation,
        phase: 'configuring',
        refreshing: false,
        snapshot: null,
        error: null,
      };

    case 'configuration-started':
      if (!isCurrentIdentity(state, event)) return state;
      return { ...state, phase: 'configuring', refreshing: false, error: null };

    case 'identity-sync-started':
      if (!isCurrentIdentity(state, event)) return state;
      return { ...state, phase: 'syncing-identity', refreshing: false, error: null };

    case 'identity-resolved':
      if (!isCurrentIdentity(state, event)) return state;
      return {
        ...state,
        phase: 'ready',
        refreshing: false,
        snapshot:
          event.uid && event.customerInfo
            ? {
                uid: event.uid,
                generation: event.generation,
                customerInfo: event.customerInfo,
              }
            : null,
        error: null,
      };

    case 'identity-failed':
      if (!isCurrentIdentity(state, event)) return state;
      return {
        ...state,
        phase: 'error',
        refreshing: false,
        snapshot: null,
        error: event.error,
      };

    case 'refresh-started':
      if (!isCurrentIdentity(state, event) || state.snapshot?.uid !== event.uid) return state;
      return { ...state, refreshing: true, error: null };

    case 'customer-info-updated':
      if (!isCurrentIdentity(state, event) || state.uid === null) return state;
      return {
        ...state,
        phase: 'ready',
        refreshing: false,
        snapshot: {
          uid: event.uid,
          generation: event.generation,
          customerInfo: event.customerInfo,
        },
        error: null,
      };

    case 'refresh-failed':
      if (!isCurrentIdentity(state, event)) return state;
      return {
        ...state,
        // A transient refresh failure never erases a CustomerInfo already
        // confirmed for this exact UID. With no confirmed snapshot, access
        // remains unresolved/fail-closed.
        phase: state.snapshot?.uid === event.uid ? 'ready' : 'error',
        refreshing: false,
        error: event.error,
      };
  }
}

export function selectIdentityCustomerInfo<TCustomerInfo>(
  state: SubscriptionLifecycleState<TCustomerInfo>,
  uid: string | null,
): TCustomerInfo | null {
  if (!uid || state.uid !== uid || state.snapshot?.uid !== uid) return null;
  if (state.snapshot.generation !== state.generation) return null;
  return state.snapshot.customerInfo;
}

export function shouldRevalidateOnAppStateChange(
  previous: string | null,
  next: string,
): boolean {
  return next === 'active' && (previous === 'background' || previous === 'inactive');
}

export type IdentityScopedSingleFlight = {
  run: <T>(key: string, operation: () => Promise<T>) => Promise<T>;
};

/** Coalesces concurrent refreshes for the same UID + identity generation. */
export function createIdentityScopedSingleFlight(): IdentityScopedSingleFlight {
  let active: { key: string; promise: Promise<unknown> } | null = null;

  return {
    run<T>(key: string, operation: () => Promise<T>): Promise<T> {
      if (active?.key === key) return active.promise as Promise<T>;

      const promise = operation().finally(() => {
        if (active?.promise === promise) active = null;
      });
      active = { key, promise };
      return promise;
    },
  };
}
