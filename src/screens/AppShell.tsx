import { useState } from 'react';
import { View, Text, Pressable, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Icon, IconName } from '../components/ui/Icon';
import { HudCorners } from '../components/ui/Card';
import { Display, Slash } from '../components/ui/Display';
import { OutlineNumber } from '../components/ui/OutlineNumber';
import { colors, fonts } from '../theme/tokens';
import { useAppState, TabId } from '../state/AppState';
import { TODAY_WORKOUT } from '../lib/todayWorkout';
import { HomeScreen } from './HomeScreen';
import { WorkoutScreen } from './WorkoutScreen';
import { ProgressScreen } from './ProgressScreen';
import { ProfileScreen } from './ProfileScreen';
import { ConsistencyScreen } from './ConsistencyScreen';
import { AssessmentScreen } from './AssessmentScreen';
import { SettingsScreen } from './SettingsScreen';
import { EditProfileScreen } from './EditProfileScreen';
import { PaywallScreen } from './PaywallScreen';

export function AppShell() {
  const { tab, setTab } = useAppState();
  const [showCal, setShowCal] = useState(false);
  const [showAssessment, setShowAssessment] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showPremium, setShowPremium] = useState(false);
  const [showWorkoutConfirmation, setShowWorkoutConfirmation] = useState(false);
  const overlayOpen = showCal || showAssessment || showSettings || showEditProfile || showPremium;

  const selectTab = (nextTab: TabId) => {
    if (nextTab === 'workout' && tab !== 'workout') {
      setShowWorkoutConfirmation(true);
      return;
    }

    setTab(nextTab);
  };

  const startWorkout = () => {
    setShowWorkoutConfirmation(false);
    setTab('workout');
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flex: 1 }}>
        {tab === 'home' && (
          <HomeScreen
            onStart={() => setShowWorkoutConfirmation(true)}
            onOpenConsistency={() => setShowCal(true)}
          />
        )}
        {tab === 'workout' && <WorkoutScreen onDone={() => setTab('home')} />}
        {tab === 'progress' && <ProgressScreen />}
        {tab === 'profile' && (
          <ProfileScreen
            onOpenAssessment={() => setShowAssessment(true)}
            onOpenEditProfile={() => setShowEditProfile(true)}
            onOpenSettings={() => setShowSettings(true)}
            onOpenPremium={() => setShowPremium(true)}
          />
        )}
      </View>
      {tab !== 'workout' && !overlayOpen && <TabBar tab={tab} setTab={selectTab} />}
      <StartWorkoutConfirmation
        visible={showWorkoutConfirmation}
        onCancel={() => setShowWorkoutConfirmation(false)}
        onConfirm={startWorkout}
      />
      {showCal && (
        <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 40 }}>
          <ConsistencyScreen onBack={() => setShowCal(false)} />
        </View>
      )}
      {showAssessment && (
        <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 40 }}>
          <AssessmentScreen onBack={() => setShowAssessment(false)} />
        </View>
      )}
      {showSettings && (
        <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 40 }}>
          <SettingsScreen
            onBack={() => setShowSettings(false)}
            onOpenEditProfile={() => setShowEditProfile(true)}
          />
        </View>
      )}
      {showEditProfile && (
        <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 50 }}>
          <EditProfileScreen onBack={() => setShowEditProfile(false)} />
        </View>
      )}
      {showPremium && (
        <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 50 }}>
          <PaywallScreen
            onClose={() => setShowPremium(false)}
            closeAccessibilityLabel="Fechar assinatura"
          />
        </View>
      )}
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
  onConfirm: () => void;
}) {
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
        accessibilityLabel="Fechar confirmação de treino"
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

            <Slash>TREINO DE HOJE</Slash>
            <Display size={26} style={{ marginTop: 9 }}>
              INICIAR TREINO?
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
              Deseja iniciar agora
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
              {TODAY_WORKOUT.name}?
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Confirmar início do treino"
              onPress={onConfirm}
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
              <Icon name="play" size={12} color="#020010" />
              <Text
                style={{
                  color: '#020010',
                  fontFamily: fonts.display,
                  fontSize: 15,
                  letterSpacing: 1.4,
                  textTransform: 'uppercase',
                }}
              >
                Sim, iniciar
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={onCancel}
              style={{ alignSelf: 'center', paddingHorizontal: 18, paddingTop: 13, paddingBottom: 2 }}
            >
              <Text style={{ color: colors.mute, fontFamily: fonts.ui, fontSize: 13 }}>
                Agora não
              </Text>
            </Pressable>
          </LinearGradient>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function TabBar({ tab, setTab }: { tab: TabId; setTab: (t: TabId) => void }) {
  const items: { id: TabId; icon: IconName; label: string }[] = [
    { id: 'home', icon: 'home', label: 'HOME' },
    { id: 'workout', icon: 'dumbbell', label: 'TREINO' },
    { id: 'progress', icon: 'chart', label: 'EVOLUÇÃO' },
    { id: 'profile', icon: 'user', label: 'PERFIL' },
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
                <Icon
                  name={it.icon}
                  size={20}
                  color={active ? colors.accentHi : 'rgba(255,255,255,0.45)'}
                  stroke={active ? 2.1 : 1.7}
                />
                <Text
                  style={{
                    fontFamily: fonts.mono,
                    fontSize: 8.5,
                    letterSpacing: 1.5,
                    color: active ? colors.accentHi : 'rgba(255,255,255,0.4)',
                  }}
                >
                  {it.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </SafeAreaView>
  );
}
