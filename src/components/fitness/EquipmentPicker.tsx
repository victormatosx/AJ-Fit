import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { Display, Slash } from '../ui/Display';
import { Icon } from '../ui/Icon';
import { colors, fonts } from '../../theme/tokens';

// ── Equipment glyphs ────────────────────────────────────────
type EqIconName =
  | 'dumbbell' | 'barbell' | 'kettlebell' | 'plate' | 'bench' | 'incline'
  | 'rack' | 'smith' | 'cable' | 'machine' | 'legpress' | 'pulldown'
  | 'ball' | 'abwheel' | 'band' | 'rope' | 'rings' | 'pullup'
  | 'treadmill' | 'bike' | 'rower' | 'box' | 'bodyweight' | 'mat'
  | 'trx' | 'medball';

function EqIcon({ name, size = 26, color = '#cfe0ff' }: { name: EqIconName; size?: number; color?: string }) {
  const p = {
    stroke: color,
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };
  const common = { width: size, height: size, viewBox: '0 0 32 32' };
  switch (name) {
    case 'dumbbell':
      return <Svg {...common}><Path {...p} d="M5 12v8M9 9v14M23 9v14M27 12v8M9 16h14" /></Svg>;
    case 'barbell':
      return <Svg {...common}><Path {...p} d="M3 16h2M27 16h2M7 11v10M10 13v6M22 13v6M25 11v10M10 16h12" /></Svg>;
    case 'kettlebell':
      return <Svg {...common}><Path {...p} d="M12 9a4 4 0 018 0M11 10c-3 1-5 4-5 8a5 5 0 005 5h10a5 5 0 005-5c0-4-2-7-5-8" /></Svg>;
    case 'plate':
      return <Svg {...common}><Circle {...p} cx="16" cy="16" r="11" /><Circle {...p} cx="16" cy="16" r="3" /></Svg>;
    case 'bench':
      return <Svg {...common}><Path {...p} d="M4 12h24M6 12v8M26 12v8M4 16h24" /></Svg>;
    case 'incline':
      return <Svg {...common}><Path {...p} d="M4 22h24M6 22l16-10M10 22V16M22 12v10" /></Svg>;
    case 'rack':
      return <Svg {...common}><Path {...p} d="M7 5v22M25 5v22M7 11h18M7 17h18" /></Svg>;
    case 'smith':
      return <Svg {...common}><Path {...p} d="M8 4v24M24 4v24M11 14h10M11 14v4M21 14v4" /></Svg>;
    case 'cable':
      return <Svg {...common}><Path {...p} d="M16 4v8M16 12a4 4 0 11-.01 0M11 22h10l-2 6h-6z" /></Svg>;
    case 'machine':
      return <Svg {...common}><Rect {...p} x="6" y="6" width="20" height="20" rx="2" /><Path {...p} d="M11 12h10M11 16h6M11 20h8" /></Svg>;
    case 'legpress':
      return <Svg {...common}><Path {...p} d="M5 22h8M9 22V10M9 14l14-6M20 7l4 2-2 5" /></Svg>;
    case 'pulldown':
      return <Svg {...common}><Path {...p} d="M16 4v6M10 8h12M12 12v4M20 12v4M9 16h14l-2 10H11z" /></Svg>;
    case 'ball':
      return <Svg {...common}><Circle {...p} cx="16" cy="16" r="11" /><Path {...p} d="M5 16h22M16 5c4 3 4 19 0 22M16 5c-4 3-4 19 0 22" /></Svg>;
    case 'abwheel':
      return <Svg {...common}><Circle {...p} cx="16" cy="18" r="8" /><Circle {...p} cx="16" cy="18" r="2" /><Path {...p} d="M8 18H4M28 18h-4" /></Svg>;
    case 'band':
      return <Svg {...common}><Path {...p} d="M8 6c-4 6-4 14 0 20M24 6c4 6 4 14 0 20M8 12h16M8 20h16" /></Svg>;
    case 'rope':
      return <Svg {...common}><Path {...p} d="M6 6c4 0 4 4 0 4s-4 4 0 4M16 6v20M26 6c-4 0-4 4 0 4s4 4 0 4" /></Svg>;
    case 'rings':
      return <Svg {...common}><Path {...p} d="M10 4v8M22 4v8" /><Circle {...p} cx="10" cy="18" r="6" /><Circle {...p} cx="22" cy="18" r="6" /></Svg>;
    case 'pullup':
      return <Svg {...common}><Path {...p} d="M4 6h24M9 6v6M23 6v6M13 12a3 3 0 016 0v3M14 15v8M18 15v8" /></Svg>;
    case 'treadmill':
      return <Svg {...common}><Path {...p} d="M4 24l22-2M6 24v-3M26 22V8h-4M14 11a2 2 0 100-4 2 2 0 000 4M12 16l3-3 4 2 2 3" /></Svg>;
    case 'bike':
      return <Svg {...common}><Circle {...p} cx="8" cy="22" r="5" /><Circle {...p} cx="24" cy="22" r="5" /><Path {...p} d="M8 22l5-10h6M13 12l5 10M19 12h4" /></Svg>;
    case 'rower':
      return <Svg {...common}><Path {...p} d="M4 20h24M8 20l4-6 8 1M20 15l4-7M6 24h6M22 24h4" /></Svg>;
    case 'box':
      return <Svg {...common}><Path {...p} d="M6 12h20v14H6zM6 12l4-4h12l4 4" /></Svg>;
    case 'bodyweight':
      return <Svg {...common}><Circle {...p} cx="16" cy="7" r="3" /><Path {...p} d="M16 10v9M16 13l-7-2M16 13l7-2M16 19l-4 7M16 19l4 7" /></Svg>;
    case 'mat':
      return <Svg {...common}><Rect {...p} x="4" y="11" width="24" height="10" rx="2" /><Path {...p} d="M8 11v10M24 11v10" /></Svg>;
    case 'trx':
      return <Svg {...common}><Path {...p} d="M16 4v6M11 9h10M13 11l-2 9h3l1-6M19 11l2 9h-3l-1-6" /></Svg>;
    case 'medball':
      return <Svg {...common}><Circle {...p} cx="16" cy="16" r="10" /><Path {...p} d="M10 10l12 12M22 10L10 22" /></Svg>;
    default:
      return <Svg {...common}><Circle {...p} cx="16" cy="16" r="10" /></Svg>;
  }
}

