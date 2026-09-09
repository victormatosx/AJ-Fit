import { createHash } from 'node:crypto';

import type {
  NotificationCategory,
  NotificationDispatchRequest,
  NotificationType,
} from './schema';

export const QA_PREVIEW_NOTIFICATION_TYPES = [
  'QA_TEST',
  'WORKOUT_DAY',
  'RECOVERY_DAY',
  'MISSED_WORKOUT',
  'EVOLUTION_UNLOCKED',
  'PROGRAM_UPDATED',
  'EVOLUTION_APPROACHING',
  'BILLING_ISSUE',
  'PREMIUM_ENDED',
] as const satisfies readonly NotificationType[];
export type QaPreviewNotificationType = (typeof QA_PREVIEW_NOTIFICATION_TYPES)[number];

const MAX_TITLE_LENGTH = 120;
const MAX_BODY_LENGTH = 240;
const MAX_ID_LENGTH = 160;
const MAX_IDEMPOTENCY_KEY_LENGTH = 300;
const MAX_DATA_KEYS = 8;
const MAX_DATA_KEY_LENGTH = 40;
const MAX_DATA_VALUE_LENGTH = 160;
const MAX_DATA_SERIALIZED_BYTES = 1024;
const SAFE_ID_PATTERN = /^[A-Za-z0-9_.:-]+$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

interface TypePolicy {
  category: NotificationCategory;
  allowedDataKeys: readonly string[];
  allowedIntents: readonly string[];
  allowedCopies: readonly NotificationCopy[];
}

export const NOTIFICATION_LOCALES = ['pt-BR', 'en', 'es'] as const;
export type NotificationLocale = (typeof NOTIFICATION_LOCALES)[number];

export interface NotificationCopy {
  title: string;
  body: string;
}

const QA_TEST_COPY: NotificationCopy = {
  title: 'AJ Fit — teste de push',
  body: 'A infraestrutura de notificações está funcionando.',
};

export const EVOLUTION_APPROACHING_COPIES = {
  'pt-BR': {
    title: 'Sua próxima evolução está chegando 🚀',
    body: 'Continue seguindo seu plano. Falta pouco para desbloquear a próxima etapa.',
  },
  en: {
    title: 'Your next evolution is getting closer 🚀',
    body: "Keep following your plan. You're getting close to your next stage.",
  },
  es: {
    title: 'Tu próxima evolución está cerca 🚀',
    body: 'Sigue con tu plan. Falta poco para desbloquear la próxima etapa.',
  },
} as const satisfies Readonly<Record<NotificationLocale, NotificationCopy>>;

export const EVOLUTION_UNLOCKED_COPIES = {
  EVOLUTION: {
    'pt-BR': {
      title: 'Você evoluiu! 🚀',
      body: 'Uma nova evolução do seu programa está disponível. Confira os próximos passos.',
    },
    en: {
      title: 'You leveled up! 🚀',
      body: 'A new program evolution is available. Check your next steps.',
    },
    es: {
      title: '¡Evolucionaste! 🚀',
      body: 'Hay una nueva evolución de tu programa disponible. Revisa los próximos pasos.',
    },
  },
  MOTIVATIONAL_RENEWAL: {
    'pt-BR': {
      title: 'Uma renovação está disponível ✨',
      body: 'Você pode renovar seu programa para continuar sua rotina.',
    },
    en: {
      title: 'A program renewal is available ✨',
      body: 'You can renew your program to keep your routine moving.',
    },
    es: {
      title: 'Hay una renovación disponible ✨',
      body: 'Puedes renovar tu programa para continuar con tu rutina.',
    },
  },
} as const satisfies Readonly<
  Record<'EVOLUTION' | 'MOTIVATIONAL_RENEWAL', Record<NotificationLocale, NotificationCopy>>
>;

