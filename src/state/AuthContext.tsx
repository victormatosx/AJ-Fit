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
} from '../services/auth';
import {
  provisionNewUser,
  getUserProfile,
  getLatestQuestionnaire,
  type QuestionnaireAnswers,
  type QuestionnaireDoc,
  type UserProfile,
} from '../services/userProfile';

type AuthCtx = {
  /** Current authenticated user (Firebase Auth), or null when signed out. */
  user: User | null;
  /** Main Firestore user document, or null. */
  profile: UserProfile | null;
  /** Most recent questionnaire for the current user, or null. */
  questionnaire: QuestionnaireDoc | null;
  /** True while the initial auth state is being resolved on startup. */
  initializing: boolean;
  signUp: (
    email: string,
    password: string,
    name: string,
    answers: QuestionnaireAnswers,
  ) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
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

  // Monotonic token so a slower/older load can never overwrite a newer one
  // (e.g. the listener's pre-write read racing signUp's post-write read).
  const loadSeq = useRef(0);

  /** Loads the user document + latest questionnaire. Read-only. */
  const loadUserState = useCallback(async (uid: string) => {
    const seq = ++loadSeq.current;
    const [nextProfile, nextQuestionnaire] = await Promise.all([
      getUserProfile(uid),
      getLatestQuestionnaire(uid),
    ]);
    if (seq !== loadSeq.current) return; // superseded by a newer load
    setProfile(nextProfile);
    setQuestionnaire(nextQuestionnaire);
  }, []);

  const clearUserState = useCallback(() => {
    loadSeq.current += 1; // cancel any in-flight load
    setProfile(null);
    setQuestionnaire(null);
  }, []);

  // The auth listener ONLY reads — it never creates documents. This removes the
  // creation race entirely (creation lives solely in signUp).
  useEffect(() => {
    const unsubscribe = subscribeToAuthState(async (nextUser) => {
      setUser(nextUser);
      try {
        if (nextUser) await loadUserState(nextUser.uid);
        else clearUserState();
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
      initializing,
      signUp: async (email, password, name, answers) => {
        // Single, authoritative creation flow — runs exactly once per account.
        const newUser = await signUpWithEmail(email, password, name);
        await provisionNewUser(newUser, { name, answers });
        await loadUserState(newUser.uid); // authoritative post-write load
      },
      signIn: async (email, password) => {
        await signInWithEmail(email, password);
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
    [user, profile, questionnaire, initializing, loadUserState],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