// ── ExerciseDB taxonomy → PT label, icon, category ──────────
type Meta = { l: string; i: EqIconName; cat: string };
const EXDB_EQUIP: Record<string, Meta> = {
  barbell: { l: 'Barra', i: 'barbell', cat: 'Peso livre' },
  'olympic barbell': { l: 'Barra olímpica', i: 'barbell', cat: 'Peso livre' },
  'ez barbell': { l: 'Barra W', i: 'barbell', cat: 'Peso livre' },
  'trap bar': { l: 'Barra hexagonal', i: 'barbell', cat: 'Peso livre' },
  dumbbell: { l: 'Halteres', i: 'dumbbell', cat: 'Peso livre' },
  kettlebell: { l: 'Kettlebell', i: 'kettlebell', cat: 'Peso livre' },
  weighted: { l: 'Peso adicional', i: 'plate', cat: 'Peso livre' },
  hammer: { l: 'Martelo', i: 'plate', cat: 'Peso livre' },
  'smith machine': { l: 'Smith machine', i: 'smith', cat: 'Bancos e racks' },
  'leverage machine': { l: 'Máquina articulada', i: 'machine', cat: 'Máquinas' },
  cable: { l: 'Polia / Cabo', i: 'cable', cat: 'Máquinas' },
  assisted: { l: 'Máquina assistida', i: 'machine', cat: 'Máquinas' },
  'sled machine': { l: 'Leg press / Sled', i: 'legpress', cat: 'Máquinas' },
  band: { l: 'Elástico', i: 'band', cat: 'Funcional e acessórios' },
  'resistance band': { l: 'Faixa de resistência', i: 'band', cat: 'Funcional e acessórios' },
  rope: { l: 'Corda', i: 'rope', cat: 'Funcional e acessórios' },
  'medicine ball': { l: 'Medicine ball', i: 'medball', cat: 'Funcional e acessórios' },
  'stability ball': { l: 'Bola de estabilidade', i: 'ball', cat: 'Funcional e acessórios' },
  'bosu ball': { l: 'Bosu', i: 'ball', cat: 'Funcional e acessórios' },
  roller: { l: 'Rolo de liberação', i: 'mat', cat: 'Funcional e acessórios' },
  'wheel roller': { l: 'Roda abdominal', i: 'abwheel', cat: 'Funcional e acessórios' },
  tire: { l: 'Pneu', i: 'plate', cat: 'Funcional e acessórios' },
  'body weight': { l: 'Peso corporal', i: 'bodyweight', cat: 'Sem equipamento' },
  'stationary bike': { l: 'Bike ergométrica', i: 'bike', cat: 'Cardio' },
  'elliptical machine': { l: 'Elíptico', i: 'machine', cat: 'Cardio' },
  'stepmill machine': { l: 'Simulador de escada', i: 'box', cat: 'Cardio' },
  'skierg machine': { l: 'SkiErg', i: 'rower', cat: 'Cardio' },
  'upper body ergometer': { l: 'Ergômetro de braço', i: 'rower', cat: 'Cardio' },

  // Roboflow "All Gym Equipment" — máquinas de academia de rede
  bench: { l: 'Banco', i: 'bench', cat: 'Bancos e racks' },
  'abdominal bench': { l: 'Banco abdominal', i: 'bench', cat: 'Bancos e racks' },
  'preacher curl': { l: 'Banco Scott', i: 'incline', cat: 'Bancos e racks' },
  'leg raise tower': { l: 'Torre de abdominal', i: 'pullup', cat: 'Bancos e racks' },
  'functional trainer': { l: 'Estação funcional', i: 'cable', cat: 'Máquinas' },
  'lat pull down machine': { l: 'Puxador (pulley)', i: 'pulldown', cat: 'Máquinas' },
  'seated row machine': { l: 'Remada sentada', i: 'machine', cat: 'Máquinas' },
  'chest press machine': { l: 'Supino máquina', i: 'machine', cat: 'Máquinas' },
  'chest fly machine': { l: 'Voador (peck deck)', i: 'machine', cat: 'Máquinas' },
  'shoulder press machine': { l: 'Desenvolvimento máquina', i: 'machine', cat: 'Máquinas' },
  'lateral raises machine': { l: 'Elevação lateral máquina', i: 'machine', cat: 'Máquinas' },
  'seated dip machine': { l: 'Tríceps máquina', i: 'machine', cat: 'Máquinas' },
  'leg press machine': { l: 'Leg press', i: 'legpress', cat: 'Máquinas' },
  'hack squat machine': { l: 'Hack squat', i: 'legpress', cat: 'Máquinas' },
  'leg extension machine': { l: 'Cadeira extensora', i: 'machine', cat: 'Máquinas' },
  'leg curl machine': { l: 'Mesa flexora', i: 'machine', cat: 'Máquinas' },
  'back extension machine': { l: 'Extensão lombar', i: 'machine', cat: 'Máquinas' },
  'ab crunch machine': { l: 'Abdominal máquina', i: 'machine', cat: 'Máquinas' },
  'ghd machine': { l: 'Cadeira GHD', i: 'machine', cat: 'Máquinas' },
  'ab roller': { l: 'Roda abdominal', i: 'abwheel', cat: 'Funcional e acessórios' },
  elliptical: { l: 'Elíptico', i: 'machine', cat: 'Cardio' },
  stepmill: { l: 'Simulador de escada', i: 'box', cat: 'Cardio' },
  treadmill: { l: 'Esteira', i: 'treadmill', cat: 'Cardio' },
};

