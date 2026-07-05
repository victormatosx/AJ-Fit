import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  Animated,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ScreenBg } from '../components/ui/ScreenBg';
import { Display, Slash, MonoLabel } from '../components/ui/Display';
import { Card } from '../components/ui/Card';
import { SegBar } from '../components/ui/SegBar';
import { Icon, IconName } from '../components/ui/Icon';
import { colors, fonts } from '../theme/tokens';

type SiteKey = 'chest' | 'axilla' | 'tricep' | 'subscap' | 'abdom' | 'supra' | 'thigh';
type Site = { k: SiteKey; l: string };
type Protocol = { id: string; label: string; sites: Site[] };

const SKINFOLD_PROTOCOLS: Protocol[] = [
  {
    id: 'jp7',
    label: 'Jackson & Pollock · 7 Dobras',
    sites: [
      { k: 'chest', l: 'Peitoral' },
      { k: 'axilla', l: 'Axilar Média' },
      { k: 'tricep', l: 'Tricipital' },
      { k: 'subscap', l: 'Subescapular' },
      { k: 'abdom', l: 'Abdominal' },
      { k: 'supra', l: 'Supra-ilíaca' },
      { k: 'thigh', l: 'Coxa' },
    ],
  },
  {
    id: 'jp3',
    label: 'Jackson & Pollock · 3 Dobras',
    sites: [
      { k: 'chest', l: 'Peitoral' },
      { k: 'abdom', l: 'Abdominal' },
      { k: 'thigh', l: 'Coxa' },
    ],
  },
  {
    id: 'guedes3',
    label: 'Guedes · 3 Dobras',
    sites: [
      { k: 'tricep', l: 'Tricipital' },
      { k: 'supra', l: 'Supra-ilíaca' },
      { k: 'abdom', l: 'Abdominal' },
    ],
  },
  {
    id: 'faulkner4',
    label: 'Faulkner · 4 Dobras',
    sites: [
      { k: 'tricep', l: 'Tricipital' },
      { k: 'subscap', l: 'Subescapular' },
      { k: 'supra', l: 'Supra-ilíaca' },
      { k: 'abdom', l: 'Abdominal' },
    ],
  },
];

const BMI_BANDS = [
  { max: 18.5, l: 'ABAIXO DO PESO', c: '#4da3ff' },
  { max: 25, l: 'PESO NORMAL', c: '#22c55e' },
  { max: 30, l: 'SOBREPESO', c: '#f5a623' },
  { max: Infinity, l: 'OBESIDADE', c: '#f0563f' },
];

type HistoryEntry = { date: string; weight: number; bmi: number; fat: number };
const HISTORY_SEED: HistoryEntry[] = [
  { date: '02 JUN 2026', weight: 79.4, bmi: 24.9, fat: 18.6 },
  { date: '05 MAI 2026', weight: 80.6, bmi: 25.3, fat: 19.8 },
  { date: '07 ABR 2026', weight: 82.1, bmi: 25.7, fat: 21.1 },
];

