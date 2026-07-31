import {
  doc,
  collection,
  getDocs,
  setDoc,
  query,
  orderBy,
  limit,
  serverTimestamp,
  Timestamp,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
  isPlausibleBodyFat,
  isValidAge,
  isValidHeight,
  isValidWeight,
  requiredFoldsPresent,
  SKINFOLD_PROTOCOLS,
  type Sex,
  type SiteKey,
  type SkinfoldProtocolId,
} from '../lib/skinfoldCalculator';

/**
 * Physical-assessment repository — the only place that touches
 * `users/{userId}/assessments`.
 *
 * Data model (docs/03_modelagem_banco_e_dados.md §4/§8,
 * docs/15_calculadora_de_dobras_subcutaneas.md §10/§11):
 *
 *   users/{userId}/assessments/{assessmentId}
 *     source: 'guided' | 'imported'
 *     measuredAt, createdAt, weight, height, notes?
 *
 *     guided:   bodyFat (number), calculatorVersion: 1, protocol, sex, age, folds
 *     imported: bodyFat (number, absent when unknown — read back as null),
 *               bodyWater?, basalMetabolism?, visceralFat?
 *
 * `source` is a discriminant in TypeScript too (see AssessmentDoc below): a
 * guided assessment cannot be constructed without protocol/sex/age/folds/
 * bodyFat — the compiler enforces it, not just runtime validation.
 *
 * Same conventions as `userProfile.ts`'s `questionnaires` subcollection:
 * documents are IMMUTABLE (never updated/deleted — a new assessment always
 * creates a new document), auto-id via `doc(collection(...))`, `createdAt`
 * via `serverTimestamp()`. `measuredAt` (not `createdAt`) is the field used
 * for ordering/"latest", since an imported assessment may be back-dated;
 * `createdAt` is a secondary/tie-break sort key for same-day entries.
 *
 * BMI, lean mass, fat mass, sum of folds and body density are NEVER stored
 * here — they are derived values, always recomputed at read time from the
 * primary fields (see src/lib/skinfoldCalculator.ts) to avoid the stored
 * value drifting from the calculation logic. `protocolLabel` is likewise not
 * stored — it's resolved from `protocol` via skinfoldCalculator's
 * `protocolLabel()` map, so relabeling a protocol doesn't require a data
 * migration.
 */

export type AssessmentSource = 'guided' | 'imported';

type AssessmentCommon = {
  id: string;
  measuredAt: Timestamp;
  createdAt: Timestamp | null;
  weight: number;
  height: number;
  notes?: string;
};

export type GuidedAssessmentDoc = AssessmentCommon & {
  source: 'guided';
  bodyFat: number;
  calculatorVersion: 1;
  protocol: SkinfoldProtocolId;
  sex: Sex;
  age: number;
  folds: Partial<Record<SiteKey, number>>;
};

export type ImportedAssessmentDoc = AssessmentCommon & {
  source: 'imported';
  bodyFat: number | null;
  bodyWater?: number;
  basalMetabolism?: number;
  visceralFat?: number;
};

/** Discriminated union on `source` — a guided doc can't exist without calculator fields. */
export type AssessmentDoc = GuidedAssessmentDoc | ImportedAssessmentDoc;

export type GuidedAssessmentInput = {
  /** Real date of the measurement; defaults to now. Never in the future. */
  measuredAt?: Date;
  weight: number;
  height: number;
  bodyFat: number;
  protocol: SkinfoldProtocolId;
  sex: Sex;
  age: number;
  /** Must contain every site the protocol/sex requires — validated before writing. */
  folds: Partial<Record<SiteKey, number>>;
  notes?: string;
};

export type ImportedAssessmentInput = {
  measuredAt?: Date;
  weight: number;
  height: number;
  /** Unknown when the imported report didn't include a body-fat estimate. */
  bodyFat?: number | null;
  bodyWater?: number;
  basalMetabolism?: number;
  visceralFat?: number;
  notes?: string;
};

const ASSESSMENTS = 'assessments';

function assessmentsRef(uid: string) {
  return collection(db, 'users', uid, ASSESSMENTS);
}

/** Drops undefined entries so optional fields are simply absent, never null-ish placeholders. */
function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function assertValidMeasuredAt(measuredAt: Date): void {
  if (Number.isNaN(measuredAt.getTime())) {
    throw new Error('Data da avaliação inválida.');
  }
  if (measuredAt.getTime() > Date.now()) {
    throw new Error('A data da avaliação não pode estar no futuro.');
  }
}

function assertValidCommon(weight: number, height: number, measuredAt: Date): void {
  if (!isValidWeight(weight)) throw new Error('Peso inválido: informe um valor maior que zero.');
  if (!isValidHeight(height)) throw new Error('Altura inválida: informe um valor maior que zero.');
  assertValidMeasuredAt(measuredAt);
}

