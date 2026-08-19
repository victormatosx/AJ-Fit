import { useEffect, useState } from 'react';
import { StyleSheet, View, Text, Pressable, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { Icon, IconName } from '../components/ui/Icon';
import { HudCorners } from '../components/ui/Card';
import { Display, Slash } from '../components/ui/Display';
import { OutlineNumber } from '../components/ui/OutlineNumber';
import { colors, fonts } from '../theme/tokens';
import { useAppState, TabId } from '../state/AppState';
import { useAuth } from '../state/AuthContext';
import { PremiumActionProvider } from '../state/PremiumActionContext';
import { PremiumAction } from '../components/premium/PremiumAction';
import { versionedPhotoURL } from '../lib/profilePhotoUrl';
import { PASSWORD_PROVIDER_ID } from '../lib/authProviders';
import { HomeScreen } from './HomeScreen';
import { WorkoutScreen } from './WorkoutScreen';
import { ProgressScreen } from './ProgressScreen';
import { ProfileScreen } from './ProfileScreen';
import { ConsistencyScreen } from './ConsistencyScreen';
import { AssessmentScreen } from './AssessmentScreen';
import { SettingsScreen } from './SettingsScreen';
import { SecurityScreen } from './SecurityScreen';
import { ChangePasswordScreen } from './ChangePasswordScreen';
import { TotpEnrollmentScreen } from './TotpEnrollmentScreen';
import { TwoFactorSettingsScreen } from './TwoFactorSettingsScreen';
import { DeleteAccountScreen } from './DeleteAccountScreen';
import { EditProfileScreen } from './EditProfileScreen';
import { PaywallScreen } from './PaywallScreen';
import { SubscriptionCenterScreen } from './SubscriptionCenterScreen';
import { HelpCenterScreen } from './HelpCenterScreen';
import { HelpArticleScreen } from './HelpArticleScreen';
import { SupportFormScreen } from './SupportFormScreen';
import { SupportSuccessScreen } from './SupportSuccessScreen';
import type { HelpArticle, SupportTicketType } from '../types/support';
import { PersistentScreen } from '../components/navigation/PersistentScreen';
import { usePrewarmQueue } from '../components/navigation/usePrewarmQueue';

type SupportRoute =
  | { name: 'help' }
  | { name: 'article'; article: HelpArticle }
  | { name: 'form'; type: SupportTicketType; subject?: string }
  | { name: 'success' };

/**
 * Shared full-viewport geometry for every persistent screen — tabs and
 * overlays alike (docs/23_navegacao_e_lifecycle.md §3/§14). Defined once so
 * `activeStyle` and the `materialized` inactive geometry PersistentScreen
 * derives from it can never drift apart per screen (the exact class of bug
 * "prewarm layout A, then a different layout B on activation" would
 * reintroduce). Tabs need no `zIndex` — at most one of them is ever opaque
 * (`active`) at a time, and `opacity: 0` siblings never occlude regardless
 * of stacking order. Overlays add their own `zIndex` on top of this base.
 */
const FULL_BLEED = StyleSheet.create({
  tab: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  overlayZ40: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 40 },
  overlayZ50: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 50 },
  overlayZ60: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 60 },
  overlayZ70: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 70 },
});

/**
 * FASE 4 (docs/13_assinaturas_e_billing.md): `showPremium` — the on-demand
 * Paywall mount this file already had (originally only reachable from the
 * Subscription Center's "renovar") — now lives in this thin outer
 * component so `PremiumActionProvider` can wire its `onRequestUpgrade` to
 * the exact same trigger, instead of mounting a second `<PaywallScreen>`.
 * Everything else about AppShell is unchanged and lives in
 * `AppShellContent`, which reads `usePremiumAction()` from the provider
 * this wraps it in.
 */
