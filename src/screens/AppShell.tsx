import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon, IconName } from '../components/ui/Icon';
import { colors, fonts } from '../theme/tokens';
import { useAppState, TabId } from '../state/AppState';
import { HomeScreen } from './HomeScreen';
import { WorkoutScreen } from './WorkoutScreen';
import { ProgressScreen } from './ProgressScreen';
import { ProfileScreen } from './ProfileScreen';
import { ConsistencyScreen } from './ConsistencyScreen';
import { AssessmentScreen } from './AssessmentScreen';
import { SettingsScreen } from './SettingsScreen';

export function AppShell() {
  const { tab, setTab } = useAppState();
  const [showCal, setShowCal] = useState(false);
  const [showAssessment, setShowAssessment] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const overlayOpen = showCal || showAssessment || showSettings;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flex: 1 }}>
        {tab === 'home' && (
          <HomeScreen
            onStart={() => setTab('workout')}
            onOpenConsistency={() => setShowCal(true)}
          />
        )}
        {tab === 'workout' && <WorkoutScreen onDone={() => setTab('home')} />}
        {tab === 'progress' && <ProgressScreen />}
        {tab === 'profile' && (
          <ProfileScreen
            onOpenAssessment={() => setShowAssessment(true)}
            onOpenSettings={() => setShowSettings(true)}
          />
        )}
      </View>
      {tab !== 'workout' && !overlayOpen && <TabBar tab={tab} setTab={setTab} />}
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
          <SettingsScreen onBack={() => setShowSettings(false)} />
        </View>
      )}
    </View>
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
