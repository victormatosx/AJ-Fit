import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Modal,
  TextInput,
  Animated,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { ScreenBg } from '../components/ui/ScreenBg';
import { Display, Slash, MonoLabel } from '../components/ui/Display';
import { Card } from '../components/ui/Card';
import { CtaButton } from '../components/ui/CtaButton';
import { SegBar } from '../components/ui/SegBar';
import { Icon } from '../components/ui/Icon';
import { OutlineNumber } from '../components/ui/OutlineNumber';
import { ExerciseGif } from '../components/fitness/ExerciseGif';
import { colors, fonts, displayLineHeight } from '../theme/tokens';

const SUBS_KEY = 'ajfit-subs';

type SetData = { r: number; w: number };
type SubOption = { name: string; target: string; db: string };
type Exercise = {
  id: string;
  name: string;
  target: string;
  db: string;
  sets: SetData[];
  rest: number;
  subs: SubOption[];
};

const EXERCISES: Exercise[] = [
  {
    id: 'supino-reto',
    name: 'Supino Reto',
    target: 'Peitoral',
    db: 'Barbell_Bench_Press_-_Medium_Grip',
    sets: [{ r: 10, w: 60 }, { r: 8, w: 70 }, { r: 8, w: 75 }, { r: 6, w: 80 }],
    rest: 90,
    subs: [
      { name: 'Supino Reto Halteres', target: 'Peitoral', db: 'Dumbbell_Bench_Press' },
      { name: 'Supino Máquina', target: 'Peitoral', db: 'Machine_Bench_Press' },
    ],
  },
  {
    id: 'supino-incl',
    name: 'Supino Inclinado Halter',
    target: 'Peitoral Superior',
    db: 'Incline_Dumbbell_Bench_With_Palms_Facing_In',
    sets: [{ r: 10, w: 24 }, { r: 10, w: 26 }, { r: 8, w: 28 }],
    rest: 75,
    subs: [
      { name: 'Supino Inclinado Barra', target: 'Peitoral Superior', db: 'Barbell_Incline_Bench_Press_Medium-Grip' },
      { name: 'Crossover Baixo', target: 'Peitoral Superior', db: 'Low_Cable_Crossover' },
    ],
  },
  {
    id: 'crucifixo',
    name: 'Crucifixo Polia',
    target: 'Peitoral',
    db: 'Cable_Crossover',
    sets: [{ r: 12, w: 14 }, { r: 12, w: 16 }, { r: 10, w: 18 }],
    rest: 60,
    subs: [
      { name: 'Crucifixo Halteres', target: 'Peitoral', db: 'Dumbbell_Flyes' },
      { name: 'Peck Deck', target: 'Peitoral', db: 'Butterfly' },
    ],
  },
  {
    id: 'militar',
    name: 'Desenvolvimento Militar',
    target: 'Ombro',
    db: 'Standing_Military_Press',
    sets: [{ r: 10, w: 30 }, { r: 8, w: 35 }, { r: 8, w: 40 }],
    rest: 90,
    subs: [
      { name: 'Desenvolvimento Halteres', target: 'Ombro', db: 'Dumbbell_Shoulder_Press' },
      { name: 'Desenvolvimento Arnold', target: 'Ombro', db: 'Arnold_Dumbbell_Press' },
    ],
  },
  {
    id: 'lateral',
    name: 'Elevação Lateral',
    target: 'Ombro Lateral',
    db: 'Side_Lateral_Raise',
    sets: [{ r: 12, w: 8 }, { r: 12, w: 10 }, { r: 10, w: 12 }],
    rest: 60,
    subs: [
      { name: 'Elevação Lateral Polia', target: 'Ombro Lateral', db: 'Cable_Shoulder_Press' },
      { name: 'Elevação Frontal', target: 'Ombro Frontal', db: 'Front_Dumbbell_Raise' },
    ],
  },
  {
    id: 'pulley',
    name: 'Tríceps Pulley',
    target: 'Tríceps',
    db: 'Triceps_Pushdown',
    sets: [{ r: 12, w: 20 }, { r: 10, w: 24 }, { r: 10, w: 26 }],
    rest: 60,
    subs: [
      { name: 'Tríceps Corda', target: 'Tríceps', db: 'Tricep_Dumbbell_Kickback' },
      { name: 'Tríceps Testa', target: 'Tríceps', db: 'Barbell_Skullcrusher_Extension' },
    ],
  },
  {
    id: 'frances',
    name: 'Tríceps Francês',
    target: 'Tríceps',
    db: 'EZ-Bar_Skullcrusher',
    sets: [{ r: 10, w: 14 }, { r: 10, w: 16 }, { r: 8, w: 18 }],
    rest: 60,
    subs: [
      { name: 'Tríceps Testa Halter', target: 'Tríceps', db: 'Seated_Dumbbell_Tricep_Press' },
      { name: 'Coice Halter', target: 'Tríceps', db: 'Tricep_Dumbbell_Kickback' },
    ],
  },
  {
    id: 'paralelas',
    name: 'Mergulho Paralelas',
    target: 'Tríceps & Peito',
    db: 'Dips_-_Triceps_Version',
    sets: [{ r: 10, w: 0 }, { r: 8, w: 0 }, { r: 8, w: 0 }],
    rest: 60,
    subs: [
      { name: 'Dips Máquina', target: 'Tríceps', db: 'Weighted_Bench_Dip' },
      { name: 'Flexão Fechada', target: 'Tríceps', db: 'Close-Grip_Push-Up_off_of_a_Wall' },
    ],
  },
];

type Props = { onDone: () => void; onMinimize?: () => void };