export function AppShell() {
  const [showPremium, setShowPremium] = useState(false);
  return (
    <PremiumActionProvider onRequestUpgrade={() => setShowPremium(true)}>
      <AppShellContent showPremium={showPremium} setShowPremium={setShowPremium} />
    </PremiumActionProvider>
  );
}

function AppShellContent({
  showPremium,
  setShowPremium,
}: {
  showPremium: boolean;
  setShowPremium: (value: boolean) => void;
}) {
  const { tab, setTab } = useAppState();
  const { linkedProviders } = useAuth();
  // Single centralized prewarm schedule (docs/23_navegacao_e_lifecycle.md
  // §8/§14) — PREWARM_ROUTE_IDS in src/lib/prewarmRoutes.ts is the only
  // place route order/membership is declared; nothing here chains
  // `usePrewarm` calls by hand anymore.
  const prewarmed = usePrewarmQueue();
  const [showCal, setShowCal] = useState(false);
  const [showAssessment, setShowAssessment] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showSecurity, setShowSecurity] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showTwoFactor, setShowTwoFactor] = useState(false);
  const [showTotpEnrollment, setShowTotpEnrollment] = useState(false);
  const [totpRefreshToken, setTotpRefreshToken] = useState(0);
  const [showDeleteAccount, setShowDeleteAccount] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showSubscriptionCenter, setShowSubscriptionCenter] = useState(false);
  const [showWorkoutConfirmation, setShowWorkoutConfirmation] = useState(false);
  const [supportRoute, setSupportRoute] = useState<SupportRoute | null>(null);
  // HelpArticleScreen/SupportFormScreen are persistent+materialized but
  // can't be prewarmed with no real data (docs/23_navegacao_e_lifecycle.md
  // §14, "Suporte") — they need a valid `article`/`type` prop even while
  // `inactive`, so the last one the user actually opened is latched here
  // instead of read straight off `supportRoute` (which goes back to 'help'
  // or null the moment the user navigates away).
  const [lastArticle, setLastArticle] = useState<HelpArticle | null>(null);
  const [lastFormRoute, setLastFormRoute] = useState<{
    type: SupportTicketType;
    subject?: string;
  }>({ type: 'SUPPORT' });
  const canChangePassword = linkedProviders.includes(PASSWORD_PROVIDER_ID);
  const overlayOpen =
    showCal ||
    showAssessment ||
    showSettings ||
    showSecurity ||
    showChangePassword ||
    showTwoFactor ||
    showTotpEnrollment ||
    showEditProfile ||
    showSubscriptionCenter ||
    showDeleteAccount ||
    showPremium ||
    !!supportRoute;

  useEffect(() => {
    if (!canChangePassword) setShowChangePassword(false);
  }, [canChangePassword]);

  const selectTab = (nextTab: TabId) => {
    if (nextTab === 'workout' && tab !== 'workout') {
      setShowWorkoutConfirmation(true);
      return;
    }

    setTab(nextTab);
  };

  // FASE 3→5 (docs/13_assinaturas_e_billing.md): START_WORKOUT is a Premium
  // capability. `selectTab` below always routes a tap on the Workout icon
  // through the same confirmation flow, so this is the single real entry
  // point into the Workout tab — `<PremiumAction>` inside
  // `StartWorkoutConfirmation` gates it (Fase 5), meaning this function
  // itself now knows nothing about capabilities: it only runs at all when
  // already allowed. REGISTER_WORKOUT/REGISTER_LOAD/"registrar série" have
  // no independent entry point today — they only exist once inside the
  // session this call opens — so that same gate is also what protects them
  // (see Fase 3 report, "Decisão sobre REGISTER_SET").
  const startWorkout = () => {
    setShowWorkoutConfirmation(false);
    setTab('workout');
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {/*
        Main-tab lifecycle policy (docs/23_navegacao_e_lifecycle.md): Home,
        Progress and Profile are lazy-mounted + kept alive + materialized
        via `PersistentScreen` — each mounts (Progress/Profile: prewarmed
        ahead of the user's tap) and then stays mounted AND laid out
        (`inactiveMode="materialized"`, never `display:'none'`), only
        toggling opacity/interactivity, so switching tabs back and forth
        never re-triggers a mount *or* a first-layout/paint cycle. Home
        needs no `prewarm` — it's active from the very first render, so it's
        never in a "not yet laid out" state to begin with. Workout is the
        deliberate exception (still plain conditional render) — it's a live
        session screen; see the doc for why persisting it wasn't a safe
        default. Do NOT change any of the three below back to a bare
        `tab === 'x' && <Screen/>`, and do NOT give them `inactiveMode`
        `'detached'` — both are exactly the patterns that caused the
        intermittent entry flicker this architecture replaces.
      */}
      <View style={{ flex: 1 }}>
        <PersistentScreen active={tab === 'home'} activeStyle={FULL_BLEED.tab} inactiveMode="materialized">
          <HomeScreen
            onStart={() => setShowWorkoutConfirmation(true)}
            onOpenConsistency={() => setShowCal(true)}
            onOpenProfile={() => setTab('profile')}
          />
        </PersistentScreen>
        {tab === 'workout' && <WorkoutScreen onDone={() => setTab('home')} />}
        <PersistentScreen
          active={tab === 'progress'}
          prewarm={prewarmed.PROGRESS}
          activeStyle={FULL_BLEED.tab}
          inactiveMode="materialized"
        >
          <ProgressScreen onOpenAssessment={() => setShowAssessment(true)} />
        </PersistentScreen>
        <PersistentScreen
          active={tab === 'profile'}
          prewarm={prewarmed.PROFILE}
          activeStyle={FULL_BLEED.tab}
          inactiveMode="materialized"
        >
          <ProfileScreen
            onOpenAssessment={() => setShowAssessment(true)}
            onOpenEditProfile={() => setShowEditProfile(true)}
            onOpenSettings={() => setShowSettings(true)}
            onOpenSubscription={() => setShowSubscriptionCenter(true)}
          />
        </PersistentScreen>
      </View>
      {/*
        Always mounted (when not on Workout) instead of gated by
        `!overlayOpen`: unmounting the tab bar shrinks its flex-sibling by
        the tab bar's height, so the screen underneath an overlay resized
        (~758px -> ~874px) every time an overlay opened/closed — see
        docs/23_navegacao_e_lifecycle.md "Overlays: estabilidade de
        geometria". Overlays are always fully opaque + position:absolute
        covering the whole viewport, so the tab bar staying laid out (just
        untouchable/inaccessible) underneath is never visible.
      */}
      {tab !== 'workout' && (
        <View
          pointerEvents={overlayOpen ? 'none' : 'auto'}
          accessibilityElementsHidden={overlayOpen}
          importantForAccessibility={overlayOpen ? 'no-hide-descendants' : 'auto'}
        >
          <TabBar tab={tab} setTab={selectTab} />
        </View>
      )}
      <StartWorkoutConfirmation
        visible={showWorkoutConfirmation}
        onCancel={() => setShowWorkoutConfirmation(false)}
        onConfirm={startWorkout}
      />
      {/*
        Settings, Security, Assessment, EditProfile, Consistency, Support
        (help/success halves) and SubscriptionCenter are the secondary
        screens audited safe for prewarm + materialized keep-alive so far
        (docs/23_navegacao_e_lifecycle.md §5/§14) — each either has zero
        `useEffect`, or had its mount-tied effect migrated to
        `useScreenFocusEffect` (see AssessmentScreen/SubscriptionCenterScreen)
        and its form fields migrated to an explicit activation reset (see
        EditProfileScreen/SupportFormScreen). Every other secondary screen
        below is still a bare `{showX && (...)}` conditional (ephemeral) —
        each needs its own audit before it can move to this pattern.
      */}
      <PersistentScreen
        active={showCal}
        prewarm={prewarmed.CONSISTENCY}
        activeStyle={FULL_BLEED.overlayZ40}
        inactiveMode="materialized"
      >
        <ConsistencyScreen onBack={() => setShowCal(false)} />
      </PersistentScreen>
      <PersistentScreen
        active={showAssessment}
        prewarm={prewarmed.ASSESSMENT}
        activeStyle={FULL_BLEED.overlayZ40}
        inactiveMode="materialized"
      >
        <AssessmentScreen onBack={() => setShowAssessment(false)} />
      </PersistentScreen>
      <PersistentScreen
        active={showSettings}
        prewarm={prewarmed.SETTINGS}
        activeStyle={FULL_BLEED.overlayZ40}
        inactiveMode="materialized"
      >
        <SettingsScreen
          onBack={() => setShowSettings(false)}
          onOpenEditProfile={() => setShowEditProfile(true)}
          onOpenSecurity={() => setShowSecurity(true)}
          onOpenHelpCenter={() => setSupportRoute({ name: 'help' })}
          onReportProblem={() => {
            setLastFormRoute({ type: 'BUG' });
            setSupportRoute({ name: 'form', type: 'BUG' });
          }}
          onSendSuggestion={() => {
            setLastFormRoute({ type: 'FEEDBACK' });
            setSupportRoute({ name: 'form', type: 'FEEDBACK' });
          }}
          onOpenDeleteAccount={() => setShowDeleteAccount(true)}
        />
      </PersistentScreen>
      <PersistentScreen
        active={showSecurity}
        prewarm={prewarmed.SECURITY}
        activeStyle={FULL_BLEED.overlayZ50}
        inactiveMode="materialized"
      >
        <SecurityScreen
          onBack={() => setShowSecurity(false)}
          onOpenChangePassword={canChangePassword ? () => setShowChangePassword(true) : undefined}
          onOpenTwoFactor={() => setShowTwoFactor(true)}
          onOpenDeleteAccount={() => setShowDeleteAccount(true)}
        />
      </PersistentScreen>
      {/*
        ChangePassword/TwoFactorSettings/TotpEnrollment (docs/23_navegacao_
        e_lifecycle.md §10): the visual shell is prewarmed + materialized
        like every other screen above, but each screen wipes its own
        sensitive state (password fields, TOTP secret/QR, reauth challenge)
        the moment it deactivates — see the `useScreenFocusEffect` cleanup
        in each screen's source, which reuses that screen's own already-
        tested "cancel/reset" function rather than a new bespoke one. No
        password/secret/challenge is ever alive while these are
        materialized-but-inactive.
      */}
      <PersistentScreen
        active={showChangePassword && canChangePassword}
        prewarm={prewarmed.CHANGE_PASSWORD}
        activeStyle={FULL_BLEED.overlayZ60}
        inactiveMode="materialized"
      >
        <ChangePasswordScreen onBack={() => setShowChangePassword(false)} />
      </PersistentScreen>
      <PersistentScreen
        active={showTwoFactor}
        prewarm={prewarmed.TWO_FACTOR_SETTINGS}
        activeStyle={FULL_BLEED.overlayZ60}
        inactiveMode="materialized"
      >
        <TwoFactorSettingsScreen
          onBack={() => setShowTwoFactor(false)}
          onOpenEnrollment={() => setShowTotpEnrollment(true)}
          refreshToken={totpRefreshToken}
        />
      </PersistentScreen>
      <PersistentScreen
        active={showTotpEnrollment}
        prewarm={prewarmed.TOTP_ENROLLMENT}
        activeStyle={FULL_BLEED.overlayZ70}
        inactiveMode="materialized"
      >
        <TotpEnrollmentScreen
          onBack={() => setShowTotpEnrollment(false)}
          onCompleted={() => {
            setShowTotpEnrollment(false);
            setTotpRefreshToken((value) => value + 1);
          }}
        />
      </PersistentScreen>
      {/*
        DeleteAccountScreen (Fase 12): same z-tier as ChangePassword/
        TwoFactorSettings — a direct child of Security, not nested under
        either of them. Same sensitive-state discipline: the shell is safe
        to prewarm (no password/MFA-code/provider material exists until the
        user interacts), and `useAccountDeletionFlow`'s `reset()` wipes it
        all on deactivation via the screen's own `useScreenFocusEffect`.
      */}
      <PersistentScreen
        active={showDeleteAccount}
        prewarm={prewarmed.DELETE_ACCOUNT}
        activeStyle={FULL_BLEED.overlayZ60}
        inactiveMode="materialized"
      >
        <DeleteAccountScreen onBack={() => setShowDeleteAccount(false)} />
      </PersistentScreen>
      <PersistentScreen
        active={showEditProfile}
        prewarm={prewarmed.EDIT_PROFILE}
        activeStyle={FULL_BLEED.overlayZ50}
        inactiveMode="materialized"
      >
        <EditProfileScreen onBack={() => setShowEditProfile(false)} />
      </PersistentScreen>
      <PersistentScreen
        active={showSubscriptionCenter}
        prewarm={prewarmed.SUBSCRIPTION_CENTER}
        activeStyle={FULL_BLEED.overlayZ50}
        inactiveMode="materialized"
      >
        <SubscriptionCenterScreen
          onBack={() => setShowSubscriptionCenter(false)}
          onRenew={() => {
            setShowSubscriptionCenter(false);
            setShowPremium(true);
          }}
        />
      </PersistentScreen>
      {showPremium && (
        <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 50 }}>
          <PaywallScreen
            onClose={() => setShowPremium(false)}
            closeAccessibilityLabel="Fechar assinatura"
          />
        </View>
      )}
      {/*
        Support flow (docs/23_navegacao_e_lifecycle.md §14, "Suporte"):
        HelpCenter and Success take no data prop, so both are fully
        prewarm+materialized like every other screen above. HelpArticle and
        SupportForm need real data (`article`/`type`) that doesn't exist
        before the user's first real navigation there — prewarming them
        with placeholder data would be meaningless, so they're only
        lazy-mount + keep-alive (`active` alone, no `prewarm`): their FIRST
        opening still pays a real mount cost (same as any newly-visited
        persistent screen before this round's prewarm work), every
        subsequent switch between any of the 4 support screens is a pure
        activity toggle. `lastArticle`/`lastFormRoute` (declared above) keep
        the last real prop values alive so these two can stay materialized
        with valid props even while `supportRoute` has moved elsewhere.
      */}
      <PersistentScreen
        active={supportRoute?.name === 'help'}
        prewarm={prewarmed.SUPPORT}
        activeStyle={FULL_BLEED.overlayZ60}
        inactiveMode="materialized"
      >
        <HelpCenterScreen
          onBack={() => setSupportRoute(null)}
          onOpenArticle={(article) => {
            setLastArticle(article);
            setSupportRoute({ name: 'article', article });
          }}
          onOpenReportProblem={() => {
            setLastFormRoute({ type: 'BUG' });
            setSupportRoute({ name: 'form', type: 'BUG' });
          }}
          onOpenSuggestion={() => {
            setLastFormRoute({ type: 'FEEDBACK' });
            setSupportRoute({ name: 'form', type: 'FEEDBACK' });
          }}
          onOpenTalkToSupport={() => {
            setLastFormRoute({ type: 'SUPPORT' });
            setSupportRoute({ name: 'form', type: 'SUPPORT' });
          }}
        />
      </PersistentScreen>
      {lastArticle && (
        <PersistentScreen
          active={supportRoute?.name === 'article'}
          activeStyle={FULL_BLEED.overlayZ60}
          inactiveMode="materialized"
        >
          <HelpArticleScreen
            article={lastArticle}
            onBack={() => setSupportRoute({ name: 'help' })}
            onOpenTicket={(subject) => {
              setLastFormRoute({ type: 'SUPPORT', subject });
              setSupportRoute({ name: 'form', type: 'SUPPORT', subject });
            }}
          />
        </PersistentScreen>
      )}
      <PersistentScreen
        active={supportRoute?.name === 'form'}
        activeStyle={FULL_BLEED.overlayZ60}
        inactiveMode="materialized"
      >
        <SupportFormScreen
          type={lastFormRoute.type}
          initialSubject={lastFormRoute.subject}
          onBack={() => setSupportRoute(null)}
          onSuccess={() => setSupportRoute({ name: 'success' })}
        />
      </PersistentScreen>
      <PersistentScreen
        active={supportRoute?.name === 'success'}
        prewarm={prewarmed.SUPPORT}
        activeStyle={FULL_BLEED.overlayZ60}
        inactiveMode="materialized"
      >
        <SupportSuccessScreen onBack={() => setSupportRoute(null)} />
      </PersistentScreen>
    </View>
  );
}

