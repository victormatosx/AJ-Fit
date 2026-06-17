import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenBg } from '../components/ui/ScreenBg';
import { Display, Slash, MonoLabel } from '../components/ui/Display';
import { Card, HudCorners } from '../components/ui/Card';
import { CtaButton } from '../components/ui/CtaButton';
import { SegBar } from '../components/ui/SegBar';
import { Icon } from '../components/ui/Icon';
import { OutlineNumber } from '../components/ui/OutlineNumber';
import { colors, fonts } from '../theme/tokens';

type SetData = { r: number; w: number };
type Exercise = { id: string; name: string; target: string; sets: SetData[]; rest: number };

const EXERCISES: Exercise[] = [
  { id: 'supino-reto', name: 'Supino Reto', target: 'Peitoral', sets: [{ r: 10, w: 60 }, { r: 8, w: 70 }, { r: 8, w: 75 }, { r: 6, w: 80 }], rest: 90 },
  { id: 'supino-incl', name: 'Supino Inclinado Halter', target: 'Peitoral Superior', sets: [{ r: 10, w: 24 }, { r: 10, w: 26 }, { r: 8, w: 28 }], rest: 75 },
  { id: 'crucifixo', name: 'Crucifixo Polia', target: 'Peitoral', sets: [{ r: 12, w: 14 }, { r: 12, w: 16 }, { r: 10, w: 18 }], rest: 60 },
  { id: 'militar', name: 'Desenvolvimento Militar', target: 'Ombro', sets: [{ r: 10, w: 30 }, { r: 8, w: 35 }, { r: 8, w: 40 }], rest: 90 },
  { id: 'lateral', name: 'Elevação Lateral', target: 'Ombro Lateral', sets: [{ r: 12, w: 8 }, { r: 12, w: 10 }, { r: 10, w: 12 }], rest: 60 },
  { id: 'pulley', name: 'Tríceps Pulley', target: 'Tríceps', sets: [{ r: 12, w: 20 }, { r: 10, w: 24 }, { r: 10, w: 26 }], rest: 60 },
  { id: 'frances', name: 'Tríceps Francês', target: 'Tríceps', sets: [{ r: 10, w: 14 }, { r: 10, w: 16 }, { r: 8, w: 18 }], rest: 60 },
  { id: 'paralelas', name: 'Mergulho Paralelas', target: 'Tríceps & Peito', sets: [{ r: 10, w: 0 }, { r: 8, w: 0 }, { r: 8, w: 0 }], rest: 60 },
];