export const PROGRAM_UPDATED_COPIES = {
  'pt-BR': {
    title: 'Seu treino foi atualizado',
    body: 'Ajustamos seu programa para continuar acompanhando sua rotina.',
  },
  en: {
    title: 'Your workout was updated',
    body: 'We adjusted your program to keep up with your routine.',
  },
  es: {
    title: 'Tu entrenamiento fue actualizado',
    body: 'Ajustamos tu programa para seguir acompañando tu rutina.',
  },
} as const satisfies Readonly<Record<NotificationLocale, NotificationCopy>>;

export const BILLING_ISSUE_COPIES = {
  'pt-BR': {
    title: 'Problema com sua assinatura',
    body: 'Não conseguimos confirmar a renovação do seu Premium. Confira sua assinatura para evitar interrupções.',
  },
  en: {
    title: 'There is an issue with your subscription',
    body: 'We could not confirm your Premium renewal. Check your subscription to avoid interruptions.',
  },
  es: {
    title: 'Hay un problema con tu suscripción',
    body: 'No pudimos confirmar la renovación de tu Premium. Revisa tu suscripción para evitar interrupciones.',
  },
} as const satisfies Readonly<Record<NotificationLocale, NotificationCopy>>;

export const PREMIUM_ENDED_COPIES = {
  'pt-BR': {
    title: 'Seu Premium terminou',
    body: 'Seu acesso Premium foi encerrado. Você pode renovar quando quiser.',
  },
  en: {
    title: 'Your Premium access has ended',
    body: 'Your Premium access has ended. You can renew whenever you want.',
  },
  es: {
    title: 'Tu acceso Premium terminó',
    body: 'Tu acceso Premium terminó. Puedes renovarlo cuando quieras.',
  },
} as const satisfies Readonly<Record<NotificationLocale, NotificationCopy>>;

export const WORKOUT_DAY_COPIES = {
  'pt-BR': {
    title: 'Hoje é dia de treino 💪',
    body: 'Seu treino de hoje está pronto. Vamos continuar sua evolução.',
  },
  en: {
    title: 'It’s workout day 💪',
    body: 'Today’s workout is ready. Keep building your progress.',
  },
  es: {
    title: 'Hoy toca entrenamiento 💪',
    body: 'Tu entrenamiento de hoy está listo. Sigue avanzando.',
  },
} as const satisfies Readonly<Record<NotificationLocale, NotificationCopy>>;

export const RECOVERY_DAY_COPIES = {
  'pt-BR': {
    title: 'Hoje é dia de recuperação',
    body: 'Seu descanso também faz parte do plano. Aproveite para recuperar as energias.',
  },
  en: {
    title: 'Today is a recovery day',
    body: 'Rest is part of the plan too. Give your body time to recover.',
  },
  es: {
    title: 'Hoy es día de recuperación',
    body: 'El descanso también forma parte del plan. Aprovecha para recuperarte.',
  },
} as const satisfies Readonly<Record<NotificationLocale, NotificationCopy>>;

export const MISSED_WORKOUT_COPIES = {
  'pt-BR': {
    title: 'Não perca o ritmo',
    body: 'Seu último treino ficou pendente. Volte ao plano quando estiver pronto.',
  },
  en: {
    title: 'Keep your momentum',
    body: 'Your last workout is still pending. Get back to your plan when you’re ready.',
  },
  es: {
    title: 'No pierdas el ritmo',
    body: 'Tu último entrenamiento quedó pendiente. Retoma tu plan cuando estés listo.',
  },
} as const satisfies Readonly<Record<NotificationLocale, NotificationCopy>>;

function copies<T extends Record<NotificationLocale, NotificationCopy>>(localized: T) {
  return NOTIFICATION_LOCALES.map((locale) => localized[locale]);
}