function StartWorkoutConfirmation({
  visible,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  onCancel: () => void;
  /** FASE 5: this is the pure "start the session" action — it runs only
   *  when `<PremiumAction>` below has already allowed it. The caller no
   *  longer needs to know START_WORKOUT is a Premium capability at all. */
  onConfirm: () => void;
}) {
  const { t } = useTranslation('home');
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('todayCard.confirm.accessibilityClose', {
          defaultValue: t('todayCard.confirm.dismiss'),
        })}
        onPress={onCancel}
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.84)',
          justifyContent: 'center',
          paddingHorizontal: 34,
        }}
      >
        <Pressable
          accessibilityRole="none"
          onPress={(event) => event.stopPropagation()}
          style={{
            width: '100%',
            maxWidth: 340,
            alignSelf: 'center',
            borderRadius: 16,
            borderBottomRightRadius: 0,
            overflow: 'hidden',
            borderWidth: 1,
            borderColor: 'rgba(11,112,249,0.3)',
            backgroundColor: colors.bg,
            shadowColor: colors.accent,
            shadowOpacity: 0.18,
            shadowRadius: 20,
            shadowOffset: { width: 0, height: 10 },
            elevation: 10,
          }}
        >
          <LinearGradient
            colors={['#0a1a55', '#051042', '#04021c']}
            locations={[0, 0.45, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ padding: 18 }}
          >
            <HudCorners />
            <OutlineNumber
              size={118}
              style={{
                position: 'absolute',
                top: -28,
                right: -8,
                opacity: 0.28,
              }}
            >
              04
            </OutlineNumber>

            <Slash>{t('todayCard.kicker').toUpperCase()}</Slash>
            <Display size={26} style={{ marginTop: 9 }}>
              {t('todayCard.confirm.title').toUpperCase()}
            </Display>
            <Text
              style={{
                color: 'rgba(255,255,255,0.62)',
                fontFamily: fonts.ui,
                fontSize: 13,
                lineHeight: 19,
                marginTop: 8,
              }}
            >
              {t('todayCard.confirm.question')}
            </Text>
            <Text
              style={{
                color: '#fff',
                fontFamily: fonts.uiBold,
                fontSize: 14,
                lineHeight: 20,
                marginTop: 1,
              }}
            >
              {t('mock.today.name')}?
            </Text>

            {/* FASE 5: <PremiumAction> is the entry-point gate — locked stays
                tappable (never `disabled`), and closes this confirmation
                before either starting the session or opening
                PremiumRequiredSheet, exactly like the Fase 4 behavior this
                replaces. */}
            <PremiumAction capability="START_WORKOUT" onAllowed={onConfirm}>
              {({ locked, onPress }) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    locked
                      ? t('todayCard.confirm.accessibilityConfirmLocked')
                      : t('todayCard.confirm.accessibilityConfirm')
                  }
                  onPress={() => {
                    onCancel();
                    onPress();
                  }}
                  style={{
                    height: 48,
                    marginTop: 18,
                    borderRadius: 10,
                    borderBottomRightRadius: 0,
                    backgroundColor: '#fff',
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 9,
                  }}
                >
                  <Icon name={locked ? 'lock' : 'play'} size={12} color="#020010" />
                  <Text
                    style={{
                      color: '#020010',
                      fontFamily: fonts.display,
                      fontSize: 15,
                      letterSpacing: 1.4,
                      textTransform: 'uppercase',
                    }}
                  >
                    {t('todayCard.confirm.startNow')}
                  </Text>
                </Pressable>
              )}
            </PremiumAction>
            <Pressable
              accessibilityRole="button"
              onPress={onCancel}
              style={{ alignSelf: 'center', paddingHorizontal: 18, paddingTop: 13, paddingBottom: 2 }}
            >
              <Text style={{ color: colors.mute, fontFamily: fonts.ui, fontSize: 13 }}>
                {t('todayCard.confirm.notNow')}
              </Text>
            </Pressable>
          </LinearGradient>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function TabBar({ tab, setTab }: { tab: TabId; setTab: (t: TabId) => void }) {
  const { t } = useTranslation('common');
  const { profile } = useAuth();
  const profilePhotoURL = profile?.profile.photoURL;
  const items: { id: TabId; icon: IconName; labelKey: 'home' | 'workout' | 'progress' | 'profile' }[] = [
    { id: 'home', icon: 'home', labelKey: 'home' },
    { id: 'workout', icon: 'dumbbell', labelKey: 'workout' },
    { id: 'progress', icon: 'chart', labelKey: 'progress' },
    { id: 'profile', icon: 'user', labelKey: 'profile' },
  ];
  return (
    <SafeAreaView edges={['bottom']} style={{ backgroundColor: 'transparent' }}>
      <View style={{ paddingHorizontal: 14, paddingBottom: 6, paddingTop: 8 }}>
        <View
          style={{
            backgroundColor: 'rgba(7, 3, 26, 0.92)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.07)',
            borderRadius: 18,
            padding: 7,
            flexDirection: 'row',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: -8 },
            shadowOpacity: 0.5,
            shadowRadius: 30,
            elevation: 12,
          }}
        >
          {items.map((it) => {
            const active = tab === it.id;
            return (
              <Pressable
                key={it.id}
                onPress={() => setTab(it.id)}
                style={{
                  flex: 1,
                  paddingTop: 9,
                  paddingBottom: 7,
                  borderRadius: 12,
                  alignItems: 'center',
                  gap: 4,
                  backgroundColor: active ? 'rgba(11,112,249,0.16)' : 'transparent',
                }}
              >
                {active && (
                  <View
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: '30%',
                      right: '30%',
                      height: 2,
                      backgroundColor: colors.accentHi,
                      borderRadius: 2,
                    }}
                  />
                )}
                {it.id === 'profile' && profilePhotoURL ? (
                  <Image
                    source={versionedPhotoURL(
                      profilePhotoURL,
                      profile?.profile.photoVersion,
                    )}
                    cachePolicy="memory-disk"
                    contentFit="cover"
                    transition={120}
                    priority="high"
                    accessible={false}
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                    }}
                  />
                ) : (
                  <Icon
                    name={it.icon}
                    size={20}
                    color={active ? colors.accentHi : 'rgba(255,255,255,0.45)'}
                    stroke={active ? 2.1 : 1.7}
                  />
                )}
                <Text
                  style={{
                    fontFamily: fonts.mono,
                    fontSize: 8.5,
                    letterSpacing: 1.5,
                    color: active ? colors.accentHi : 'rgba(255,255,255,0.4)',
                  }}
                >
                  {t(`navigation.${it.labelKey}`).toUpperCase()}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </SafeAreaView>
  );
}