export function WorkoutScreen({ onDone }: { onDone: () => void }) {
  const [exIdx, setExIdx] = useState(0);
  const [setIdx, setSetIdx] = useState(0);
  const [resting, setResting] = useState(false);
  const [restLeft, setRestLeft] = useState(0);
  const [queueOpen, setQueueOpen] = useState(false);
  const [finished, setFinished] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [overrides, setOverrides] = useState<Record<string, Partial<SetData>>>({});

  const ex = EXERCISES[exIdx];
  const totalSets = EXERCISES.reduce((a, e) => a + e.sets.length, 0);
  const doneSets = EXERCISES.slice(0, exIdx).reduce((a, e) => a + e.sets.length, 0) + setIdx;
  const pct = doneSets / totalSets;

  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!resting) return;
    if (restLeft <= 0) {
      setResting(false);
      return;
    }
    const t = setTimeout(() => setRestLeft((r) => r - 1), 1000);
    return () => clearTimeout(t);
  }, [resting, restLeft]);

  const getSet = (e: Exercise, i: number): SetData => {
    const o = overrides[`${e.id}-${i}`] || {};
    return { r: o.r ?? e.sets[i].r, w: o.w ?? e.sets[i].w };
  };

  const bump = (field: 'r' | 'w', delta: number) => {
    const key = `${ex.id}-${setIdx}`;
    const cur = getSet(ex, setIdx);
    const next = Math.max(0, (field === 'w' ? cur.w + delta : cur.r + delta));
    setOverrides({ ...overrides, [key]: { ...overrides[key], [field]: next } });
  };

  const completeSet = () => {
    if (setIdx + 1 < ex.sets.length) {
      setSetIdx(setIdx + 1);
      setRestLeft(ex.rest);
      setResting(true);
    } else if (exIdx + 1 < EXERCISES.length) {
      const newEx = EXERCISES[exIdx + 1];
      setExIdx(exIdx + 1);
      setSetIdx(0);
      setRestLeft(newEx.rest);
      setResting(true);
    } else {
      setFinished(true);
    }
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const cur = getSet(ex, setIdx);

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

        {/* GIF slot */}
        <View style={{ paddingHorizontal: 20, paddingTop: 6 }}>
          <View
            style={{
              position: 'relative',
              borderRadius: 16,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.1)',
              backgroundColor: 'rgba(255,255,255,0.03)',
              height: 210,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <HudCorners />
            <Icon name="play" size={40} color="rgba(255,255,255,0.25)" />
            <Text
              style={{
                fontFamily: fonts.mono,
                fontSize: 11,
                letterSpacing: 1.5,
                color: 'rgba(255,255,255,0.35)',
                marginTop: 8,
                textAlign: 'center',
                paddingHorizontal: 20,
              }}
            >
              ARRASTE O GIF DE{'\n'}
              {ex.name.toUpperCase()}
            </Text>

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
                EX {String(exIdx + 1).padStart(2, '0')}/{String(EXERCISES.length).padStart(2, '0')}
              </MonoLabel>
            </View>

            <View
              style={{
                position: 'absolute',
                bottom: 12,
                right: 12,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingVertical: 7,
                paddingHorizontal: 11,
                backgroundColor: 'rgba(2,0,16,0.7)',
                borderRadius: 9,
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.12)',
              }}
            >
              <Icon name="play" size={9} color="#fff" />
              <Text
                style={{
                  fontFamily: fonts.mono,
                  fontSize: 9.5,
                  letterSpacing: 1.5,
                  color: '#fff',
                }}
              >
                TÉCNICA
              </Text>
            </View>
          </View>
        </View>

        {/* exercise name + swap */}
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 14,
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
          <View style={{ flex: 1 }}>
            <Slash>{ex.target.toUpperCase()}</Slash>
            <Display size={26} style={{ marginTop: 8 }}>
              {ex.name}
            </Display>
          </View>
          <View style={hdrBtnStyle}>
            <Icon name="swap" size={15} color="rgba(255,255,255,0.6)" />
          </View>
        </View>

        {/* current set editable */}
        <View style={{ paddingHorizontal: 20, paddingTop: 12 }}>
          <Card
            style={{
              padding: 16,
              borderColor: 'rgba(11,112,249,0.4)',
              shadowColor: colors.accent,
              shadowOpacity: 0.18,
              shadowRadius: 16,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                marginBottom: 12,
              }}
            >
              <MonoLabel>
                SÉRIE ATUAL · {setIdx + 1} DE {ex.sets.length}
              </MonoLabel>
              <MonoLabel color={colors.accentHi}>DESCANSO {ex.rest}s</MonoLabel>
            </View>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 14,
              }}
            >
              <Stepper
                label="REPS"
                value={String(cur.r)}
                onDec={() => bump('r', -1)}
                onInc={() => bump('r', 1)}
              />
              <View style={{ width: 1, height: 56, backgroundColor: 'rgba(255,255,255,0.08)' }} />
              <Stepper
                label="CARGA"
                value={cur.w > 0 ? String(cur.w) : '—'}
                unit={cur.w > 0 ? 'kg' : ''}
                onDec={() => bump('w', -2.5)}
                onInc={() => bump('w', 2.5)}
              />
            </View>
          </Card>
        </View>

        {/* set list */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 10 }}
          showsVerticalScrollIndicator={false}
        >
          {ex.sets.map((_, i) => {
            const s = getSet(ex, i);
            const done = i < setIdx;
            const now = i === setIdx;
            return (
              <View
                key={i}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                  borderRadius: 10,
                  marginBottom: 6,
                  backgroundColor: now ? 'rgba(11,112,249,0.1)' : 'rgba(255,255,255,0.025)',
                  borderWidth: 1,
                  borderColor: now ? 'rgba(11,112,249,0.4)' : 'rgba(255,255,255,0.05)',
                  opacity: done ? 0.45 : 1,
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
                  {s.r} reps {s.w > 0 ? `× ${s.w}kg` : '× peso corporal'}
                </Text>
                {now && <MonoLabel color={colors.accentHi}>AGORA</MonoLabel>}
              </View>
            );
          })}
        </ScrollView>

        {/* CTA */}
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
              Concluir série {setIdx + 1}
            </Text>
          </CtaButton>
        </View>

        {/* REST OVERLAY */}
        {resting && (
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(2,0,16,0.94)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Slash style={{ marginBottom: 18 }}>DESCANSO</Slash>
            <Text
              style={{
                fontFamily: fonts.display,
                fontSize: 110,
                color: '#fff',
                transform: [{ skewX: '-8deg' }],
                textShadowColor: 'rgba(11,112,249,0.7)',
                textShadowRadius: 30,
                textShadowOffset: { width: 0, height: 0 },
              }}
            >
              {fmt(restLeft)}
            </Text>
            <View style={{ width: 220, marginTop: 24 }}>
              <SegBar value={restLeft / (ex.rest + 0.001)} segs={14} />
            </View>
            <MonoLabel style={{ marginTop: 22 }}>
              PRÓXIMA: SÉRIE {setIdx + 1} · {getSet(ex, setIdx).r} REPS
            </MonoLabel>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 30 }}>
              <Pressable
                onPress={() => setRestLeft((r) => r + 15)}
                style={{
                  paddingVertical: 13,
                  paddingHorizontal: 22,
                  borderRadius: 12,
                  backgroundColor: 'rgba(255,255,255,0.06)',
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.12)',
                }}
              >
                <Text
                  style={{
                    fontFamily: fonts.mono,
                    fontSize: 12,
                    letterSpacing: 1,
                    color: '#fff',
                  }}
                >
                  +15s
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setResting(false)}
                style={{
                  paddingVertical: 13,
                  paddingHorizontal: 26,
                  borderRadius: 12,
                  backgroundColor: colors.accent,
                }}
              >
                <Text
                  style={{
                    fontFamily: fonts.display,
                    fontSize: 13,
                    letterSpacing: 1.5,
                    color: '#fff',
                    textTransform: 'uppercase',
                  }}
                >
                  Pular descanso
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* QUEUE SHEET */}
        <Modal visible={queueOpen} transparent animationType="slide" onRequestClose={() => setQueueOpen(false)}>
          <Pressable
            onPress={() => setQueueOpen(false)}
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}
          >
            <Pressable
              onPress={(e) => e.stopPropagation()}
              style={{
                maxHeight: '70%',
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
                {EXERCISES.map((e, i) => {
                  const done = i < exIdx;
                  const now = i === exIdx;
                  return (
                    <Pressable
                      key={e.id}
                      onPress={() => {
                        setExIdx(i);
                        setSetIdx(0);
                        setQueueOpen(false);
                      }}
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
                        opacity: done ? 0.45 : 1,
                      }}
                    >
                      <Text
                        style={{
                          fontFamily: fonts.display,
                          fontSize: 14,
                          width: 26,
                          color: done ? colors.accentHi : colors.faint,
                          textTransform: 'uppercase',
                        }}
                      >
                        {done ? '✓' : String(i + 1).padStart(2, '0')}
                      </Text>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: '#fff' }}>
                          {e.name}
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
                          {e.target.toUpperCase()} · {e.sets.length} SÉRIES
                        </Text>
                      </View>
                      {now && <MonoLabel color={colors.accentHi}>AGORA</MonoLabel>}
                    </Pressable>
                  );
                })}
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