const TYPE_POLICIES: Readonly<Record<NotificationType, TypePolicy>> = {
  EVOLUTION_APPROACHING: {
    category: 'EVOLUTION_AND_ACHIEVEMENTS',
    allowedDataKeys: [],
    allowedIntents: [],
    allowedCopies: copies(EVOLUTION_APPROACHING_COPIES),
  },
  QA_TEST: {
    category: 'OPERATIONAL',
    allowedDataKeys: [],
    allowedIntents: [],
    allowedCopies: [QA_TEST_COPY],
  },
  EVOLUTION_UNLOCKED: {
    category: 'EVOLUTION_AND_ACHIEVEMENTS',
    allowedDataKeys: [],
    allowedIntents: [],
    allowedCopies: [
      ...copies(EVOLUTION_UNLOCKED_COPIES.EVOLUTION),
      ...copies(EVOLUTION_UNLOCKED_COPIES.MOTIVATIONAL_RENEWAL),
    ],
  },
  PROGRAM_UPDATED: {
    category: 'EVOLUTION_AND_ACHIEVEMENTS',
    allowedDataKeys: [],
    allowedIntents: [],
    allowedCopies: copies(PROGRAM_UPDATED_COPIES),
  },
  BILLING_ISSUE: {
    category: 'OPERATIONAL',
    allowedDataKeys: [],
    allowedIntents: [],
    allowedCopies: copies(BILLING_ISSUE_COPIES),
  },
  PREMIUM_ENDED: {
    category: 'OPERATIONAL',
    allowedDataKeys: [],
    allowedIntents: [],
    allowedCopies: copies(PREMIUM_ENDED_COPIES),
  },
  WORKOUT_DAY: {
    category: 'WORKOUTS_AND_REMINDERS',
    allowedDataKeys: [],
    allowedIntents: [],
    allowedCopies: copies(WORKOUT_DAY_COPIES),
  },
  RECOVERY_DAY: {
    category: 'WORKOUTS_AND_REMINDERS',
    allowedDataKeys: [],
    allowedIntents: [],
    allowedCopies: copies(RECOVERY_DAY_COPIES),
  },
  MISSED_WORKOUT: {
    category: 'WORKOUTS_AND_REMINDERS',
    allowedDataKeys: [],
    allowedIntents: [],
    allowedCopies: copies(MISSED_WORKOUT_COPIES),
  },
};

export class NotificationContentPolicyError extends Error {
  constructor(public readonly reason: string) {
    super(`notification_content_policy_violation:${reason}`);
    this.name = 'NotificationContentPolicyError';
  }
}

function fail(reason: string): never {
  throw new NotificationContentPolicyError(reason);
}

function assertSafeId(value: unknown, field: string, maxLength = MAX_ID_LENGTH): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    fail(`${field}_length`);
  }
  if (!SAFE_ID_PATTERN.test(value)) fail(`${field}_charset`);
}

function assertDisplayString(value: unknown, field: string, maxLength: number): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    fail(field);
  }
  if (CONTROL_CHARACTER_PATTERN.test(value)) fail(`${field}_control_character`);
}

function assertAllowedData(
  data: unknown,
  allowedKeys: readonly string[],
): asserts data is Record<string, string | number | boolean> | undefined {
  if (data === undefined) return;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) fail('data_type');

  const record = data as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length > MAX_DATA_KEYS) fail('data_too_many_keys');
  if (!keys.every((key) => allowedKeys.includes(key))) fail('data_key_not_allowed');

  for (const [key, value] of Object.entries(record)) {
    if (key.length === 0 || key.length > MAX_DATA_KEY_LENGTH || !SAFE_ID_PATTERN.test(key)) {
      fail('data_key_invalid');
    }
    if (typeof value === 'string') {
      if (value.length > MAX_DATA_VALUE_LENGTH || CONTROL_CHARACTER_PATTERN.test(value)) {
        fail('data_value_invalid');
      }
      continue;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) fail('data_number_non_finite');
      continue;
    }
    if (typeof value !== 'boolean') fail('data_value_must_be_primitive');
  }

  const serialized = JSON.stringify(record);
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > MAX_DATA_SERIALIZED_BYTES) {
    fail('data_serialized_too_large');
  }
}

