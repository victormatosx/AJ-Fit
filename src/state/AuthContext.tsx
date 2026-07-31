import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { User } from 'firebase/auth';
import {
  signUpWithEmail,
  signInWithEmail,
  resetPassword,
  signOutUser,
  subscribeToAuthState,
  logAuthError,
  toAuthError,
} from '../services/auth';
import {
  provisionNewUser,
  ensureUserProvisioned,
  getUserProfile,
  getLatestQuestionnaire,
  type QuestionnaireAnswers,
  type QuestionnaireDoc,
  type UserProfile,
} from '../services/userProfile';
import {
  signInWithProvider as socialSignIn,
  completeLinkingWithPassword as socialLinkPassword,
  completeLinkingWithProvider as socialLinkProvider,
  getLinkedProviders,
  type SocialProvider,
} from '../services/socialAuth';

type AuthCtx = {
  /** Current authenticated user (Firebase Auth), or null when signed out. */
  user: User | null;
  /** Main Firestore user document, or null. */
  profile: UserProfile | null;
  /** Most recent questionnaire for the current user, or null. */
  questionnaire: QuestionnaireDoc | null;
  /** Linked sign-in providerIds, e.g. ['password','google.com','apple.com']. */
  linkedProviders: string[];
  /** True while the initial auth state is being resolved on startup. */
  initializing: boolean;
  /** True while `profile`/`questionnaire` are catching up to a just-set `user`. */
  profileLoading: boolean;
  signUp: (
    email: string,
    password: string,
    name: string,
    answers: QuestionnaireAnswers,
  ) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  /** Sign in with a social provider (may throw AccountLinkingRequiredError). */
  signInWithProvider: (
    provider: SocialProvider,
    answers?: QuestionnaireAnswers | null,
  ) => Promise<void>;
  /** Complete a pending link using the existing email/password account. */
  completeLinkingWithPassword: (
    email: string,
    password: string,
    answers?: QuestionnaireAnswers | null,
  ) => Promise<void>;
  /** Complete a pending link using another social provider. */
  completeLinkingWithProvider: (
    provider: SocialProvider,
    answers?: QuestionnaireAnswers | null,
  ) => Promise<void>;
  reset: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Re-reads the user document and latest questionnaire into global state. */
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [questionnaire, setQuestionnaire] = useState<QuestionnaireDoc | null>(null);
  const [initializing, setInitializing] = useState(true);
  // True while `user` may already be set but `profile`/`questionnaire` have not
  // caught up yet (the gap between `setUser` and `loadUserState` resolving in
  // signIn/signUp/social flows). Consumers that route navigation off
  // `questionnaire` must wait this out, or they'd briefly see a stale
  // "no questionnaire" state and bounce to the questionnaire screen.
  const [profileLoading, setProfileLoading] = useState(false);

  // Monotonic token so a slower/older load can never overwrite a newer one
  // (e.g. the listener's pre-write read racing signUp's post-write read).
  const loadSeq = useRef(0);

  /** Loads the user document + latest questionnaire. Read-only. */
  const loadUserState = useCallback(async (uid: string) => {
    const seq = ++loadSeq.current;
    setProfileLoading(true);
    try {
      const [nextProfile, nextQuestionnaire] = await Promise.all([
        getUserProfile(uid),
        getLatestQuestionnaire(uid),
      ]);
      if (seq !== loadSeq.current) return; // superseded by a newer load
      setProfile(nextProfile);
      setQuestionnaire(nextQuestionnaire);
    } finally {
      if (seq === loadSeq.current) setProfileLoading(false);
    }
  }, []);

  const clearUserState = useCallback(() => {
    loadSeq.current += 1; // cancel any in-flight load
    setProfile(null);
    setQuestionnaire(null);
    setProfileLoading(false);
  }, []);

  // The auth listener ONLY reads — it never creates documents. This removes the
  // creation race entirely (creation lives solely in signUp).
  useEffect(() => {
    const unsubscribe = subscribeToAuthState(async (nextUser) => {
      setUser(nextUser);
      try {
        if (nextUser) await loadUserState(nextUser.uid);
        else clearUserState();
      } catch (err) {
        logAuthError('listener:load-profile', err);
        clearUserState();
      } finally {
        setInitializing(false);
      }
    });
    return unsubscribe;
  }, [loadUserState, clearUserState]);

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      profile,
      questionnaire,
      linkedProviders: user ? getLinkedProviders(user) : [],
      initializing,
      profileLoading,
      signUp: async (email, password, name, answers) => {
        // Single, authoritative creation flow — runs exactly once per account.
        const newUser = await signUpWithEmail(email, password, name);
        try {
          await provisionNewUser(newUser, { name, answers });
          setUser(newUser);
          await loadUserState(newUser.uid); // authoritative post-write load
        } catch (err) {
          logAuthError('signup:firestore-profile', err);
          throw toAuthError(err);
        }
      },
      signIn: async (email, password) => {
        const authedUser = await signInWithEmail(email, password);
        try {
          setUser(authedUser);
          await loadUserState(authedUser.uid);
        } catch (err) {
          logAuthError('signin:load-profile', err);
          throw toAuthError(err);
        }
      },
      signInWithProvider: async (provider, answers) => {
        // The credential sign-in triggers the read-only listener; provisioning
        // stays here (explicit flow) and only creates the doc on first login.
        const authedUser = await socialSignIn(provider);
        try {
          await ensureUserProvisioned(authedUser, { answers });
          setUser(authedUser);
          await loadUserState(authedUser.uid);
        } catch (err) {
          logAuthError(`${provider}:firestore-profile`, err);
          throw toAuthError(err);
        }
      },
      completeLinkingWithPassword: async (email, password, answers) => {
        const linkedUser = await socialLinkPassword(email, password);
        try {
          await ensureUserProvisioned(linkedUser, { answers });
          setUser(linkedUser);
          await loadUserState(linkedUser.uid);
        } catch (err) {
          logAuthError('link:password:firestore-profile', err);
          throw toAuthError(err);
        }
      },
      completeLinkingWithProvider: async (provider, answers) => {
        const linkedUser = await socialLinkProvider(provider);
        try {
          await ensureUserProvisioned(linkedUser, { answers });
          setUser(linkedUser);
          await loadUserState(linkedUser.uid);
        } catch (err) {
          logAuthError(`link:${provider}:firestore-profile`, err);
          throw toAuthError(err);
        }
      },
      reset: async (email) => {
        await resetPassword(email);
      },
      logout: async () => {
        await signOutUser();
      },
      refreshProfile: async () => {
        if (user) await loadUserState(user.uid);
      },
    }),
    [user, profile, questionnaire, initializing, profileLoading, loadUserState],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