const ROBOFLOW_CLASSES = [
  'bench', 'ab crunch machine', 'ab roller', 'abdominal bench', 'back extension machine',
  'barbell', 'chest fly machine', 'chest press machine', 'dumbbell', 'elliptical',
  'functional trainer', 'ghd machine', 'hack squat machine', 'kettlebell',
  'lat pull down machine', 'lateral raises machine', 'leg curl machine', 'leg extension machine',
  'leg press machine', 'leg raise tower', 'preacher curl', 'seated dip machine',
  'seated row machine', 'shoulder press machine', 'smith machine', 'stability ball',
  'stationary bike', 'stepmill', 'treadmill',
];

const EXDB_CAT_ORDER = ['Peso livre', 'Bancos e racks', 'Máquinas', 'Funcional e acessórios', 'Cardio', 'Sem equipamento', 'Outros'];
const EXDB_FALLBACK = Array.from(new Set([...Object.keys(EXDB_EQUIP), ...ROBOFLOW_CLASSES]));

type Item = { v: string; l: string; i: EqIconName };
type Group = { cat: string; items: Item[] };

function buildCatalog(names: string[]): Group[] {
  const groups: Record<string, Item[]> = {};
  names.forEach((n) => {
    const key = String(n).toLowerCase().trim();
    const meta = EXDB_EQUIP[key] || {
      l: key.replace(/\b\w/g, (c) => c.toUpperCase()),
      i: 'machine' as EqIconName,
      cat: 'Outros',
    };
    (groups[meta.cat] = groups[meta.cat] || []).push({ v: key, l: meta.l, i: meta.i });
  });
  return EXDB_CAT_ORDER.filter((c) => groups[c]).map((c) => ({ cat: c, items: groups[c] }));
}