export function assertValidDispatchRequest(
  request: NotificationDispatchRequest,
): void {
  assertSafeId(request.uid, 'uid', 128);
  assertSafeId(request.notificationId, 'notificationId');
  assertSafeId(request.sourceIdentity, 'sourceIdentity');
  assertSafeId(request.idempotencyKey, 'idempotencyKey', MAX_IDEMPOTENCY_KEY_LENGTH);

  const policy = TYPE_POLICIES[request.type];
  if (!policy) fail('type_not_registered');
  if (request.category !== policy.category) fail('category_mismatch');

  assertDisplayString(request.title, 'title', MAX_TITLE_LENGTH);
  assertDisplayString(request.body, 'body', MAX_BODY_LENGTH);
  if (!policy.allowedCopies.some(
    (copy) => copy.title === request.title && copy.body === request.body,
  )) {
    fail('copy_not_allowed');
  }

  if (request.intent !== undefined && !policy.allowedIntents.includes(request.intent)) {
    fail('intent_not_allowed');
  }
  assertAllowedData(request.data, policy.allowedDataKeys);
}

export function buildQaTestNotification(params: {
  uid: string;
  notificationId: string;
  sourceIdentity: string;
  idempotencyKey: string;
}): NotificationDispatchRequest {
  const request: NotificationDispatchRequest = {
    ...params,
    type: 'QA_TEST',
    category: 'OPERATIONAL',
    ...QA_TEST_COPY,
    data: {},
  };
  assertValidDispatchRequest(request);
  return request;
}

export function buildEvolutionApproachingNotification(params: {
  uid: string;
  progressionWindowId: string;
  locale: NotificationLocale;
}): NotificationDispatchRequest {
  assertSafeId(params.progressionWindowId, 'progressionWindowId');
  const hash = createHash('sha256').update(params.progressionWindowId).digest('hex');
  const request: NotificationDispatchRequest = {
    uid: params.uid,
    type: 'EVOLUTION_APPROACHING',
    category: 'EVOLUTION_AND_ACHIEVEMENTS',
    notificationId: `EVOLUTION_APPROACHING:${hash}`,
    sourceIdentity: `progressionWindow:${hash}`,
    idempotencyKey: `notification:${params.uid}:EVOLUTION_APPROACHING:${hash}`,
    ...EVOLUTION_APPROACHING_COPIES[params.locale],
    data: {},
  };
  assertValidDispatchRequest(request);
  return request;
}

function eventIdentity(params: {
  uid: string;
  type: Exclude<NotificationType, 'QA_TEST'>;
  source: 'workoutLifecycleEvent' | 'revenueCatEvent';
  sourceEventId: string;
}): Pick<NotificationDispatchRequest, 'notificationId' | 'sourceIdentity' | 'idempotencyKey'> {
  const sourceHash = createHash('sha256').update(params.sourceEventId, 'utf8').digest('hex');
  return {
    notificationId: `${params.type}:${sourceHash}`,
    sourceIdentity: `${params.source}:${sourceHash}`,
    idempotencyKey: `notification:${params.uid}:${params.type}:${sourceHash}`,
  };
}

function dailyIdentity(params: {
  uid: string;
  type: 'WORKOUT_DAY' | 'RECOVERY_DAY' | 'MISSED_WORKOUT';
  sourceIdentity: string;
}): Pick<NotificationDispatchRequest, 'notificationId' | 'sourceIdentity' | 'idempotencyKey'> {
  const sourceHash = createHash('sha256').update(params.sourceIdentity, 'utf8').digest('hex');
  return {
    notificationId: `${params.type}:${sourceHash}`,
    sourceIdentity: `dailySchedule:${sourceHash}`,
    idempotencyKey: `notification:${params.uid}:${params.type}:${sourceHash}`,
  };
}