export function AssessmentScreen({ onBack }: { onBack: () => void }) {
  const [weight, setWeight] = useState('78');
  const [height, setHeight] = useState('178');
  const [protocol, setProtocol] = useState('jp7');
  const [protocolOpen, setProtocolOpen] = useState(false);
  const [folds, setFolds] = useState<Partial<Record<SiteKey, string>>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(HISTORY_SEED);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [shake, setShake] = useState(false);

  const proto = SKINFOLD_PROTOCOLS.find((p) => p.id === protocol) ?? SKINFOLD_PROTOCOLS[0];
  const w = parseFloat(weight);
  const h = parseFloat(height) / 100;
  const bmi = w > 0 && h > 0 ? w / (h * h) : null;
  const band =
    bmi != null ? BMI_BANDS.find((b) => bmi < b.max) ?? BMI_BANDS[BMI_BANDS.length - 1] : null;
  const bmiPct = bmi != null ? Math.max(3, Math.min(100, ((bmi - 14) / (38 - 14)) * 100)) : 0;

  const filledSites = proto.sites.filter(
    (s) => folds[s.k] && parseFloat(folds[s.k] || '0') > 0
  ).length;
  const canSave = w > 0 && h > 0;

  // shake animation
  const shakeX = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!shake) return;
    Animated.sequence([
      Animated.timing(shakeX, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: -6, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 6, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start(() => setShake(false));
  }, [shake, shakeX]);

  // toast animation
  const toastY = useRef(new Animated.Value(-40)).current;
  const toastOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!saved) return;
    Animated.parallel([
      Animated.timing(toastOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.timing(toastY, { toValue: 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
    const t = setTimeout(() => {
      Animated.parallel([
        Animated.timing(toastOpacity, { toValue: 0, duration: 250, useNativeDriver: true }),
        Animated.timing(toastY, { toValue: -40, duration: 250, useNativeDriver: true }),
      ]).start();
      setSaved(false);
    }, 2200);
    return () => clearTimeout(t);
  }, [saved, toastOpacity, toastY]);

  const setFold = (k: SiteKey, v: string) => setFolds((f) => ({ ...f, [k]: v }));

  // rough Jackson & Pollock 7-site body-fat estimate for men (fallback = 18.2 when missing)
  const bodyFat = useMemo(() => {
    if (protocol !== 'jp7' || filledSites < proto.sites.length) return 18.2;
    const sum = proto.sites.reduce((a, s) => a + parseFloat(folds[s.k] || '0'), 0);
    const age = 28;
    const density =
      1.112 - 0.00043499 * sum + 0.00000055 * sum * sum - 0.00028826 * age;
    const bf = 495 / density - 450;
    return Math.max(4, Math.min(45, bf));
  }, [folds, protocol, filledSites, proto.sites]);

  const leanMass = w > 0 ? w * (1 - bodyFat / 100) : 0;
  const fatMass = w > 0 ? w * (bodyFat / 100) : 0;

  const handleSave = () => {
    if (!canSave) {
      setShake(true);
      return;
    }
    setSaving(true);
    setTimeout(() => {
      setSaving(false);
      setSaved(true);
      setHistory((h) => [
        { date: 'HOJE', weight: w, bmi: bmi ?? 0, fat: bodyFat },
        ...h,
      ]);
    }, 1100);
  };

  return (
    <ScreenBg>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        >
          {/* header */}
          <View
            style={{
              paddingHorizontal: 22,
              paddingTop: 12,
              paddingBottom: 6,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <Pressable
              onPress={onBack}
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                backgroundColor: 'rgba(255,255,255,0.05)',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.09)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="arrow-left" size={17} color="rgba(255,255,255,0.8)" />
            </Pressable>
            <Slash>NOVO REGISTRO</Slash>
          </View>

          {/* title */}
          <View style={{ paddingHorizontal: 22, paddingTop: 10, paddingBottom: 8 }}>
            <Display size={32}>AVALIAÇÃO</Display>
            <Display size={32}>FÍSICA</Display>
            <Text
              style={{
                marginTop: 12,
                fontFamily: fonts.ui,
                fontSize: 14,
                lineHeight: 22,
                color: colors.mute,
                maxWidth: 320,
              }}
            >
              Registre suas medidas corporais e acompanhe sua evolução ao longo do tempo.
            </Text>
          </View>

          {/* INFORMAÇÕES BÁSICAS */}
          <View style={{ paddingHorizontal: 22, paddingTop: 22 }}>
            <Slash style={{ marginBottom: 12 }}>INFORMAÇÕES BÁSICAS</Slash>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <MeasureField
                label="PESO"
                unit="kg"
                value={weight}
                onChange={setWeight}
                error={shake && w <= 0}
                shakeX={shakeX}
              />
              <MeasureField
                label="ALTURA"
                unit="cm"
                value={height}
                onChange={setHeight}
                error={shake && h <= 0}
                shakeX={shakeX}
              />
            </View>

            {/* IMC automático */}
            <Card style={{ padding: 16, marginTop: 12 }}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 12,
                }}
              >
                <MonoLabel>IMC AUTOMÁTICO</MonoLabel>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text
                    style={{
                      fontFamily: fonts.display,
                      fontSize: 26,
                      color: '#fff',
                      transform: [{ skewX: '-8deg' }],
                    }}
                  >
                    {bmi != null ? bmi.toFixed(1) : '—'}
                  </Text>
                  {band && (
                    <View
                      style={{
                        paddingHorizontal: 8,
                        paddingVertical: 4,
                        borderRadius: 6,
                        backgroundColor: band.c,
                      }}
                    >
                      <Text
                        style={{
                          fontFamily: fonts.monoBold,
                          fontSize: 9,
                          letterSpacing: 0.8,
                          color: '#020010',
                        }}
                      >
                        {band.l}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
              <View
                style={{
                  position: 'relative',
                  height: 8,
                  borderRadius: 6,
                  backgroundColor: 'rgba(255,255,255,0.07)',
                  overflow: 'visible',
                }}
              >
                <LinearGradient
                  colors={['#4da3ff', '#22c55e', '#f5a623', '#f0563f']}
                  locations={[0, 0.33, 0.66, 1]}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    borderRadius: 6,
                    opacity: 0.4,
                  }}
                />
                {bmi != null && (
                  <View
                    style={{
                      position: 'absolute',
                      top: -3,
                      left: `${bmiPct}%`,
                      width: 3,
                      height: 14,
                      backgroundColor: '#fff',
                      marginLeft: -1.5,
                      shadowColor: '#fff',
                      shadowOpacity: 0.8,
                      shadowRadius: 6,
                      shadowOffset: { width: 0, height: 0 },
                      elevation: 4,
                    }}
                  />
                )}
              </View>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  marginTop: 10,
                  paddingHorizontal: 2,
                }}
              >
                {['18.5', '25', '30'].map((t) => (
                  <MonoLabel key={t}>{t}</MonoLabel>
                ))}
              </View>
            </Card>
          </View>

          {/* DOBRAS CUTÂNEAS */}
          <View style={{ paddingHorizontal: 22, paddingTop: 26 }}>
            <Slash style={{ marginBottom: 12 }}>DOBRAS CUTÂNEAS</Slash>

            {/* protocol dropdown */}
            <View style={{ position: 'relative', zIndex: 5 }}>
              <Pressable
                onPress={() => setProtocolOpen((o) => !o)}
                style={{
                  paddingVertical: 15,
                  paddingHorizontal: 16,
                  borderRadius: 14,
                  backgroundColor: 'rgba(255,255,255,0.04)',
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.09)',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <View style={{ flex: 1 }}>
                  <MonoLabel style={{ marginBottom: 4 }}>PROTOCOLO</MonoLabel>
                  <Text style={{ fontSize: 15, fontFamily: fonts.uiBold, color: '#fff' }}>
                    {proto.label}
                  </Text>
                </View>
                <View
                  style={{
                    transform: [{ rotate: protocolOpen ? '180deg' : '0deg' }],
                  }}
                >
                  <Icon name="chevron-down" size={18} color={colors.accentHi} stroke={2} />
                </View>
              </Pressable>

              {protocolOpen && (
                <View
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    marginTop: 6,
                    borderRadius: 14,
                    overflow: 'hidden',
                    backgroundColor: '#080323',
                    borderWidth: 1,
                    borderColor: 'rgba(11,112,249,0.4)',
                    shadowColor: '#000',
                    shadowOpacity: 0.5,
                    shadowRadius: 25,
                    shadowOffset: { width: 0, height: 10 },
                    elevation: 12,
                  }}
                >
                  {SKINFOLD_PROTOCOLS.map((p, i) => (
                    <Pressable
                      key={p.id}
                      onPress={() => {
                        setProtocol(p.id);
                        setProtocolOpen(false);
                        setFolds({});
                      }}
                      style={{
                        paddingVertical: 13,
                        paddingHorizontal: 16,
                        backgroundColor:
                          protocol === p.id ? 'rgba(11,112,249,0.16)' : 'transparent',
                        borderTopWidth: i ? 1 : 0,
                        borderTopColor: 'rgba(255,255,255,0.06)',
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <Text style={{ fontSize: 13.5, fontFamily: fonts.uiSemi, color: '#fff' }}>
                        {p.label}
                      </Text>
                      {protocol === p.id && (
                        <Icon name="check" size={14} color={colors.accentHi} />
                      )}
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            {/* fill progress */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                marginTop: 14,
                marginBottom: 12,
              }}
            >
              <View style={{ flex: 1 }}>
                <SegBar value={filledSites / proto.sites.length} segs={proto.sites.length} />
              </View>
              <MonoLabel>
                {filledSites}/{proto.sites.length}
              </MonoLabel>
            </View>

            {/* dynamic fold fields */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {proto.sites.map((s) => (
                <View key={s.k} style={{ width: '48.5%' }}>
                  <MeasureField
                    label={s.l.toUpperCase()}
                    unit="mm"
                    small
                    value={folds[s.k] || ''}
                    onChange={(v) => setFold(s.k, v)}
                  />
                </View>
              ))}
            </View>
          </View>

          {/* RESULTADOS */}
          <View style={{ paddingHorizontal: 22, paddingTop: 26 }}>
            <Slash style={{ marginBottom: 12 }}>RESULTADOS</Slash>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              <ResultCard
                label="% GORDURA"
                value={bodyFat.toFixed(1).replace('.', ',')}
                unit="%"
                icon="flame"
              />
              <ResultCard
                label="MASSA MAGRA"
                value={leanMass > 0 ? leanMass.toFixed(1).replace('.', ',') : '—'}
                unit="kg"
                icon="dumbbell"
              />
              <ResultCard
                label="MASSA GORDA"
                value={fatMass > 0 ? fatMass.toFixed(1).replace('.', ',') : '—'}
                unit="kg"
                icon="target"
              />
              <ResultCard
                label="IMC"
                value={bmi != null ? bmi.toFixed(1) : '—'}
                unit=""
                icon="chart"
              />
            </View>
          </View>

          {/* HISTÓRICO */}
          <View style={{ paddingHorizontal: 22, paddingTop: 26 }}>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <Slash>HISTÓRICO</Slash>
              <MonoLabel>{history.length} REGISTROS</MonoLabel>
            </View>

            {history.length === 0 ? (
              <Card style={{ padding: 32, alignItems: 'center' }}>
                <Icon name="chart" size={26} color="rgba(255,255,255,0.25)" />
                <Text
                  style={{
                    fontFamily: fonts.uiBold,
                    fontSize: 14,
                    color: '#fff',
                    marginTop: 10,
                  }}
                >
                  Nenhuma avaliação registrada
                </Text>
                <Text
                  style={{
                    fontFamily: fonts.ui,
                    fontSize: 12.5,
                    color: colors.mute,
                    marginTop: 4,
                    textAlign: 'center',
                  }}
                >
                  Salve sua primeira avaliação para começar a linha do tempo.
                </Text>
              </Card>
            ) : (
              <View style={{ position: 'relative', paddingLeft: 4 }}>
                <View
                  style={{
                    position: 'absolute',
                    left: 15,
                    top: 6,
                    bottom: 6,
                    width: 1.5,
                    backgroundColor: 'rgba(11,112,249,0.25)',
                  }}
                />
                {history.map((h, i) => (
                  <HistoryItem
                    key={i}
                    entry={h}
                    highlight={i === 0}
                    expanded={expanded === i}
                    onToggle={() => setExpanded(expanded === i ? null : i)}
                  />
                ))}
              </View>
            )}
          </View>

          {/* SAVE CTA */}
          <View style={{ paddingHorizontal: 22, paddingTop: 26 }}>
            <Animated.View style={{ transform: [{ translateX: shakeX }] }}>
              <Pressable
                onPress={handleSave}
                disabled={saving}
                style={{ opacity: saving ? 0.75 : 1 }}
              >
                <LinearGradient
                  colors={['#1f82ff', colors.accent]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 0, y: 1 }}
                  style={{
                    height: 58,
                    borderTopLeftRadius: 12,
                    borderTopRightRadius: 12,
                    borderBottomLeftRadius: 12,
                    borderBottomRightRadius: 0,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                    shadowColor: colors.accent,
                    shadowOpacity: 0.45,
                    shadowRadius: 24,
                    shadowOffset: { width: 0, height: 8 },
                    elevation: 8,
                  }}
                >
                  {saving ? (
                    <>
                      <Spinner />
                      <Text
                        style={{
                          fontFamily: fonts.display,
                          fontSize: 17,
                          letterSpacing: 1.5,
                          color: '#fff',
                          textTransform: 'uppercase',
                        }}
                      >
                        Salvando…
                      </Text>
                    </>
                  ) : (
                    <>
                      <Text
                        style={{
                          fontFamily: fonts.display,
                          fontSize: 17,
                          letterSpacing: 1.5,
                          color: '#fff',
                          textTransform: 'uppercase',
                        }}
                      >
                        Salvar Avaliação
                      </Text>
                      <Icon name="arrow-right" size={18} color="#fff" />
                    </>
                  )}
                </LinearGradient>
              </Pressable>
            </Animated.View>
            {!canSave && (
              <MonoLabel
                color={shake ? '#f0563f' : colors.faint}
                style={{ textAlign: 'center', marginTop: 10 }}
              >
                PREENCHA PESO E ALTURA PARA SALVAR
              </MonoLabel>
            )}
          </View>
        </ScrollView>

        {/* success toast */}
        {saved && (
          <Animated.View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 70,
              left: 22,
              right: 22,
              paddingVertical: 14,
              paddingHorizontal: 16,
              borderRadius: 14,
              backgroundColor: 'rgba(8,10,30,0.94)',
              borderWidth: 1,
              borderColor: 'rgba(34,197,94,0.4)',
              shadowColor: '#22c55e',
              shadowOpacity: 0.25,
              shadowRadius: 20,
              shadowOffset: { width: 0, height: 0 },
              elevation: 12,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              opacity: toastOpacity,
              transform: [{ translateY: toastY }],
            }}
          >
            <View
              style={{
                width: 30,
                height: 30,
                borderRadius: 15,
                backgroundColor: '#22c55e',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="check" size={16} color="#020010" stroke={2.6} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontFamily: fonts.uiBold, color: '#fff' }}>
                Avaliação salva com sucesso
              </Text>
              <Text
                style={{
                  fontSize: 11.5,
                  color: colors.mute,
                  marginTop: 2,
                  fontFamily: fonts.ui,
                }}
              >
                Adicionada ao seu histórico de evolução.
              </Text>
            </View>
          </Animated.View>
        )}
      </SafeAreaView>
    </ScreenBg>
  );
}

function MeasureField({
  label,
  unit,
  value,
  onChange,
  error,
  small,
  shakeX,
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  error?: boolean;
  small?: boolean;
  shakeX?: Animated.Value;
}) {
  const Wrapper: React.ComponentType<{ children: React.ReactNode; style?: object }> = shakeX
    ? ({ children, style }) => (
        <Animated.View
          style={[{ flex: small ? undefined : 1, transform: [{ translateX: shakeX }] }, style]}
        >
          {children}
        </Animated.View>
      )
    : ({ children, style }) => (
        <View style={[{ flex: small ? undefined : 1 }, style]}>{children}</View>
      );

  return (
    <Wrapper>
      <MonoLabel color={error ? '#f0563f' : colors.faint} style={{ marginBottom: 6 }}>
        {label}
      </MonoLabel>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingVertical: small ? 10 : 13,
          paddingHorizontal: small ? 12 : 14,
          borderRadius: 12,
          backgroundColor: 'rgba(255,255,255,0.04)',
          borderWidth: 1,
          borderColor: error ? '#f0563f' : 'rgba(255,255,255,0.09)',
        }}
      >
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder="0"
          placeholderTextColor={colors.faint}
          keyboardType="decimal-pad"
          style={{
            flex: 1,
            minWidth: 0,
            color: '#fff',
            fontFamily: fonts.display,
            fontSize: small ? 18 : 22,
            padding: 0,
          }}
        />
        <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.faint }}>{unit}</Text>
      </View>
    </Wrapper>
  );
}