function assertValidGuidedInput(input: GuidedAssessmentInput, measuredAt: Date): void {
  assertValidCommon(input.weight, input.height, measuredAt);
  if (!isValidAge(input.age)) throw new Error('Idade inválida: informe um valor maior que zero.');
  const protocol = SKINFOLD_PROTOCOLS.find((p) => p.id === input.protocol);
  if (!protocol) throw new Error(`Protocolo desconhecido: ${input.protocol}.`);
  const sites = protocol.sitesFor(input.sex);
  if (!requiredFoldsPresent(input.folds, sites)) {
    throw new Error('Preencha todas as dobras exigidas pelo protocolo e sexo selecionados.');
  }
  if (!isPlausibleBodyFat(input.bodyFat)) {
    throw new Error('Percentual de gordura fora da faixa plausível — confira as dobras informadas.');
  }
}

function assertValidImportedInput(input: ImportedAssessmentInput, measuredAt: Date): void {
  assertValidCommon(input.weight, input.height, measuredAt);
  if (input.bodyFat != null && !isPlausibleBodyFat(input.bodyFat)) {
    throw new Error('Percentual de gordura fora da faixa plausível.');
  }
}

function fromSnap(d: QueryDocumentSnapshot<DocumentData>): AssessmentDoc {
  const data = d.data();
  const common = {
    id: d.id,
    measuredAt: data.measuredAt as Timestamp,
    createdAt: (data.createdAt as Timestamp | undefined) ?? null,
    weight: data.weight as number,
    height: data.height as number,
    notes: data.notes as string | undefined,
  };
  if (data.source === 'guided') {
    return {
      ...common,
      source: 'guided',
      bodyFat: data.bodyFat as number,
      calculatorVersion: 1,
      protocol: data.protocol as SkinfoldProtocolId,
      sex: data.sex as Sex,
      age: data.age as number,
      folds: (data.folds as Partial<Record<SiteKey, number>>) ?? {},
    };
  }
  return {
    ...common,
    source: 'imported',
    bodyFat: (data.bodyFat as number | undefined) ?? null,
    bodyWater: data.bodyWater as number | undefined,
    basalMetabolism: data.basalMetabolism as number | undefined,
    visceralFat: data.visceralFat as number | undefined,
  };
}

/**
 * Adds a guided assessment (calculator flow). Creates a new immutable
 * document — never overwrites a previous one. Validated before writing so a
 * malformed record can never reach Firestore (defense in depth alongside
 * the security rules and the modal's own validation).
 */
export async function addGuidedAssessment(
  uid: string,
  input: GuidedAssessmentInput,
): Promise<string> {
  const measuredAt = input.measuredAt ?? new Date();
  assertValidGuidedInput(input, measuredAt);

  const ref = doc(assessmentsRef(uid));
  const folds = stripUndefined(input.folds);
  await setDoc(
    ref,
    stripUndefined({
      source: 'guided',
      measuredAt: Timestamp.fromDate(measuredAt),
      createdAt: serverTimestamp(),
      weight: input.weight,
      height: input.height,
      bodyFat: input.bodyFat,
      calculatorVersion: 1,
      protocol: input.protocol,
      sex: input.sex,
      age: input.age,
      folds,
      notes: input.notes?.trim() || undefined,
    }),
  );
  return ref.id;
}

/**
 * Adds an imported assessment (results already computed elsewhere, e.g. a
 * professional bioimpedance/DEXA scan). Creates a new immutable document.
 * `bodyFat` may be omitted entirely when the source report didn't include it
 * — it is read back as `null`, never as `0`.
 */
export async function addImportedAssessment(
  uid: string,
  input: ImportedAssessmentInput,
): Promise<string> {
  const measuredAt = input.measuredAt ?? new Date();
  assertValidImportedInput(input, measuredAt);

  const ref = doc(assessmentsRef(uid));
  await setDoc(
    ref,
    stripUndefined({
      source: 'imported',
      measuredAt: Timestamp.fromDate(measuredAt),
      createdAt: serverTimestamp(),
      weight: input.weight,
      height: input.height,
      bodyFat: input.bodyFat ?? undefined,
      bodyWater: input.bodyWater,
      basalMetabolism: input.basalMetabolism,
      visceralFat: input.visceralFat,
      notes: input.notes?.trim() || undefined,
    }),
  );
  return ref.id;
}

/**
 * All assessments for the user, ordered by `measuredAt` desc with `createdAt`
 * desc as a tie-break (never plain `createdAt` — an imported assessment may
 * be back-dated). This two-field `orderBy` requires a Firestore composite
 * index (`measuredAt` DESC, `createdAt` DESC) — see firestore.indexes.json.
 * Capped at `max` (default 200) to keep the read bounded; the timeline UI
 * itself only ever renders a handful at a time.
 */
export async function getAssessments(uid: string, max = 200): Promise<AssessmentDoc[]> {
  const q = query(
    assessmentsRef(uid),
    orderBy('measuredAt', 'desc'),
    orderBy('createdAt', 'desc'),
    limit(max),
  );
  const snap = await getDocs(q);
  return snap.docs.map(fromSnap);
}