export function WorkoutScreen({ onDone, onMinimize }: Props) {
  // Queue of exercise indices in current order (head = current)
  const [order, setOrder] = useState<number[]>(() => EXERCISES.map((_, i) => i));
  // exIdx -> sets completed
  const [progress, setProgress] = useState<Record<number, number>>({});
  // exercise indices that were skipped and later requeued
  const [skipped, setSkipped] = useState<number[]>([]);
  // `${exId}-${setIdx}` -> logged weight for the session
  const [logged, setLogged] = useState<Record<string, number>>({});

  const [resting, setResting] = useState(false);
  const [restLeft, setRestLeft] = useState(0);
  const [pending, setPending] = useState<{ exId: string; setIdx: number } | null>(null);
  const [regWeight, setRegWeight] = useState(0);

  const [queueOpen, setQueueOpen] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  const [subSheet, setSubSheet] = useState(false);
  const [pendingSub, setPendingSub] = useState<SubOption | null>(null);

  const [finished, setFinished] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const [permSubs, setPermSubs] = useState<Record<string, SubOption>>({});
  const [sessionSubs, setSessionSubs] = useState<Record<string, SubOption>>({});

  const [pr, setPr] = useState<{ weight: number; exName: string; prev: number } | null>(null);
  const [exComplete, setExComplete] = useState<{ name: string; nextName: string } | null>(null);

  // load persisted subs
  useEffect(() => {
    AsyncStorage.getItem(SUBS_KEY)
      .then((raw) => {
        if (!raw) return;
        try {
          setPermSubs(JSON.parse(raw));
        } catch {
          /* ignore malformed */
        }
      })
      .catch(() => {
        /* ignore */
      });
  }, []);

  // session timer
  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const ovr = (id: string): SubOption | null => sessionSubs[id] || permSubs[id] || null;
  const resolve = (base: Exercise): Exercise => {
    const o = ovr(base.id);
    return o ? { ...base, name: o.name, target: o.target, db: o.db } : base;
  };

  const exIdx = order.length > 0 ? order[0] : 0;
  const baseEx = EXERCISES[exIdx];
  const ex = resolve(baseEx);
  const setIdx = progress[exIdx] || 0;
  const exDone = (i: number) => (progress[i] || 0) >= EXERCISES[i].sets.length;

  const totalSets = EXERCISES.reduce((a, e) => a + e.sets.length, 0);
  const doneSets = EXERCISES.reduce(
    (a, e, i) => a + Math.min(progress[i] || 0, e.sets.length),
    0
  );
  const pct = doneSets / totalSets;
  const wasSkipped = skipped.includes(exIdx);
  const isSubbed = !!ovr(baseEx.id);
  const isLastOverall = order.length === 1 && setIdx === ex.sets.length - 1;

  const lastWeight = (e: Exercise, i: number) =>
    logged[`${e.id}-${i}`] ?? e.sets[i].w;

  const fmt = (s: number) =>
    `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

  const advanceAfterRest = () => {
    let nextLogged = logged;
    if (pending && regWeight > 0) {
      const baseId = EXERCISES[exIdx].id;
      const prevBest = Math.max(
        ...EXERCISES[exIdx].sets.map((s) => s.w),
        ...Object.entries(logged)
          .filter(([k]) => k.startsWith(baseId + '-'))
          .map(([, v]) => v),
        0
      );
      if (regWeight > prevBest && prevBest > 0) {
        setPr({ weight: regWeight, exName: ex.name, prev: prevBest });
        setTimeout(() => setPr(null), 2600);
      }
      nextLogged = { ...logged, [`${pending.exId}-${pending.setIdx}`]: regWeight };
      setLogged(nextLogged);
    }
    const finishedSet = setIdx + 1;
    const nextProgress = { ...progress, [exIdx]: finishedSet };
    setProgress(nextProgress);
    setResting(false);
    setPending(null);
    setRegWeight(0);

    if (finishedSet >= ex.sets.length) {
      const completedName = ex.name;
      const nextOrder = order.slice(1);
      setOrder(nextOrder);
      setSkipped((s) => s.filter((x) => x !== exIdx));
      if (nextOrder.length === 0) {
        setFinished(true);
        return;
      }
      setExComplete({
        name: completedName,
        nextName: resolve(EXERCISES[nextOrder[0]]).name,
      });
      setTimeout(() => setExComplete(null), 2000);
    }
  };

  useEffect(() => {
    if (!resting) return;
    if (restLeft <= 0) {
      advanceAfterRest();
      return;
    }
    const t = setTimeout(() => setRestLeft((r) => r - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resting, restLeft]);

  const completeSet = () => {
    if (isLastOverall) {
      setProgress((p) => ({ ...p, [exIdx]: setIdx + 1 }));
      setFinished(true);
      return;
    }
    setPending({ exId: ex.id, setIdx });
    setRegWeight(lastWeight(ex, setIdx));
    setRestLeft(ex.rest);
    setResting(true);
  };

  const skipExercise = () => {
    if (order.length <= 1) return;
    if (!skipped.includes(exIdx)) setSkipped((s) => [...s, exIdx]);
    setOrder((o) => [...o.slice(1), o[0]]);
  };

  const jumpTo = (i: number) => {
    if (exDone(i)) return;
    setOrder((o) => [i, ...o.filter((x) => x !== i)]);
    setQueueOpen(false);
  };

  const applySub = async (option: SubOption, scope: 'once' | 'all') => {
    const baseId = EXERCISES[exIdx].id;
    if (scope === 'all') {
      const next = { ...permSubs, [baseId]: option };
      setPermSubs(next);
      try {
        await AsyncStorage.setItem(SUBS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      setSessionSubs((s) => {
        const c = { ...s };
        delete c[baseId];
        return c;
      });
    } else {
      setSessionSubs((s) => ({ ...s, [baseId]: option }));
    }
    setPendingSub(null);
    setSubSheet(false);
  };

  const subOptions: (SubOption & { _base?: boolean })[] = useMemo(
    () => [
      { name: baseEx.name, target: baseEx.target, db: baseEx.db, _base: true },
      ...baseEx.subs,
    ],
    [baseEx]
  );

  const curReps = ex.sets[setIdx].r;
  const curLast = lastWeight(ex, setIdx);

  if (finished) return <WorkoutDone elapsed={elapsed} onDone={onDone} />;

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        {/* header */}
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 10,
            paddingBottom: 10,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <Pressable onPress={onDone} style={hdrBtnStyle}>
            <Icon name="x" size={15} color="rgba(255,255,255,0.7)" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <SegBar value={pct} segs={totalSets} />
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                marginTop: 7,
              }}
            >
              <MonoLabel>PUSH · DIA 04</MonoLabel>
              <MonoLabel color={colors.accentHi}>{fmt(elapsed)}</MonoLabel>
              <MonoLabel>
                {doneSets}/{totalSets} SÉRIES
              </MonoLabel>
            </View>
          </View>
          <Pressable onPress={() => setQueueOpen(true)} style={hdrBtnStyle}>
            <Icon name="list" size={15} color="rgba(255,255,255,0.7)" />
          </Pressable>
        </View>

        {/* GIF banner */}
        <View style={{ paddingHorizontal: 20, paddingTop: 6 }}>
          <View style={{ position: 'relative', borderRadius: 20, overflow: 'hidden' }}>
            <ExerciseGif id={ex.db} name={ex.name} height={224} radius={20} />
            {/* gradient overlay for legibility */}
            <LinearGradient
              colors={[
                'rgba(2,0,16,0.45)',
                'transparent',
                'transparent',
                'rgba(2,0,16,0.55)',
              ]}
              locations={[0, 0.28, 0.6, 1]}
              pointerEvents="none"
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            />
            <View
              style={{
                position: 'absolute',
                top: 14,
                left: 16,
                backgroundColor: 'rgba(2,0,16,0.7)',
                paddingHorizontal: 8,
                paddingVertical: 4,
                borderRadius: 6,
              }}
            >
              <MonoLabel color="#fff">
                EX {String(exIdx + 1).padStart(2, '0')}
                <Text style={{ opacity: 0.5 }}>
                  {' '}
                  / {String(EXERCISES.length).padStart(2, '0')}
                </Text>
              </MonoLabel>
            </View>
            <Pressable
              onPress={() => setVideoOpen(true)}
              style={{
                position: 'absolute',
                bottom: 12,
                right: 12,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 7,
                paddingVertical: 9,
                paddingHorizontal: 14,
                backgroundColor: 'rgba(11,112,249,0.92)',
                borderRadius: 11,
                shadowColor: colors.accent,
                shadowOpacity: 0.5,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 6 },
                elevation: 6,
              }}
            >
              <Icon name="play" size={11} color="#fff" />
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: '#fff' }}>
                Ver execução
              </Text>
            </Pressable>
          </View>
        </View>

        {/* name + badges + swap */}
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 16,
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
          <View style={{ flex: 1 }}>
            <View
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
            >
              <Slash>{ex.target.toUpperCase()}</Slash>
              {wasSkipped && (
                <Badge bg="rgba(11,112,249,0.18)" border="rgba(11,112,249,0.45)" color={colors.accentHi}>
                  RETOMADO
                </Badge>
              )}
              {isSubbed && (
                <Badge
                  bg="rgba(255,255,255,0.06)"
                  border="rgba(255,255,255,0.18)"
                  color="rgba(255,255,255,0.85)"
                >
                  {sessionSubs[baseEx.id] ? 'TROCADO HOJE' : 'TROCADO FIXO'}
                </Badge>
              )}
            </View>
            <Display size={26} style={{ marginTop: 8 }}>
              {ex.name}
            </Display>
          </View>
          <Pressable
            onPress={() => setSubSheet(true)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 7,
              height: 38,
              paddingHorizontal: 12,
              borderRadius: 10,
              backgroundColor: 'rgba(255,255,255,0.05)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.09)',
              marginTop: 2,
            }}
          >
            <Icon name="swap" size={15} color={colors.accentHi} />
            <Text style={{ fontSize: 12, fontFamily: fonts.uiSemi, color: 'rgba(255,255,255,0.85)' }}>
              Trocar
            </Text>
          </Pressable>
        </View>

        {/* PRÓXIMA SÉRIE card */}
        <View style={{ paddingHorizontal: 20, paddingTop: 14 }}>
          <View
            style={{
              borderRadius: 18,
              padding: 18,
              backgroundColor: 'rgba(11,112,249,0.10)',
              borderWidth: 1,
              borderColor: 'rgba(11,112,249,0.4)',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 18,
            }}
          >
            <View style={{ flex: 1 }}>
              <MonoLabel color={colors.accentHi}>PRÓXIMA SÉRIE</MonoLabel>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 6 }}>
                <Display size={28}>SÉRIE {setIdx + 1}</Display>
                <Text
                  style={{
                    fontFamily: fonts.display,
                    fontSize: 18,
                    color: colors.faint,
                    marginLeft: 6,
                    transform: [{ skewX: '-8deg' }],
                  }}
                >
                  /{ex.sets.length}
                </Text>
              </View>
            </View>
            <View style={{ alignItems: 'center', minWidth: 60 }}>
              <Text
                style={{
                  fontFamily: fonts.display,
                  fontSize: 40,
                  color: '#fff',
                  lineHeight: displayLineHeight(40),
                  transform: [{ skewX: '-8deg' }],
                }}
              >
                {curReps}
              </Text>
              <MonoLabel style={{ marginTop: 4 }}>REPS</MonoLabel>
            </View>
            <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.1)' }} />
            <View style={{ alignItems: 'center', minWidth: 66 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                <Text
                  style={{
                    fontFamily: fonts.display,
                    fontSize: 28,
                    color: '#fff',
                    lineHeight: displayLineHeight(28),
                    transform: [{ skewX: '-8deg' }],
                  }}
                >
                  {curLast > 0 ? curLast : '—'}
                </Text>
                {curLast > 0 && (
                  <Text style={{ fontFamily: fonts.mono, fontSize: 12, color: colors.faint, marginLeft: 2 }}>
                    kg
                  </Text>
                )}
              </View>
              <MonoLabel size={8.5} style={{ marginTop: 6 }}>
                ÚLTIMA VEZ
              </MonoLabel>
            </View>
          </View>
        </View>

        {/* set list */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 10 }}
          showsVerticalScrollIndicator={false}
        >
          {ex.sets.map((s0, i) => {
            const done = i < setIdx;
            const now = i === setIdx;
            const w = lastWeight(ex, i);
            const justLogged = logged[`${ex.id}-${i}`] != null && done;
            return (
              <View
                key={i}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingVertical: 11,
                  paddingHorizontal: 14,
                  borderRadius: 12,
                  marginBottom: 6,
                  backgroundColor: now ? 'rgba(11,112,249,0.1)' : 'rgba(255,255,255,0.025)',
                  borderWidth: 1,
                  borderColor: now ? 'rgba(11,112,249,0.4)' : 'rgba(255,255,255,0.05)',
                  opacity: done ? 0.5 : 1,
                }}
              >
                <Text
                  style={{
                    fontFamily: fonts.display,
                    fontSize: 14,
                    width: 20,
                    color: done ? colors.accentHi : now ? '#fff' : colors.faint,
                    textTransform: 'uppercase',
                  }}
                >
                  {done ? '✓' : String(i + 1).padStart(2, '0')}
                </Text>
                <Text style={{ fontFamily: fonts.mono, fontSize: 12, flex: 1, color: '#fff' }}>
                  {s0.r} reps {w > 0 ? `× ${w}kg` : '× peso corporal'}
                </Text>
                {justLogged && <MonoLabel color={colors.accentHi}>REGISTRADO</MonoLabel>}
                {now && <MonoLabel color={colors.accentHi}>AGORA</MonoLabel>}
              </View>
            );
          })}
        </ScrollView>

        {/* CTAs */}
        <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 }}>
          <CtaButton onPress={completeSet}>
            <Icon name="check" size={18} color="#fff" />
            <Text
              style={{
                color: '#fff',
                fontFamily: fonts.display,
                fontSize: 17,
                letterSpacing: 1.5,
                textTransform: 'uppercase',
              }}
            >
              {isLastOverall ? 'Finalizar treino' : `Concluir série ${setIdx + 1}`}
            </Text>
          </CtaButton>
          {order.length > 1 && (
            <Pressable
              onPress={skipExercise}
              style={{
                width: '100%',
                marginTop: 10,
                paddingVertical: 13,
                borderRadius: 14,
                backgroundColor: 'rgba(255,255,255,0.04)',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.1)',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 9,
              }}
            >
              <Icon name="swap" size={15} color={colors.accentHi} />
              <Text style={{ fontSize: 13.5, fontFamily: fonts.uiSemi, color: 'rgba(255,255,255,0.82)' }}>
                Pular · aparelho ocupado
              </Text>
            </Pressable>
          )}
        </View>

        {/* REST OVERLAY */}
        {resting && (
          <RestOverlay
            restLeft={restLeft}
            restTotal={ex.rest}
            fmt={fmt}
            regWeight={regWeight}
            setRegWeight={setRegWeight}
            setNumber={(pending ? pending.setIdx : setIdx) + 1}
            onAdd15={() => setRestLeft((r) => r + 15)}
            onSkip={advanceAfterRest}
            onMinimize={onMinimize}
          />
        )}

        {/* PR celebration */}
        {pr && <PROverlay weight={pr.weight} exName={pr.exName} prev={pr.prev} />}

        {/* exercise complete transition */}
        {exComplete && <ExerciseDoneOverlay name={exComplete.name} nextName={exComplete.nextName} />}

        {/* VIDEO modal (fullscreen 9:16) */}
        <Modal
          visible={videoOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setVideoOpen(false)}
        >
          <View style={{ flex: 1, backgroundColor: colors.bg }}>
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ width: '92%', maxWidth: 380 }}>
                <ExerciseGif id={ex.db} name={ex.name} aspectRatio={9 / 16} radius={20} />
              </View>
            </View>
            <SafeAreaView
              edges={['top']}
              style={{ position: 'absolute', top: 0, left: 0, right: 0 }}
            >
              <View
                style={{
                  padding: 20,
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                }}
              >
                <View style={{ flex: 1 }}>
                  <MonoLabel color={colors.accentHi}>EXECUÇÃO</MonoLabel>
                  <Text
                    style={{
                      fontSize: 17,
                      fontFamily: fonts.uiBold,
                      color: '#fff',
                      marginTop: 3,
                    }}
                  >
                    {ex.name}
                  </Text>
                </View>
                <Pressable
                  onPress={() => setVideoOpen(false)}
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 21,
                    backgroundColor: 'rgba(2,0,16,0.55)',
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.18)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name="x" size={20} color="#fff" />
                </Pressable>
              </View>
            </SafeAreaView>
            <LinearGradient
              colors={['transparent', 'rgba(2,0,16,0.5)', 'rgba(2,0,16,0.9)']}
              locations={[0, 0.45, 1]}
              pointerEvents="none"
              style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 260 }}
            />
            <SafeAreaView
              edges={['bottom']}
              style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}
            >
              <View style={{ padding: 22 }}>
                <MonoLabel color={colors.accentHi} style={{ marginBottom: 10 }}>
                  PONTOS-CHAVE
                </MonoLabel>
                {[
                  'Mantenha a escápula retraída',
                  'Desça controlando a fase excêntrica',
                  'Não trave os cotovelos no topo',
                ].map((c, i) => (
                  <View
                    key={i}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                      paddingVertical: 6,
                    }}
                  >
                    <View
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 3,
                        backgroundColor: colors.accentHi,
                      }}
                    />
                    <Text style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.88)' }}>{c}</Text>
                  </View>
                ))}
              </View>
            </SafeAreaView>
          </View>
        </Modal>

        {/* SUB SHEET */}
        <Modal
          visible={subSheet}
          transparent
          animationType="slide"
          onRequestClose={() => setSubSheet(false)}
        >
          <Pressable
            onPress={() => setSubSheet(false)}
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}
          >
            <Pressable
              onPress={(e) => e.stopPropagation()}
              style={{
                maxHeight: '78%',
                backgroundColor: '#05031e',
                borderTopWidth: 1,
                borderTopColor: 'rgba(11,112,249,0.4)',
                borderTopLeftRadius: 20,
                borderTopRightRadius: 20,
                padding: 18,
                paddingBottom: 30,
              }}
            >
              <View
                style={{
                  width: 36,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: 'rgba(255,255,255,0.2)',
                  alignSelf: 'center',
                  marginBottom: 16,
                }}
              />
              <Slash style={{ marginBottom: 6 }}>TROCAR EXERCÍCIO</Slash>
              <Text style={{ fontSize: 12.5, color: colors.mute, marginBottom: 16 }}>
                Mesmo grupo muscular · escolha uma variação
              </Text>
              <ScrollView showsVerticalScrollIndicator={false}>
                {subOptions.map((o) => {
                  const active = o.db === ex.db;
                  return (
                    <Pressable
                      key={o.db}
                      onPress={() =>
                        active ? setSubSheet(false) : setPendingSub(o)
                      }
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 14,
                        padding: 10,
                        borderRadius: 14,
                        marginBottom: 8,
                        backgroundColor: active
                          ? 'rgba(11,112,249,0.14)'
                          : 'rgba(255,255,255,0.03)',
                        borderWidth: 1,
                        borderColor: active
                          ? 'rgba(11,112,249,0.5)'
                          : 'rgba(255,255,255,0.06)',
                      }}
                    >
                      <View style={{ width: 76 }}>
                        <ExerciseGif id={o.db} name={o.name} height={58} radius={10} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14.5, fontFamily: fonts.uiBold, color: '#fff' }}>
                          {o.name}
                        </Text>
                        <Text
                          style={{
                            fontFamily: fonts.mono,
                            fontSize: 9.5,
                            color: colors.faint,
                            letterSpacing: 1,
                            marginTop: 3,
                          }}
                        >
                          {o._base ? 'ORIGINAL' : 'SUBSTITUIÇÃO'} · {o.target.toUpperCase()}
                        </Text>
                      </View>
                      {active ? (
                        <MonoLabel color={colors.accentHi}>ATUAL</MonoLabel>
                      ) : (
                        <Icon name="chevron-right" size={16} color="rgba(255,255,255,0.4)" />
                      )}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>

        {/* PENDING SUB CONFIRM */}
        <Modal
          visible={!!pendingSub}
          transparent
          animationType="fade"
          onRequestClose={() => setPendingSub(null)}
        >
          <Pressable
            onPress={() => setPendingSub(null)}
            style={{
              flex: 1,
              backgroundColor: 'rgba(2,0,16,0.9)',
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 28,
            }}
          >
            <Pressable
              onPress={(e) => e.stopPropagation()}
              style={{
                width: '100%',
                borderRadius: 20,
                padding: 24,
                backgroundColor: '#080522',
                borderWidth: 1,
                borderColor: 'rgba(11,112,249,0.4)',
                shadowColor: colors.accent,
                shadowOpacity: 0.25,
                shadowRadius: 40,
                shadowOffset: { width: 0, height: 0 },
                elevation: 12,
              }}
            >
              <Slash style={{ marginBottom: 12 }}>APLICAR TROCA</Slash>
              <Text style={{ fontSize: 15, lineHeight: 22, color: 'rgba(255,255,255,0.9)' }}>
                <Text style={{ color: colors.accentHi, fontFamily: fonts.uiBold }}>
                  {pendingSub?.name}
                </Text>{' '}
                no lugar de{' '}
                <Text style={{ fontFamily: fonts.uiBold }}>{baseEx.name}</Text>.
              </Text>
              <View style={{ marginTop: 22, gap: 10 }}>
                <Pressable
                  onPress={() => pendingSub && applySub(pendingSub, 'once')}
                  style={{
                    paddingVertical: 15,
                    borderRadius: 14,
                    backgroundColor: 'rgba(255,255,255,0.05)',
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.12)',
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ fontSize: 14.5, fontFamily: fonts.uiSemi, color: '#fff' }}>
                    Trocar só dessa vez
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => pendingSub && applySub(pendingSub, 'all')}
                  style={{
                    paddingVertical: 15,
                    borderRadius: 14,
                    backgroundColor: colors.accent,
                    alignItems: 'center',
                    shadowColor: colors.accent,
                    shadowOpacity: 0.45,
                    shadowRadius: 24,
                    shadowOffset: { width: 0, height: 8 },
                    elevation: 8,
                  }}
                >
                  <Text style={{ fontSize: 14.5, fontFamily: fonts.uiBold, color: '#fff' }}>
                    Trocar em todo o treino
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setPendingSub(null)}
                  style={{ paddingVertical: 11, alignItems: 'center' }}
                >
                  <Text style={{ fontSize: 13, color: colors.mute, fontFamily: fonts.uiMed }}>
                    Cancelar
                  </Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>

        {/* QUEUE SHEET */}
        <Modal
          visible={queueOpen}
          transparent
          animationType="slide"
          onRequestClose={() => setQueueOpen(false)}
        >
          <Pressable
            onPress={() => setQueueOpen(false)}
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}
          >
            <Pressable
              onPress={(e) => e.stopPropagation()}
              style={{
                maxHeight: '75%',
                backgroundColor: '#05031e',
                borderTopWidth: 1,
                borderTopColor: 'rgba(11,112,249,0.4)',
                borderTopLeftRadius: 20,
                borderTopRightRadius: 20,
                padding: 18,
                paddingBottom: 30,
              }}
            >
              <View
                style={{
                  width: 36,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: 'rgba(255,255,255,0.2)',
                  alignSelf: 'center',
                  marginBottom: 16,
                }}
              />
              <Slash style={{ marginBottom: 14 }}>
                FILA DO TREINO · {EXERCISES.length} EXERCÍCIOS
              </Slash>
              <ScrollView showsVerticalScrollIndicator={false}>
                {order.map((i, pos) => {
                  const e = EXERCISES[i];
                  const now = pos === 0;
                  const wasSkip = skipped.includes(i);
                  return (
                    <Pressable
                      key={e.id}
                      onPress={() => jumpTo(i)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 12,
                        paddingVertical: 12,
                        paddingHorizontal: 14,
                        borderRadius: 10,
                        marginBottom: 6,
                        backgroundColor: now ? 'rgba(11,112,249,0.14)' : 'rgba(255,255,255,0.03)',
                        borderWidth: 1,
                        borderColor: now ? 'rgba(11,112,249,0.5)' : 'rgba(255,255,255,0.05)',
                      }}
                    >
                      <Text
                        style={{
                          fontFamily: fonts.display,
                          fontSize: 14,
                          width: 26,
                          color: colors.faint,
                          textTransform: 'uppercase',
                        }}
                      >
                        {String(pos + 1).padStart(2, '0')}
                      </Text>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: '#fff' }}>
                          {resolve(e).name}
                        </Text>
                        <Text
                          style={{
                            fontFamily: fonts.mono,
                            fontSize: 9.5,
                            color: colors.faint,
                            letterSpacing: 1,
                            marginTop: 2,
                          }}
                        >
                          {resolve(e).target.toUpperCase()} ·{' '}
                          {Math.min(progress[i] || 0, e.sets.length)}/{e.sets.length} SÉRIES
                        </Text>
                      </View>
                      {wasSkip && !now && <MonoLabel color={colors.accentHi}>PULADO</MonoLabel>}
                      {now && <MonoLabel color={colors.accentHi}>AGORA</MonoLabel>}
                    </Pressable>
                  );
                })}
                {EXERCISES.map((e, i) =>
                  exDone(i) ? (
                    <View
                      key={'done-' + e.id}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 12,
                        paddingVertical: 12,
                        paddingHorizontal: 14,
                        borderRadius: 10,
                        marginBottom: 6,
                        opacity: 0.4,
                        backgroundColor: 'rgba(255,255,255,0.02)',
                        borderWidth: 1,
                        borderColor: 'rgba(255,255,255,0.05)',
                      }}
                    >
                      <Text
                        style={{
                          fontFamily: fonts.display,
                          fontSize: 14,
                          width: 26,
                          color: colors.accentHi,
                          textTransform: 'uppercase',
                        }}
                      >
                        ✓
                      </Text>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: '#fff' }}>
                          {resolve(e).name}
                        </Text>
                        <Text
                          style={{
                            fontFamily: fonts.mono,
                            fontSize: 9.5,
                            color: colors.faint,
                            letterSpacing: 1,
                            marginTop: 2,
                          }}
                        >
                          CONCLUÍDO · {e.sets.length}/{e.sets.length} SÉRIES
                        </Text>
                      </View>
                    </View>
                  ) : null
                )}
              </ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
      </SafeAreaView>
    </ScreenBg>
  );
}

const hdrBtnStyle = {
  width: 38,
  height: 38,
  borderRadius: 10,
  backgroundColor: 'rgba(255,255,255,0.05)',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.09)',
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};

function Badge({
  children,
  bg,
  border,
  color,
}: {
  children: React.ReactNode;
  bg: string;
  border: string;
  color: string;
}) {
  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 6,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: border,
      }}
    >
      <Text
        style={{
          fontFamily: fonts.monoBold,
          fontSize: 9,
          letterSpacing: 1,
          color,
        }}
      >
        {children}
      </Text>
    </View>
  );
}

/* ────────────────────────────── REST OVERLAY ────────────────────────────── */

function RestOverlay({
  restLeft,
  restTotal,
  fmt,
  regWeight,
  setRegWeight,
  setNumber,
  onAdd15,
  onSkip,
  onMinimize,
}: {
  restLeft: number;
  restTotal: number;
  fmt: (s: number) => string;
  regWeight: number;
  setRegWeight: (fn: number | ((prev: number) => number)) => void;
  setNumber: number;
  onAdd15: () => void;
  onSkip: () => void;
  onMinimize?: () => void;
}) {
  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(2,0,16,0.96)',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 28,
        zIndex: 20,
      }}
    >
      {onMinimize && (
        <Pressable
          onPress={onMinimize}
          style={{
            position: 'absolute',
            top: 54,
            right: 20,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 7,
            paddingVertical: 9,
            paddingHorizontal: 14,
            borderRadius: 999,
            backgroundColor: 'rgba(255,255,255,0.06)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.12)',
          }}
        >
          <Icon name="minus" size={13} color={colors.accentHi} />
          <Text style={{ fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1, color: '#fff' }}>
            MINIMIZAR
          </Text>
        </Pressable>
      )}
      <Slash style={{ marginBottom: 14 }}>DESCANSO</Slash>
      <Text
        style={{
          fontFamily: fonts.display,
          fontSize: 104,
          color: '#fff',
          lineHeight: displayLineHeight(104),
          transform: [{ skewX: '-8deg' }],
          textShadowColor: 'rgba(11,112,249,0.7)',
          textShadowRadius: 40,
          textShadowOffset: { width: 0, height: 0 },
        }}
      >
        {fmt(restLeft)}
      </Text>
      <View style={{ width: 220, marginTop: 22 }}>
        <SegBar value={restLeft / (restTotal + 0.001)} segs={14} />
      </View>

      {/* weight logging card */}
      <View
        style={{
          width: '100%',
          maxWidth: 320,
          marginTop: 36,
          borderRadius: 18,
          padding: 18,
          backgroundColor: 'rgba(255,255,255,0.04)',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.1)',
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 14,
          }}
        >
          <MonoLabel>REGISTRAR CARGA · SÉRIE {setNumber}</MonoLabel>
          <Text style={{ fontSize: 10.5, color: colors.faint, fontStyle: 'italic' }}>opcional</Text>
        </View>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
          }}
        >
          <Pressable
            onPress={() =>
              setRegWeight((w: number) => Math.max(0, Math.round((w - 2.5) * 10) / 10))
            }
            style={regBtnStyle}
          >
            <Icon name="minus" size={16} color={colors.accentHi} />
          </Pressable>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'baseline',
              justifyContent: 'center',
              minWidth: 96,
            }}
          >
            <TextInput
              value={regWeight > 0 ? String(regWeight) : ''}
              placeholder="—"
              placeholderTextColor={colors.faint}
              keyboardType="decimal-pad"
              onChangeText={(t) => {
                const v = t.replace(',', '.').replace(/[^0-9.]/g, '');
                setRegWeight(v === '' ? 0 : parseFloat(v) || 0);
              }}
              style={{
                width: 96,
                textAlign: 'center',
                fontFamily: fonts.display,
                transform: [{ skewX: '-8deg' }],
                fontSize: 46,
                lineHeight: displayLineHeight(46),
                color: '#fff',
                padding: 0,
              }}
            />
            <Text style={{ fontSize: 14, color: colors.faint, marginLeft: 2 }}>kg</Text>
          </View>
          <Pressable
            onPress={() => setRegWeight((w: number) => Math.round((w + 2.5) * 10) / 10)}
            style={regBtnStyle}
          >
            <Icon name="plus" size={16} color={colors.accentHi} />
          </Pressable>
        </View>
        <Text
          style={{
            textAlign: 'center',
            marginTop: 10,
            fontSize: 10.5,
            color: colors.faint,
            fontFamily: fonts.mono,
          }}
        >
          Toque no número para digitar
        </Text>
      </View>

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 28 }}>
        <Pressable
          onPress={onAdd15}
          style={{
            paddingVertical: 14,
            paddingHorizontal: 22,
            borderRadius: 12,
            backgroundColor: 'rgba(255,255,255,0.06)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.12)',
          }}
        >
          <Text style={{ fontFamily: fonts.mono, fontSize: 12, letterSpacing: 1, color: '#fff' }}>
            +15s
          </Text>
        </Pressable>
        <Pressable
          onPress={onSkip}
          style={{
            paddingVertical: 14,
            paddingHorizontal: 28,
            borderRadius: 12,
            backgroundColor: colors.accent,
            shadowColor: colors.accent,
            shadowOpacity: 0.5,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 8 },
            elevation: 8,
          }}
        >
          <Text
            style={{
              fontFamily: fonts.display,
              fontSize: 14,
              letterSpacing: 1.5,
              color: '#fff',
              textTransform: 'uppercase',
            }}
          >
            Próxima série
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const regBtnStyle = {
  width: 44,
  height: 44,
  borderRadius: 12,
  backgroundColor: 'rgba(11,112,249,0.18)',
  borderWidth: 1,
  borderColor: 'rgba(11,112,249,0.45)',
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};

/* ─────────────────────────── PR CELEBRATION ─────────────────────────── */

function PROverlay({
  weight,
  exName,
  prev,
}: {
  weight: number;
  exName: string;
  prev: number;
}) {
  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(2,0,16,0.95)',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 28,
        overflow: 'hidden',
        zIndex: 28,
      }}
    >
      <Confetti />
      <View
        style={{
          width: 120,
          height: 120,
          marginBottom: 30,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <PulseRings />
        <PopBadge>
          <Icon name="trophy" size={46} color="#fff" stroke={2.2} />
        </PopBadge>
      </View>
      <Slash style={{ marginBottom: 12 }}>NOVO RECORDE</Slash>
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Display size={46}>{String(weight)}</Display>
        <Text
          style={{
            fontFamily: fonts.display,
            fontSize: 22,
            color: colors.accentHi,
            marginLeft: 6,
            transform: [{ skewX: '-8deg' }],
          }}
        >
          KG
        </Text>
      </View>
      <Text
        style={{
          marginTop: 14,
          fontSize: 14,
          color: colors.mute,
          textAlign: 'center',
          fontFamily: fonts.ui,
        }}
      >
        {exName} · anterior {prev}kg{' '}
        <Text style={{ color: colors.accentHi, fontFamily: fonts.uiBold }}>
          +{Math.round((weight - prev) * 10) / 10}kg
        </Text>
      </Text>
    </View>
  );
}

const CONFETTI_COLORS = [colors.accent, colors.accentHi, '#ffffff', '#1f82ff'];

function Confetti() {
  const anims = useRef(
    Array.from({ length: 20 }, () => new Animated.Value(0))
  ).current;

  useEffect(() => {
    const animations = anims.map((a, i) =>
      Animated.timing(a, {
        toValue: 1,
        duration: 1500,
        delay: (i % 5) * 40,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      })
    );
    Animated.parallel(animations).start();
  }, [anims]);

  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: '42%', left: '50%', width: 0, height: 0 }}
    >
      {anims.map((a, i) => {
        const ang = (i / 20) * Math.PI * 2;
        const dist = 130 + (i % 4) * 38;
        const tx = Math.cos(ang) * dist;
        const ty = Math.sin(ang) * dist;
        const rot = (i * 57) % 360;
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              width: i % 2 ? 7 : 9,
              height: i % 2 ? 7 : 9,
              borderRadius: i % 3 ? 1 : 5,
              backgroundColor: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
              opacity: a.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
              transform: [
                { translateX: a.interpolate({ inputRange: [0, 1], outputRange: [0, tx] }) },
                { translateY: a.interpolate({ inputRange: [0, 1], outputRange: [0, ty] }) },
                {
                  rotate: a.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0deg', `${rot}deg`],
                  }),
                },
              ],
            }}
          />
        );
      })}
    </View>
  );
}

function PulseRings() {
  const rings = useRef([new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)]).current;
  useEffect(() => {
    const loops = rings.map((r, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 400),
          Animated.timing(r, {
            toValue: 1,
            duration: 1800,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(r, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ])
      )
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [rings]);

  return (
    <>
      {rings.map((r, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            width: 96,
            height: 96,
            borderRadius: 48,
            borderWidth: 2,
            borderColor: 'rgba(11,112,249,0.55)',
            opacity: r.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] }),
            transform: [
              {
                scale: r.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.5] }),
              },
            ],
          }}
        />
      ))}
    </>
  );
}

function PopBadge({ children }: { children: React.ReactNode }) {
  const s = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.timing(s, {
        toValue: 1.12,
        duration: 330,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(s, {
        toValue: 1,
        duration: 220,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();
  }, [s]);
  return (
    <Animated.View style={{ transform: [{ scale: s }] }}>
      <LinearGradient
        colors={['#1f82ff', colors.accent]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{
          width: 96,
          height: 96,
          borderRadius: 48,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: colors.accent,
          shadowOpacity: 0.7,
          shadowRadius: 30,
          shadowOffset: { width: 0, height: 0 },
          elevation: 10,
        }}
      >
        {children}
      </LinearGradient>
    </Animated.View>
  );
}

/* ─────────────────────── EXERCISE DONE TRANSITION ─────────────────────── */

function ExerciseDoneOverlay({ name, nextName }: { name: string; nextName: string }) {
  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(2,0,16,0.96)',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 28,
        zIndex: 26,
      }}
    >
      <View
        style={{
          width: 120,
          height: 120,
          marginBottom: 32,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <PulseRings />
        <PopBadge>
          <Icon name="check" size={48} color="#fff" stroke={3} />
        </PopBadge>
      </View>
      <Slash style={{ marginBottom: 12 }}>EXERCÍCIO CONCLUÍDO</Slash>
      <Display size={30} style={{ textAlign: 'center' }}>
        {name}
      </Display>
      <View
        style={{
          marginTop: 26,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingVertical: 12,
          paddingHorizontal: 18,
          borderRadius: 14,
          backgroundColor: 'rgba(255,255,255,0.05)',
          borderWidth: 1,
          borderColor: 'rgba(11,112,249,0.35)',
        }}
      >
        <MonoLabel color={colors.accentHi}>PRÓXIMO</MonoLabel>
        <Icon name="arrow-right" size={15} color={colors.accentHi} />
        <Text style={{ fontSize: 15, fontFamily: fonts.uiBold, color: '#fff' }}>{nextName}</Text>
      </View>
    </View>
  );
}

/* ─────────────────────────── WORKOUT DONE ─────────────────────────── */

function WorkoutDone({ elapsed, onDone }: { elapsed: number; onDone: () => void }) {
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={{ flex: 1, paddingHorizontal: 26, paddingTop: 20, paddingBottom: 36 }}>
          <OutlineNumber
            size={300}
            style={{ position: 'absolute', top: -50, right: -60, opacity: 0.4 }}
          >
            ✓
          </OutlineNumber>

          <Slash style={{ marginBottom: 14 }}>TREINO CONCLUÍDO</Slash>
          <Display size={46}>FEITO.</Display>
          <Display size={46} color={colors.accentHi}>
            MAIS FORTE.
          </Display>

          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: 12,
              marginTop: 30,
            }}
          >
            {[
              { l: 'TEMPO', v: fmt(elapsed || 3480) },
              { l: 'VOLUME', v: '8.2t' },
              { l: 'SÉRIES', v: '25' },
              { l: 'NOVO PR', v: '+1' },
            ].map((s) => (
              <Card key={s.l} style={{ width: '47%', padding: 16 }}>
                <MonoLabel>{s.l}</MonoLabel>
                <Text
                  style={{
                    fontFamily: fonts.display,
                    fontSize: 30,
                    color: '#fff',
                    marginTop: 8,
                    transform: [{ skewX: '-8deg' }],
                    textTransform: 'uppercase',
                  }}
                >
                  {s.v}
                </Text>
              </Card>
            ))}
          </View>

          <Card style={{ padding: 16, marginTop: 12 }}>
            <MonoLabel style={{ marginBottom: 10 }}>SEQUÊNCIA ATUALIZADA</MonoLabel>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Icon name="flame" size={26} color={colors.accentHi} />
              <Text
                style={{
                  fontFamily: fonts.display,
                  fontSize: 34,
                  color: '#fff',
                  transform: [{ skewX: '-8deg' }],
                  textTransform: 'uppercase',
                }}
              >
                15 DIAS
              </Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.mute }}>
                · faltam 6 p/ seu recorde
              </Text>
            </View>
          </Card>

          <View style={{ flex: 1 }} />
          <CtaButton onPress={onDone}>
            <Text
              style={{
                color: '#fff',
                fontFamily: fonts.display,
                fontSize: 17,
                letterSpacing: 1.5,
                textTransform: 'uppercase',
              }}
            >
              Voltar para home
            </Text>
            <Icon name="arrow-right" size={18} color="#fff" />
          </CtaButton>
        </View>
      </SafeAreaView>
    </ScreenBg>
  );
}