function buildProductNotification(params: {
  uid: string;
  type: Exclude<NotificationType, 'QA_TEST'>;
  category: NotificationCategory;
  source: 'workoutLifecycleEvent' | 'revenueCatEvent';
  sourceEventId: string;
  copy: NotificationCopy;
}): NotificationDispatchRequest {
  const request: NotificationDispatchRequest = {
    uid: params.uid,
    type: params.type,
    category: params.category,
    ...eventIdentity(params),
    ...params.copy,
    data: {},
  };
  assertValidDispatchRequest(request);
  return request;
}

export function buildEvolutionUnlockedNotification(params: {
  uid: string;
  lifecycleEventId: string;
  locale: NotificationLocale;
  variant: 'EVOLUTION' | 'MOTIVATIONAL_RENEWAL';
}): NotificationDispatchRequest {
  return buildProductNotification({
    uid: params.uid,
    type: 'EVOLUTION_UNLOCKED',
    category: 'EVOLUTION_AND_ACHIEVEMENTS',
    source: 'workoutLifecycleEvent',
    sourceEventId: params.lifecycleEventId,
    copy: EVOLUTION_UNLOCKED_COPIES[params.variant][params.locale],
  });
}

export function buildProgramUpdatedNotification(params: {
  uid: string;
  lifecycleEventId: string;
  locale: NotificationLocale;
}): NotificationDispatchRequest {
  return buildProductNotification({
    uid: params.uid,
    type: 'PROGRAM_UPDATED',
    category: 'EVOLUTION_AND_ACHIEVEMENTS',
    source: 'workoutLifecycleEvent',
    sourceEventId: params.lifecycleEventId,
    copy: PROGRAM_UPDATED_COPIES[params.locale],
  });
}

export function buildBillingIssueNotification(params: {
  uid: string;
  revenueCatEventId: string;
  locale: NotificationLocale;
}): NotificationDispatchRequest {
  return buildProductNotification({
    uid: params.uid,
    type: 'BILLING_ISSUE',
    category: 'OPERATIONAL',
    source: 'revenueCatEvent',
    sourceEventId: params.revenueCatEventId,
    copy: BILLING_ISSUE_COPIES[params.locale],
  });
}

export function buildPremiumEndedNotification(params: {
  uid: string;
  revenueCatEventId: string;
  locale: NotificationLocale;
}): NotificationDispatchRequest {
  return buildProductNotification({
    uid: params.uid,
    type: 'PREMIUM_ENDED',
    category: 'OPERATIONAL',
    source: 'revenueCatEvent',
    sourceEventId: params.revenueCatEventId,
    copy: PREMIUM_ENDED_COPIES[params.locale],
  });
}

function buildDailyWorkoutNotification(params: {
  uid: string;
  type: 'WORKOUT_DAY' | 'RECOVERY_DAY' | 'MISSED_WORKOUT';
  sourceIdentity: string;
  copy: NotificationCopy;
}): NotificationDispatchRequest {
  const request: NotificationDispatchRequest = {
    uid: params.uid,
    type: params.type,
    category: 'WORKOUTS_AND_REMINDERS',
    ...dailyIdentity(params),
    ...params.copy,
    data: {},
  };
  assertValidDispatchRequest(request);
  return request;
}

export function buildWorkoutDayNotification(params: {
  uid: string;
  localDate: string;
  locale: NotificationLocale;
}): NotificationDispatchRequest {
  return buildDailyWorkoutNotification({
    uid: params.uid,
    type: 'WORKOUT_DAY',
    sourceIdentity: params.localDate,
    copy: WORKOUT_DAY_COPIES[params.locale],
  });
}

export function buildRecoveryDayNotification(params: {
  uid: string;
  localDate: string;
  locale: NotificationLocale;
}): NotificationDispatchRequest {
  return buildDailyWorkoutNotification({
    uid: params.uid,
    type: 'RECOVERY_DAY',
    sourceIdentity: params.localDate,
    copy: RECOVERY_DAY_COPIES[params.locale],
  });
}