function Stepper({
  label,
  value,
  unit,
  onDec,
  onInc,
}: {
  label: string;
  value: string;
  unit?: string;
  onDec: () => void;
  onInc: () => void;
}) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <MonoLabel style={{ marginBottom: 6 }}>{label}</MonoLabel>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Pressable onPress={onDec} style={stepBtnStyle}>
          <Icon name="minus" size={14} color={colors.accentHi} />
        </Pressable>
        <Text
          style={{
            fontFamily: fonts.display,
            fontSize: 32,
            color: '#fff',
            minWidth: 58,
            textAlign: 'center',
            textTransform: 'uppercase',
          }}
        >
          {value}
          {unit && <Text style={{ fontSize: 13, color: colors.faint }}>{unit}</Text>}
        </Text>
        <Pressable onPress={onInc} style={stepBtnStyle}>
          <Icon name="plus" size={14} color={colors.accentHi} />
        </Pressable>
      </View>
    </View>
  );
}

const stepBtnStyle = {
  width: 32,
  height: 32,
  borderRadius: 9,
  backgroundColor: 'rgba(11,112,249,0.16)',
  borderWidth: 1,
  borderColor: 'rgba(11,112,249,0.4)',
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};

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
            <MonoLabel style={{ marginBottom: 10 }}>STREAK ATUALIZADO</MonoLabel>
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