function ResultCard({
  label,
  value,
  unit,
  icon,
}: {
  label: string;
  value: string;
  unit: string;
  icon: IconName;
}) {
  return (
    <Card style={{ width: '48.5%', padding: 15 }}>
      <View
        style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}
      >
        <MonoLabel>{label}</MonoLabel>
        <Icon name={icon} size={14} color={colors.accentHi} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
        <Text
          style={{
            fontFamily: fonts.display,
            fontSize: 26,
            color: '#fff',
            transform: [{ skewX: '-8deg' }],
          }}
        >
          {value}
        </Text>
        {unit ? <MonoLabel>{unit}</MonoLabel> : null}
      </View>
    </Card>
  );
}

function HistoryItem({
  entry,
  highlight,
  expanded,
  onToggle,
}: {
  entry: HistoryEntry;
  highlight: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const chevronRot = useRef(new Animated.Value(expanded ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(chevronRot, {
      toValue: expanded ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [expanded, chevronRot]);

  const leanMass = entry.weight * (1 - entry.fat / 100);
  const fatMass = entry.weight * (entry.fat / 100);

  return (
    <View style={{ position: 'relative', paddingLeft: 34, marginBottom: 12 }}>
      <View
        style={{
          position: 'absolute',
          left: 8,
          top: 18,
          width: 14,
          height: 14,
          borderRadius: 7,
          backgroundColor: highlight ? colors.accent : 'rgba(255,255,255,0.12)',
          borderWidth: 2,
          borderColor: highlight ? colors.accentHi : 'rgba(255,255,255,0.2)',
          shadowColor: highlight ? colors.accent : 'transparent',
          shadowOpacity: highlight ? 0.7 : 0,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 0 },
          elevation: highlight ? 4 : 0,
        }}
      />
      <Card style={{ padding: 15 }}>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <MonoLabel color={highlight ? colors.accentHi : colors.faint}>{entry.date}</MonoLabel>
          <Pressable
            onPress={onToggle}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
          >
            <Text
              style={{
                fontFamily: fonts.mono,
                fontSize: 10,
                letterSpacing: 1,
                color: 'rgba(255,255,255,0.6)',
              }}
            >
              VER DETALHES
            </Text>
            <Animated.View
              style={{
                transform: [
                  {
                    rotate: chevronRot.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0deg', '90deg'],
                    }),
                  },
                ],
              }}
            >
              <Icon name="chevron-right" size={12} color="rgba(255,255,255,0.6)" />
            </Animated.View>
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
          <MiniStat l="PESO" v={entry.weight.toFixed(1)} u="kg" />
          <MiniStat l="IMC" v={entry.bmi.toFixed(1)} u="" />
          <MiniStat l="% GORDURA" v={entry.fat.toFixed(1)} u="%" />
        </View>
        {expanded && (
          <View
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTopWidth: 1,
              borderTopColor: 'rgba(255,255,255,0.07)',
            }}
          >
            <Text
              style={{
                fontFamily: fonts.ui,
                fontSize: 12.5,
                color: colors.mute,
                lineHeight: 20,
              }}
            >
              Massa magra estimada {leanMass.toFixed(1)}kg · massa gorda{' '}
              {fatMass.toFixed(1)}kg · protocolo Jackson & Pollock 7 dobras.
            </Text>
          </View>
        )}
      </Card>
    </View>
  );
}