export function buildMissedWorkoutNotification(params: {
  uid: string;
  plannedSessionIdentity: string;
  locale: NotificationLocale;
}): NotificationDispatchRequest {
  return buildDailyWorkoutNotification({
    uid: params.uid,
    type: 'MISSED_WORKOUT',
    sourceIdentity: params.plannedSessionIdentity,
    copy: MISSED_WORKOUT_COPIES[params.locale],
  });
}

/**
 * Builds a visual-only QA request by first invoking the exact canonical
 * product builder, then replacing only its domain identity with a QA-scoped
 * identity. Copy, locale, payload data and intent remain byte-for-byte the
 * canonical builder output. The fixture never reads or writes domain facts.
 */
export function buildQaPreviewNotification(params: {
  uid: string;
  type: QaPreviewNotificationType;
  qaRequestId: string;
  locale: NotificationLocale;
}): NotificationDispatchRequest {
  assertSafeId(params.qaRequestId, 'qaRequestId', 64);
  const fixtureIdentity = `qa-preview:${params.qaRequestId}`;
  let canonical: NotificationDispatchRequest;

  switch (params.type) {
    case 'QA_TEST':
      canonical = buildQaTestNotification({
        uid: params.uid,
        notificationId: `qa-preview:QA_TEST:${params.qaRequestId}`,
        sourceIdentity: `qaPreview:QA_TEST:${params.qaRequestId}`,
        idempotencyKey: `qa-preview:${params.uid}:QA_TEST:${params.qaRequestId}`,
      });
      break;
    case 'WORKOUT_DAY':
      canonical = buildWorkoutDayNotification({
        uid: params.uid, localDate: fixtureIdentity, locale: params.locale,
      });
      break;
    case 'RECOVERY_DAY':
      canonical = buildRecoveryDayNotification({
        uid: params.uid, localDate: fixtureIdentity, locale: params.locale,
      });
      break;
    case 'MISSED_WORKOUT':
      canonical = buildMissedWorkoutNotification({
        uid: params.uid, plannedSessionIdentity: fixtureIdentity, locale: params.locale,
      });
      break;
    case 'EVOLUTION_UNLOCKED':
      canonical = buildEvolutionUnlockedNotification({
        uid: params.uid,
        lifecycleEventId: fixtureIdentity,
        locale: params.locale,
        variant: 'EVOLUTION',
      });
      break;
    case 'PROGRAM_UPDATED':
      canonical = buildProgramUpdatedNotification({
        uid: params.uid, lifecycleEventId: fixtureIdentity, locale: params.locale,
      });
      break;
    case 'EVOLUTION_APPROACHING':
      canonical = buildEvolutionApproachingNotification({
        uid: params.uid, progressionWindowId: fixtureIdentity, locale: params.locale,
      });
      break;
    case 'BILLING_ISSUE':
      canonical = buildBillingIssueNotification({
        uid: params.uid, revenueCatEventId: fixtureIdentity, locale: params.locale,
      });
      break;
    case 'PREMIUM_ENDED':
      canonical = buildPremiumEndedNotification({
        uid: params.uid, revenueCatEventId: fixtureIdentity, locale: params.locale,
      });
      break;
    default: {
      const exhaustive: never = params.type;
      throw new NotificationContentPolicyError(`qa_type_not_implemented:${exhaustive}`);
    }
  }

  if (params.type === 'QA_TEST') return canonical;
  const request: NotificationDispatchRequest = {
    ...canonical,
    notificationId: `qa-preview:${params.type}:${params.qaRequestId}`,
    sourceIdentity: `qaPreview:${params.type}:${params.qaRequestId}`,
    idempotencyKey: `qa-preview:${params.uid}:${params.type}:${params.qaRequestId}`,
  };
  assertValidDispatchRequest(request);
  return request;
}