async function fetchExerciseDBEquipments(): Promise<{ names: string[]; live: boolean }> {
  try {
    const r = await fetch('https://exercisedb-api.vercel.app/api/v1/equipments');
    if (r.ok) {
      const data: any = await r.json();
      const list: string[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.data)
          ? data.data.map((x: any) => x.name || x)
          : [];
      if (list.length) return { names: list, live: true };
    }
  } catch {
    /* fall through */
  }
  return { names: EXDB_FALLBACK, live: false };
}

const COLLAPSE = 4;
type Conn = 'loading' | 'live' | 'offline';

type Props = {
  value: string[];
  onChange: (v: string[]) => void;
  onDone: () => void;
  onBack: () => void;
  stepLabel: string; // e.g. "EQUIPAMENTO · 10 / 12"
};

export function EquipmentPicker({ value, onChange, onDone, onBack, stepLabel }: Props) {
  const selected = value || [];
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [catalog, setCatalog] = useState<Group[]>(() => buildCatalog(EXDB_FALLBACK));
  const [conn, setConn] = useState<Conn>('loading');

  useEffect(() => {
    let alive = true;
    fetchExerciseDBEquipments().then(({ names, live }) => {
      if (!alive) return;
      const merged = Array.from(new Set([...names, ...ROBOFLOW_CLASSES]));
      setCatalog(buildCatalog(merged));
      setConn(live ? 'live' : 'offline');
    });
    return () => {
      alive = false;
    };
  }, []);

  const toggle = (v: string) => {
    const next = selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v];
    onChange(next);
  };

  const toggleAllGym = () => {
    const all = catalog
      .flatMap((c) => c.items.map((i) => i.v))
      .filter((v) => v !== 'body weight');
    onChange(all);
  };

  const q = query.trim().toLowerCase();

  const connColor =
    conn === 'live' ? '#4da3ff' : conn === 'loading' ? '#caa84a' : 'rgba(255,255,255,0.4)';
  const connLabel =
    conn === 'live' ? 'AO VIVO' : conn === 'loading' ? 'CONECTANDO' : 'TAXONOMIA LOCAL';

  const emptyResults = useMemo(
    () => q && catalog.every((g) => g.items.every((it) => !it.l.toLowerCase().includes(q))),
    [q, catalog],
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#020010' }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        {/* Header */}
        <View
          style={{
            paddingHorizontal: 22,
            paddingTop: 6,
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
            <Icon name="arrow-left" size={17} color="#fff" />
          </Pressable>

          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text
              style={{
                fontFamily: fonts.mono,
                fontSize: 10,
                letterSpacing: 2,
                color: colors.faint,
              }}
            >
              {stepLabel}
            </Text>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                marginTop: 4,
              }}
            >
              <View
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: 3,
                  backgroundColor: connColor,
                }}
              />
              <Text
                style={{
                  fontFamily: fonts.mono,
                  fontSize: 8.5,
                  letterSpacing: 1,
                  color: connColor,
                }}
              >
                EXERCISEDB · {connLabel}
              </Text>
            </View>
          </View>

          <Pressable
            onPress={onDone}
            style={{
              paddingHorizontal: 16,
              paddingVertical: 9,
              borderRadius: 10,
              backgroundColor: 'rgba(255,255,255,0.05)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.09)',
            }}
          >
            <Text style={{ fontSize: 13, fontFamily: fonts.uiSemi, color: 'rgba(255,255,255,0.85)' }}>
              Pular
            </Text>
          </Pressable>
        </View>

        {/* Title + quick pick */}
        <View style={{ paddingHorizontal: 22, paddingTop: 18, paddingBottom: 14 }}>
          <Display size={30}>{'ONDE VOCÊ\nSE EXERCITA?'}</Display>
          <Text
            style={{
              marginTop: 12,
              color: colors.mute,
              fontSize: 14,
              lineHeight: 21,
              fontFamily: fonts.ui,
            }}
          >
            Selecione os equipamentos aos quais você tem acesso. Pode alterar depois.
          </Text>
          <Pressable
            onPress={toggleAllGym}
            style={{
              marginTop: 14,
              alignSelf: 'flex-start',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 7,
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 999,
              backgroundColor: 'rgba(11,112,249,0.12)',
              borderWidth: 1,
              borderColor: 'rgba(11,112,249,0.4)',
            }}
          >
            <Icon name="check" size={13} color="#4da3ff" />
            <Text style={{ color: '#4da3ff', fontSize: 12.5, fontFamily: fonts.uiSemi }}>
              Tenho academia completa
            </Text>
          </Pressable>
        </View>

        {/* Search */}
        <View style={{ paddingHorizontal: 22, paddingBottom: 8 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              height: 46,
              paddingHorizontal: 14,
              borderRadius: 13,
              backgroundColor: 'rgba(255,255,255,0.05)',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.09)',
            }}
          >
            <Icon name="target" size={16} color="rgba(255,255,255,0.4)" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Buscar equipamento"
              placeholderTextColor="rgba(255,255,255,0.3)"
              style={{
                flex: 1,
                color: '#fff',
                fontSize: 14.5,
                fontFamily: fonts.ui,
                padding: 0,
              }}
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <Icon name="x" size={15} color="rgba(255,255,255,0.4)" />
              </Pressable>
            )}
          </View>
        </View>

        {/* Catalog */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 22, paddingTop: 8, paddingBottom: 12 }}
          showsVerticalScrollIndicator={false}
        >
          {catalog.map((group) => {
            const matched = group.items.filter((it) => !q || it.l.toLowerCase().includes(q));
            if (matched.length === 0) return null;
            const isOpen = Boolean(q) || Boolean(expanded[group.cat]);
            const shown = isOpen ? matched : matched.slice(0, COLLAPSE);
            const more = matched.length - shown.length;
            return (
              <View key={group.cat} style={{ marginBottom: 22 }}>
                <Slash style={{ marginBottom: 12 }}>{group.cat}</Slash>
                <View style={{ gap: 8 }}>
                  {shown.map((it) => {
                    const on = selected.includes(it.v);
                    return (
                      <Pressable
                        key={it.v}
                        onPress={() => toggle(it.v)}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 14,
                          paddingHorizontal: 14,
                          paddingVertical: 11,
                          borderRadius: 14,
                          backgroundColor: on ? 'rgba(11,112,249,0.12)' : 'rgba(255,255,255,0.03)',
                          borderWidth: 1,
                          borderColor: on ? colors.accent : 'rgba(255,255,255,0.06)',
                          shadowColor: on ? colors.accent : 'transparent',
                          shadowOpacity: on ? 0.35 : 0,
                          shadowRadius: on ? 18 : 0,
                          shadowOffset: { width: 0, height: 0 },
                        }}
                      >
                        <View
                          style={{
                            width: 52,
                            height: 52,
                            borderRadius: 12,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: on ? 'rgba(11,112,249,0.18)' : 'rgba(255,255,255,0.04)',
                            borderWidth: 1,
                            borderColor: 'rgba(255,255,255,0.06)',
                          }}
                        >
                          <EqIcon name={it.i} size={28} color={on ? '#7db4ff' : '#cfe0ff'} />
                        </View>
                        <Text
                          style={{
                            flex: 1,
                            color: '#fff',
                            fontSize: 15.5,
                            fontFamily: fonts.uiSemi,
                          }}
                        >
                          {it.l}
                        </Text>
                        <View
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: 8,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: on ? colors.accent : 'transparent',
                            borderWidth: on ? 0 : 1.5,
                            borderColor: 'rgba(255,255,255,0.2)',
                          }}
                        >
                          {on && <Icon name="check" size={15} color="#fff" stroke={2.6} />}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
                {!q && more > 0 && (
                  <Pressable
                    onPress={() => setExpanded((e) => ({ ...e, [group.cat]: true }))}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingTop: 12,
                      paddingBottom: 4,
                    }}
                  >
                    <Text
                      style={{
                        color: colors.mute,
                        fontSize: 13,
                        fontFamily: fonts.uiMed,
                      }}
                    >
                      Ver todos {group.cat}{' '}
                      <Text style={{ color: colors.faint }}>· +{more}</Text>
                    </Text>
                    <Icon name="chevron-right" size={15} color="rgba(255,255,255,0.4)" />
                  </Pressable>
                )}
                {!q && expanded[group.cat] && (
                  <Pressable
                    onPress={() => setExpanded((e) => ({ ...e, [group.cat]: false }))}
                    style={{ paddingTop: 12, paddingBottom: 4 }}
                  >
                    <Text style={{ color: colors.faint, fontSize: 12.5, fontFamily: fonts.uiMed }}>
                      Recolher
                    </Text>
                  </Pressable>
                )}
              </View>
            );
          })}

          {emptyResults && (
            <View style={{ alignItems: 'center', paddingVertical: 30 }}>
              <Text style={{ color: colors.faint, fontSize: 13, fontFamily: fonts.ui }}>
                Nenhum equipamento encontrado.
              </Text>
            </View>
          )}
        </ScrollView>

        {/* CTA */}
        <View style={{ paddingHorizontal: 22, paddingTop: 10, paddingBottom: 12 }}>
          <Pressable
            onPress={onDone}
            style={{
              width: '100%',
              height: 58,
              borderTopLeftRadius: 12,
              borderTopRightRadius: 12,
              borderBottomLeftRadius: 12,
              borderBottomRightRadius: 0,
              backgroundColor: colors.accent,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              shadowColor: colors.accent,
              shadowOffset: { width: 0, height: 10 },
              shadowOpacity: 0.45,
              shadowRadius: 20,
              elevation: 8,
            }}
          >
            <Text
              style={{
                color: '#fff',
                fontFamily: fonts.display,
                fontSize: 17,
                letterSpacing: 1.5,
                textTransform: 'uppercase',
              }}
            >
              Continuar
            </Text>
            {selected.length > 0 && (
              <View
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                  borderRadius: 6,
                  backgroundColor: 'rgba(255,255,255,0.22)',
                }}
              >
                <Text
                  style={{
                    fontFamily: fonts.mono,
                    fontSize: 12,
                    color: '#fff',
                  }}
                >
                  {selected.length}
                </Text>
              </View>
            )}
            <Icon name="arrow-right" size={18} color="#fff" />
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}