function MiniStat({ l, v, u }: { l: string; v: string; u: string }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        paddingVertical: 8,
        borderRadius: 8,
        backgroundColor: 'rgba(255,255,255,0.03)',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Text
          style={{
            fontFamily: fonts.display,
            fontSize: 15,
            color: '#fff',
            transform: [{ skewX: '-8deg' }],
          }}
        >
          {v}
        </Text>
        {u ? (
          <Text
            style={{
              fontFamily: fonts.mono,
              fontSize: 10,
              color: colors.faint,
              marginLeft: 1,
            }}
          >
            {u}
          </Text>
        ) : null}
      </View>
      <Text
        style={{
          fontFamily: fonts.mono,
          fontSize: 8,
          color: colors.faint,
          letterSpacing: 0.5,
          marginTop: 3,
        }}
      >
        {l}
      </Text>
    </View>
  );
}

function Spinner() {
  const rot = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(rot, {
        toValue: 1,
        duration: 700,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [rot]);
  return (
    <Animated.View
      style={{
        width: 16,
        height: 16,
        borderRadius: 8,
        borderWidth: 2,
        borderColor: 'rgba(255,255,255,0.35)',
        borderTopColor: '#fff',
        transform: [
          {
            rotate: rot.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }),
          },
        ],
      }}
    />
  );
}
