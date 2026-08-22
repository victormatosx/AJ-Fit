import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { Display, Slash } from '../ui/Display';
import { Icon } from '../ui/Icon';
import { useTheme } from '../../theme';

/** Loose t signature for dynamic key lookups (equipment ids as key
 *  fragments). Bounded by string in/out — no `any`. */
type LooseT = (key: string, options?: Record<string, unknown>) => string;

// ── Equipment glyphs ────────────────────────────────────────
type EqIconName =
  | 'dumbbell' | 'barbell' | 'kettlebell' | 'plate' | 'bench' | 'incline'
  | 'rack' | 'smith' | 'cable' | 'machine' | 'legpress' | 'pulldown'
  | 'ball' | 'abwheel' | 'band' | 'rope' | 'rings' | 'pullup'
  | 'treadmill' | 'bike' | 'rower' | 'box' | 'bodyweight' | 'mat'
  | 'trx' | 'medball';

function EqIcon({ name, size = 26, color }: { name: EqIconName; size?: number; color?: string }) {
  const { theme } = useTheme();
  const p = {
    stroke: color ?? theme.colors.equipmentIcon,
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

// ── ExerciseDB taxonomy → icon + stable category id ────────
//
// `cat` is a STABLE ID resolved at render time via
// t(`quiz:equipment.categories.${cat}`). Do NOT store a translated string
// here — categories drive grouping and ordering, so they must not change
// with the active language.
//
// The literal keys of this map (`barbell`, `smith machine`, ...) are the
// same IDs persisted in `quiz.equipment` (via `onChange(v)` → `Quiz`), so
// renaming any of them requires a data migration. Labels are looked up in
// `quiz:equipment.items.<key>` at render time.
type CategoryId =
  | 'freeWeights'
  | 'benchesAndRacks'
  | 'machines'
  | 'functional'
  | 'cardio'
  | 'bodyweight'
  | 'other';

type Meta = { i: EqIconName; cat: CategoryId };
const EXDB_EQUIP: Record<string, Meta> = {
  barbell: { i: 'barbell', cat: 'freeWeights' },
  'olympic barbell': { i: 'barbell', cat: 'freeWeights' },
  'ez barbell': { i: 'barbell', cat: 'freeWeights' },
  'trap bar': { i: 'barbell', cat: 'freeWeights' },
  dumbbell: { i: 'dumbbell', cat: 'freeWeights' },
  kettlebell: { i: 'kettlebell', cat: 'freeWeights' },
  weighted: { i: 'plate', cat: 'freeWeights' },
  hammer: { i: 'plate', cat: 'freeWeights' },
  'smith machine': { i: 'smith', cat: 'benchesAndRacks' },
  'leverage machine': { i: 'machine', cat: 'machines' },
  cable: { i: 'cable', cat: 'machines' },
  assisted: { i: 'machine', cat: 'machines' },
  'sled machine': { i: 'legpress', cat: 'machines' },
  band: { i: 'band', cat: 'functional' },
  'resistance band': { i: 'band', cat: 'functional' },
  rope: { i: 'rope', cat: 'functional' },
  'medicine ball': { i: 'medball', cat: 'functional' },
  'stability ball': { i: 'ball', cat: 'functional' },
  'bosu ball': { i: 'ball', cat: 'functional' },
  roller: { i: 'mat', cat: 'functional' },
  'wheel roller': { i: 'abwheel', cat: 'functional' },
  tire: { i: 'plate', cat: 'functional' },
  'body weight': { i: 'bodyweight', cat: 'bodyweight' },
  'stationary bike': { i: 'bike', cat: 'cardio' },
  'elliptical machine': { i: 'machine', cat: 'cardio' },
  'stepmill machine': { i: 'box', cat: 'cardio' },
  'skierg machine': { i: 'rower', cat: 'cardio' },
  'upper body ergometer': { i: 'rower', cat: 'cardio' },

  // Roboflow "All Gym Equipment" — máquinas de academia de rede
  bench: { i: 'bench', cat: 'benchesAndRacks' },
  'abdominal bench': { i: 'bench', cat: 'benchesAndRacks' },
  'preacher curl': { i: 'incline', cat: 'benchesAndRacks' },
  'leg raise tower': { i: 'pullup', cat: 'benchesAndRacks' },
  'functional trainer': { i: 'cable', cat: 'machines' },
  'lat pull down machine': { i: 'pulldown', cat: 'machines' },
  'seated row machine': { i: 'machine', cat: 'machines' },
  'chest press machine': { i: 'machine', cat: 'machines' },
  'chest fly machine': { i: 'machine', cat: 'machines' },
  'shoulder press machine': { i: 'machine', cat: 'machines' },
  'lateral raises machine': { i: 'machine', cat: 'machines' },
  'seated dip machine': { i: 'machine', cat: 'machines' },
  'leg press machine': { i: 'legpress', cat: 'machines' },
  'hack squat machine': { i: 'legpress', cat: 'machines' },
  'leg extension machine': { i: 'machine', cat: 'machines' },
  'leg curl machine': { i: 'machine', cat: 'machines' },
  'back extension machine': { i: 'machine', cat: 'machines' },
  'ab crunch machine': { i: 'machine', cat: 'machines' },
  'ghd machine': { i: 'machine', cat: 'machines' },
  'ab roller': { i: 'abwheel', cat: 'functional' },
  elliptical: { i: 'machine', cat: 'cardio' },
  stepmill: { i: 'box', cat: 'cardio' },
  treadmill: { i: 'treadmill', cat: 'cardio' },
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

const EXDB_CAT_ORDER: CategoryId[] = [
  'freeWeights',
  'benchesAndRacks',
  'machines',
  'functional',
  'cardio',
  'bodyweight',
  'other',
];
const EXDB_FALLBACK = Array.from(new Set([...Object.keys(EXDB_EQUIP), ...ROBOFLOW_CLASSES]));

/** `v` is the persisted id and the i18n lookup key (equipment.items.<v>). */
type Item = { v: string; i: EqIconName };
type Group = { cat: CategoryId; items: Item[] };

function buildCatalog(names: string[]): Group[] {
  const groups: Partial<Record<CategoryId, Item[]>> = {};
  names.forEach((n) => {
    const key = String(n).toLowerCase().trim();
    const meta = EXDB_EQUIP[key] ?? { i: 'machine' as EqIconName, cat: 'other' as const };
    (groups[meta.cat] = groups[meta.cat] ?? []).push({ v: key, i: meta.i });
  });
  return EXDB_CAT_ORDER.filter((c) => groups[c]).map((c) => ({
    cat: c,
    items: groups[c]!,
  }));
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
  const { theme } = useTheme();
  const { t } = useTranslation(['quiz', 'common']);
  const tLoose = t as unknown as LooseT;
  const selected = value || [];
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [catalog, setCatalog] = useState<Group[]>(() => buildCatalog(EXDB_FALLBACK));
  const [conn, setConn] = useState<Conn>('loading');

  /** Resolves an equipment id to its localized display label. Items in the
   *  taxonomy that don't have a translation entry fall back to a title-cased
   *  version of the id (same behavior as the old code, but now typed). */
  const labelFor = (id: string): string => {
    const key = `quiz:equipment.items.${id}`;
    const translated = tLoose(key);
    if (translated && translated !== `items.${id}` && translated !== key) return translated;
    return id.replace(/\b\w/g, (c) => c.toUpperCase());
  };
  const categoryLabel = (cat: CategoryId): string =>
    tLoose(`quiz:equipment.categories.${cat}`);

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
    conn === 'live'
      ? theme.colors.statusConnected
      : conn === 'loading'
        ? theme.colors.statusConnecting
        : theme.colors.statusOffline;
  const connLabel =
    conn === 'live'
      ? t('quiz:equipment.connection.live').toUpperCase()
      : conn === 'loading'
        ? t('quiz:equipment.connection.loading').toUpperCase()
        : t('quiz:equipment.connection.offline').toUpperCase();
  const connPrefix = t('quiz:equipment.connection.prefix').toUpperCase();

  // Search matches on the localized label — swapping languages re-filters
  // automatically because `catalog` is stable but `labelFor` reads from
  // the current `t`.
  const emptyResults = useMemo(
    () =>
      q &&
      catalog.every((g) =>
        g.items.every((it) => !labelFor(it.v).toLowerCase().includes(q)),
      ),
    // labelFor closes over `t`, so re-run when the language changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, catalog, t],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
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
              backgroundColor: theme.colors.controlBackground,
              borderWidth: 1,
              borderColor: theme.colors.controlBorder,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="arrow-left" size={17} color={theme.colors.textPrimary} />
          </Pressable>

          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text
              style={{
                fontFamily: theme.fonts.mono,
                fontSize: 10,
                letterSpacing: 2,
                color: theme.colors.textFaint,
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
                  fontFamily: theme.fonts.mono,
                  fontSize: 8.5,
                  letterSpacing: 1,
                  color: connColor,
                }}
              >
                {connPrefix} · {connLabel}
              </Text>
            </View>
          </View>

          <Pressable
            onPress={onDone}
            style={{
              paddingHorizontal: 16,
              paddingVertical: 9,
              borderRadius: 10,
              backgroundColor: theme.colors.controlBackground,
              borderWidth: 1,
              borderColor: theme.colors.controlBorder,
            }}
          >
            <Text style={{ fontSize: 13, fontFamily: theme.fonts.uiSemi, color: theme.colors.choiceTextSecondary }}>
              {t('quiz:equipment.skip')}
            </Text>
          </Pressable>
        </View>

        {/* Title + quick pick */}
        <View style={{ paddingHorizontal: 22, paddingTop: 18, paddingBottom: 14 }}>
          <Display size={30}>{t('quiz:equipment.title').toUpperCase()}</Display>
          <Text
            style={{
              marginTop: 12,
              color: theme.colors.textMuted,
              fontSize: 14,
              lineHeight: 21,
              fontFamily: theme.fonts.ui,
            }}
          >
            {t('quiz:equipment.sub')}
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
              backgroundColor: theme.colors.surfaceSelected,
              borderWidth: 1,
              borderColor: theme.colors.primaryBorderMuted,
            }}
          >
            <Icon name="check" size={13} color={theme.colors.primaryEmphasis} />
            <Text style={{ color: theme.colors.primaryEmphasis, fontSize: 12.5, fontFamily: theme.fonts.uiSemi }}>
              {t('quiz:equipment.quickPickAllGym')}
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
              backgroundColor: theme.colors.inputBackground,
              borderWidth: 1,
              borderColor: theme.colors.inputBorderSubtle,
            }}
          >
            <Icon name="target" size={16} color={theme.colors.iconMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('quiz:equipment.search')}
              placeholderTextColor={theme.colors.inputPlaceholderSubtle}
              style={{
                flex: 1,
                color: theme.colors.inputText,
                fontSize: 14.5,
                fontFamily: theme.fonts.ui,
                padding: 0,
              }}
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <Icon name="x" size={15} color={theme.colors.inputIcon} />
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
            const matched = group.items.filter(
              (it) => !q || labelFor(it.v).toLowerCase().includes(q),
            );
            if (matched.length === 0) return null;
            const isOpen = Boolean(q) || Boolean(expanded[group.cat]);
            const shown = isOpen ? matched : matched.slice(0, COLLAPSE);
            const more = matched.length - shown.length;
            const catLabel = categoryLabel(group.cat);
            return (
              <View key={group.cat} style={{ marginBottom: 22 }}>
                <Slash style={{ marginBottom: 12 }}>{catLabel}</Slash>
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
                          backgroundColor: on
                            ? theme.colors.equipmentItemSelectedBackground
                            : theme.colors.equipmentItemBackground,
                          borderWidth: 1,
                          borderColor: on ? theme.colors.primary : theme.colors.equipmentItemBorder,
                          shadowColor: on ? theme.colors.primary : 'transparent',
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
                            backgroundColor: on
                              ? theme.colors.equipmentIconSelectedBackground
                              : theme.colors.equipmentIconBackground,
                            borderWidth: 1,
                            borderColor: theme.colors.equipmentItemBorder,
                          }}
                        >
                          <EqIcon
                            name={it.i}
                            size={28}
                            color={
                              on
                                ? theme.colors.equipmentIconSelected
                                : theme.colors.equipmentIcon
                            }
                          />
                        </View>
                        <Text
                          style={{
                            flex: 1,
                            color: theme.colors.textPrimary,
                            fontSize: 15.5,
                            fontFamily: theme.fonts.uiSemi,
                          }}
                        >
                          {labelFor(it.v)}
                        </Text>
                        <View
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: 8,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: on ? theme.colors.primary : 'transparent',
                            borderWidth: on ? 0 : 1.5,
                            borderColor: theme.colors.equipmentCheckboxBorder,
                          }}
                        >
                          {on && (
                            <Icon
                              name="check"
                              size={15}
                              color={theme.colors.primaryForeground}
                              stroke={2.6}
                            />
                          )}
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
                        color: theme.colors.textMuted,
                        fontSize: 13,
                        fontFamily: theme.fonts.uiMed,
                      }}
                    >
                      {t('quiz:equipment.seeAll', { category: catLabel })}{' '}
                      <Text style={{ color: theme.colors.textFaint }}>· +{more}</Text>
                    </Text>
                    <Icon name="chevron-right" size={15} color={theme.colors.iconMuted} />
                  </Pressable>
                )}
                {!q && expanded[group.cat] && (
                  <Pressable
                    onPress={() => setExpanded((e) => ({ ...e, [group.cat]: false }))}
                    style={{ paddingTop: 12, paddingBottom: 4 }}
                  >
                    <Text style={{ color: theme.colors.textFaint, fontSize: 12.5, fontFamily: theme.fonts.uiMed }}>
                      {t('quiz:equipment.collapse')}
                    </Text>
                  </Pressable>
                )}
              </View>
            );
          })}

          {emptyResults && (
            <View style={{ alignItems: 'center', paddingVertical: 30 }}>
              <Text style={{ color: theme.colors.textFaint, fontSize: 13, fontFamily: theme.fonts.ui }}>
                {t('quiz:equipment.empty')}
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
              backgroundColor: theme.colors.primary,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              shadowColor: theme.colors.primary,
              shadowOffset: { width: 0, height: 10 },
              shadowOpacity: 0.45,
              shadowRadius: 20,
              elevation: 8,
            }}
          >
            <Text
              style={{
                color: theme.colors.primaryForeground,
                fontFamily: theme.fonts.display,
                fontSize: 17,
                letterSpacing: 1.5,
                textTransform: 'uppercase',
              }}
            >
              {t('common:actions.continue')}
            </Text>
            {selected.length > 0 && (
              <View
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                  borderRadius: 6,
                  backgroundColor: theme.colors.counterBackground,
                }}
              >
                <Text
                  style={{
                    fontFamily: theme.fonts.mono,
                    fontSize: 12,
                    color: theme.colors.primaryForeground,
                  }}
                >
                  {selected.length}
                </Text>
              </View>
            )}
            <Icon name="arrow-right" size={18} color={theme.colors.primaryForeground} />
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}
