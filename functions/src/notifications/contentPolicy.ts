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
  'RE_ENGAGEMENT_EARLY',
  'RE_ENGAGEMENT_LATE',
  'PHOTO_REMINDER',
  'ASSESSMENT_REMINDER',
  'COMPARE_PROGRESS',
  'WEEK_COMPLETED',
  'WEEK_STREAK',
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

export const SUPPORT_SINGLE_REPLY_COPY: NotificationCopy = {
  title: 'Resposta do suporte AJ Fit',
  body: 'Sua solicitação foi respondida. Abra o app para visualizar.',
};

export const SUPPORT_CHAT_MESSAGE_COPY: NotificationCopy = {
  title: 'Nova mensagem do suporte AJ Fit',
  body: 'Você recebeu uma nova mensagem. Abra o app para visualizar.',
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

export const RE_ENGAGEMENT_EARLY_COPIES = {
  'pt-BR': {
    title: 'Sentimos sua falta 👋',
    body: 'Seu próximo treino continua te esperando. Volte ao plano quando estiver pronto.',
  },
  en: {
    title: 'We miss you 👋',
    body: 'Your next workout is still waiting. Return to your plan when you’re ready.',
  },
  es: {
    title: 'Te extrañamos 👋',
    body: 'Tu próximo entrenamiento sigue esperándote. Retoma tu plan cuando estés listo.',
  },
} as const satisfies Readonly<Record<NotificationLocale, NotificationCopy>>;

export const RE_ENGAGEMENT_LATE_COPIES = {
  'pt-BR': {
    title: 'Hora de voltar 💪',
    body: 'Retome seu plano no seu ritmo. Um treino de cada vez já faz diferença.',
  },
  en: {
    title: 'Time to come back 💪',
    body: 'Return to your plan at your own pace. One workout at a time makes a difference.',
  },
  es: {
    title: 'Hora de volver 💪',
    body: 'Retoma tu plan a tu ritmo. Un entrenamiento a la vez ya marca la diferencia.',
  },
} as const satisfies Readonly<Record<NotificationLocale, NotificationCopy>>;

export const PHOTO_REMINDER_COPIES = {
  'pt-BR': {
    title: 'Hora de registrar sua evolução 📸',
    body: 'Atualize suas fotos de progresso para acompanhar sua jornada.',
  },
  en: {
    title: 'Time to record your progress 📸',
    body: 'Update your progress photos to keep track of your journey.',
  },
  es: {
    title: 'Hora de registrar tu evolución 📸',
    body: 'Actualiza tus fotos de progreso para seguir tu recorrido.',
  },
} as const satisfies Readonly<Record<NotificationLocale, NotificationCopy>>;

export const ASSESSMENT_REMINDER_COPIES = {
  'pt-BR': {
    title: 'Hora de atualizar sua avaliação 📊',
    body: 'Registre uma nova avaliação para manter seu acompanhamento atualizado.',
  },
  en: {
    title: 'Time to update your assessment 📊',
    body: 'Record a new assessment to keep your progress tracking up to date.',
  },
  es: {
    title: 'Hora de actualizar tu evaluación 📊',
    body: 'Registra una nueva evaluación para mantener actualizado tu seguimiento.',
  },
} as const satisfies Readonly<Record<NotificationLocale, NotificationCopy>>;

export const COMPARE_PROGRESS_COPIES = {
  'pt-BR': {
    title: 'Compare sua evolução ✨',
    body: 'Seus registros já permitem uma comparação. Veja sua evolução lado a lado.',
  },
  en: {
    title: 'Compare your progress ✨',
    body: 'Your records are ready to compare. See your progress side by side.',
  },
  es: {
    title: 'Compara tu evolución ✨',
    body: 'Tus registros ya permiten una comparación. Mira tu evolución lado a lado.',
  },
} as const satisfies Readonly<Record<NotificationLocale, NotificationCopy>>;

export const WEEK_COMPLETED_COPIES = {
  'pt-BR': {
    title: 'Semana concluída 🏆',
    body: 'Você completou todos os treinos planejados para esta semana. Excelente trabalho!',
  },
  en: {
    title: 'Week completed 🏆',
    body: 'You completed every workout planned for this week. Excellent work!',
  },
  es: {
    title: 'Semana completada 🏆',
    body: 'Completaste todos los entrenamientos planificados para esta semana. ¡Excelente trabajo!',
  },
} as const satisfies Readonly<Record<NotificationLocale, NotificationCopy>>;

const STREAK_MILESTONES = [2, 4, 8, 12, 24, 52] as const;
export type WeekStreakMilestone = (typeof STREAK_MILESTONES)[number];

export function isWeekStreakMilestone(value: number): value is WeekStreakMilestone {
  return (STREAK_MILESTONES as readonly number[]).includes(value);
}

export function weekStreakCopy(
  locale: NotificationLocale,
  weeks: WeekStreakMilestone,
): NotificationCopy {
  switch (locale) {
    case 'en': return {
      title: `${weeks} weeks in a row 🔥`,
      body: `You completed every planned workout for ${weeks} consecutive weeks. Keep it going!`,
    };
    case 'es': return {
      title: `${weeks} semanas seguidas 🔥`,
      body: `Completaste todos los entrenamientos planificados durante ${weeks} semanas consecutivas. ¡Sigue así!`,
    };
    default: return {
      title: `${weeks} semanas seguidas 🔥`,
      body: `Você completou todos os treinos planejados por ${weeks} semanas consecutivas. Continue assim!`,
    };
  }
}

function copies<T extends Record<NotificationLocale, NotificationCopy>>(localized: T) {
  return NOTIFICATION_LOCALES.map((locale) => localized[locale]);
}

const TYPE_POLICIES: Readonly<Record<NotificationType, TypePolicy>> = {
  CAMPAIGN: {
    category: 'WORKOUTS_AND_REMINDERS',
    allowedDataKeys: ['campaignId', 'campaignRunId', 'destination', 'recipientUid'],
    allowedIntents: ['campaign'],
    allowedCopies: [],
  },
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
  RE_ENGAGEMENT_EARLY: {
    category: 'WORKOUTS_AND_REMINDERS',
    allowedDataKeys: [],
    allowedIntents: [],
    allowedCopies: copies(RE_ENGAGEMENT_EARLY_COPIES),
  },
  RE_ENGAGEMENT_LATE: {
    category: 'WORKOUTS_AND_REMINDERS',
    allowedDataKeys: [],
    allowedIntents: [],
    allowedCopies: copies(RE_ENGAGEMENT_LATE_COPIES),
  },
  PHOTO_REMINDER: {
    category: 'PROGRESS',
    allowedDataKeys: [],
    allowedIntents: [],
    allowedCopies: copies(PHOTO_REMINDER_COPIES),
  },
  ASSESSMENT_REMINDER: {
    category: 'PROGRESS',
    allowedDataKeys: [],
    allowedIntents: [],
    allowedCopies: copies(ASSESSMENT_REMINDER_COPIES),
  },
  COMPARE_PROGRESS: {
    category: 'PROGRESS',
    allowedDataKeys: [],
    allowedIntents: [],
    allowedCopies: copies(COMPARE_PROGRESS_COPIES),
  },
  WEEK_COMPLETED: {
    category: 'EVOLUTION_AND_ACHIEVEMENTS',
    allowedDataKeys: [],
    allowedIntents: [],
    allowedCopies: copies(WEEK_COMPLETED_COPIES),
  },
  WEEK_STREAK: {
    category: 'EVOLUTION_AND_ACHIEVEMENTS',
    allowedDataKeys: [],
    allowedIntents: [],
    allowedCopies: NOTIFICATION_LOCALES.flatMap((locale) =>
      STREAK_MILESTONES.map((milestone) => weekStreakCopy(locale, milestone))),
  },
  SUPPORT_SINGLE_REPLY: {
    category: 'OPERATIONAL',
    allowedDataKeys: ['caseId', 'messageId'],
    allowedIntents: ['support-case'],
    allowedCopies: [SUPPORT_SINGLE_REPLY_COPY],
  },
  SUPPORT_CHAT_MESSAGE: {
    category: 'OPERATIONAL',
    allowedDataKeys: ['caseId', 'messageId'],
    allowedIntents: ['support-case'],
    allowedCopies: [SUPPORT_CHAT_MESSAGE_COPY],
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
  if (request.type !== 'CAMPAIGN' && !policy.allowedCopies.some(
    (copy) => copy.title === request.title && copy.body === request.body,
  )) {
    fail('copy_not_allowed');
  }

  if (request.intent !== undefined && !policy.allowedIntents.includes(request.intent)) {
    fail('intent_not_allowed');
  }
  assertAllowedData(request.data, policy.allowedDataKeys);
  if (request.type === 'CAMPAIGN') {
    if (request.intent !== 'campaign' || !request.data
      || !['home', 'workout', 'progress', 'profile'].includes(String(request.data.destination))
      || typeof request.data.campaignId !== 'string'
      || typeof request.data.campaignRunId !== 'string'
      || (request.data.recipientUid !== undefined && request.data.recipientUid !== request.uid)) fail('campaign_payload_invalid');
    assertSafeId(request.data.campaignId, 'campaignId');
    assertSafeId(request.data.campaignRunId, 'campaignRunId');
    if (request.imageUrl !== undefined && (!/^https:\/\//.test(request.imageUrl) || request.imageUrl.length > 500)) fail('image_url_invalid');
  } else if (request.imageUrl !== undefined) fail('image_not_allowed');
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
  type:
    | 'WORKOUT_DAY'
    | 'RECOVERY_DAY'
    | 'MISSED_WORKOUT'
    | 'RE_ENGAGEMENT_EARLY'
    | 'RE_ENGAGEMENT_LATE';
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
  type:
    | 'WORKOUT_DAY'
    | 'RECOVERY_DAY'
    | 'MISSED_WORKOUT'
    | 'RE_ENGAGEMENT_EARLY'
    | 'RE_ENGAGEMENT_LATE';
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

function buildReEngagementNotification(params: {
  uid: string;
  type: 'RE_ENGAGEMENT_EARLY' | 'RE_ENGAGEMENT_LATE';
  episodeIdentity: string;
  locale: NotificationLocale;
}): NotificationDispatchRequest {
  assertSafeId(params.episodeIdentity, 'episodeIdentity');
  return buildDailyWorkoutNotification({
    uid: params.uid,
    type: params.type,
    sourceIdentity: params.episodeIdentity,
    copy: params.type === 'RE_ENGAGEMENT_EARLY'
      ? RE_ENGAGEMENT_EARLY_COPIES[params.locale]
      : RE_ENGAGEMENT_LATE_COPIES[params.locale],
  });
}

export function buildReEngagementEarlyNotification(params: {
  uid: string;
  episodeIdentity: string;
  locale: NotificationLocale;
}): NotificationDispatchRequest {
  return buildReEngagementNotification({ ...params, type: 'RE_ENGAGEMENT_EARLY' });
}

export function buildReEngagementLateNotification(params: {
  uid: string;
  episodeIdentity: string;
  locale: NotificationLocale;
}): NotificationDispatchRequest {
  return buildReEngagementNotification({ ...params, type: 'RE_ENGAGEMENT_LATE' });
}

function buildProgressNotification(params: {
  uid: string;
  type: 'PHOTO_REMINDER' | 'ASSESSMENT_REMINDER' | 'COMPARE_PROGRESS';
  progressIdentity: string;
  copy: NotificationCopy;
}): NotificationDispatchRequest {
  assertSafeId(params.progressIdentity, 'progressIdentity');
  const sourceHash = createHash('sha256').update(params.progressIdentity, 'utf8').digest('hex');
  const request: NotificationDispatchRequest = {
    uid: params.uid,
    type: params.type,
    category: 'PROGRESS',
    notificationId: `${params.type}:${sourceHash}`,
    sourceIdentity: `progressSnapshot:${sourceHash}`,
    idempotencyKey: `notification:${params.uid}:${params.type}:${sourceHash}`,
    ...params.copy,
    data: {},
  };
  assertValidDispatchRequest(request);
  return request;
}

export function buildPhotoReminderNotification(params: {
  uid: string;
  progressIdentity: string;
  locale: NotificationLocale;
}): NotificationDispatchRequest {
  return buildProgressNotification({
    ...params,
    type: 'PHOTO_REMINDER',
    copy: PHOTO_REMINDER_COPIES[params.locale],
  });
}

export function buildAssessmentReminderNotification(params: {
  uid: string;
  progressIdentity: string;
  locale: NotificationLocale;
}): NotificationDispatchRequest {
  return buildProgressNotification({
    ...params,
    type: 'ASSESSMENT_REMINDER',
    copy: ASSESSMENT_REMINDER_COPIES[params.locale],
  });
}

export function buildCompareProgressNotification(params: {
  uid: string;
  progressIdentity: string;
  locale: NotificationLocale;
}): NotificationDispatchRequest {
  return buildProgressNotification({
    ...params,
    type: 'COMPARE_PROGRESS',
    copy: COMPARE_PROGRESS_COPIES[params.locale],
  });
}

function buildWeeklyAchievementNotification(params: {
  uid: string;
  type: 'WEEK_COMPLETED' | 'WEEK_STREAK';
  achievementIdentity: string;
  copy: NotificationCopy;
}): NotificationDispatchRequest {
  assertSafeId(params.achievementIdentity, 'achievementIdentity');
  const sourceHash = createHash('sha256').update(params.achievementIdentity, 'utf8').digest('hex');
  const request: NotificationDispatchRequest = {
    uid: params.uid,
    type: params.type,
    category: 'EVOLUTION_AND_ACHIEVEMENTS',
    notificationId: `${params.type}:${sourceHash}`,
    sourceIdentity: `perfectWeek:${sourceHash}`,
    idempotencyKey: `notification:${params.uid}:${params.type}:${sourceHash}`,
    ...params.copy,
    data: {},
  };
  assertValidDispatchRequest(request);
  return request;
}

export function buildWeekCompletedNotification(params: {
  uid: string;
  achievementIdentity: string;
  locale: NotificationLocale;
}): NotificationDispatchRequest {
  return buildWeeklyAchievementNotification({
    ...params,
    type: 'WEEK_COMPLETED',
    copy: WEEK_COMPLETED_COPIES[params.locale],
  });
}

export function buildWeekStreakNotification(params: {
  uid: string;
  achievementIdentity: string;
  locale: NotificationLocale;
  weeks: WeekStreakMilestone;
}): NotificationDispatchRequest {
  if (!isWeekStreakMilestone(params.weeks)) {
    throw new NotificationContentPolicyError('week_streak_milestone_not_allowed');
  }
  return buildWeeklyAchievementNotification({
    ...params,
    type: 'WEEK_STREAK',
    copy: weekStreakCopy(params.locale, params.weeks),
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
    case 'RE_ENGAGEMENT_EARLY':
      canonical = buildReEngagementEarlyNotification({
        uid: params.uid, episodeIdentity: fixtureIdentity, locale: params.locale,
      });
      break;
    case 'RE_ENGAGEMENT_LATE':
      canonical = buildReEngagementLateNotification({
        uid: params.uid, episodeIdentity: fixtureIdentity, locale: params.locale,
      });
      break;
    case 'PHOTO_REMINDER':
      canonical = buildPhotoReminderNotification({
        uid: params.uid, progressIdentity: fixtureIdentity, locale: params.locale,
      });
      break;
    case 'ASSESSMENT_REMINDER':
      canonical = buildAssessmentReminderNotification({
        uid: params.uid, progressIdentity: fixtureIdentity, locale: params.locale,
      });
      break;
    case 'COMPARE_PROGRESS':
      canonical = buildCompareProgressNotification({
        uid: params.uid, progressIdentity: fixtureIdentity, locale: params.locale,
      });
      break;
    case 'WEEK_COMPLETED':
      canonical = buildWeekCompletedNotification({
        uid: params.uid, achievementIdentity: fixtureIdentity, locale: params.locale,
      });
      break;
    case 'WEEK_STREAK':
      canonical = buildWeekStreakNotification({
        uid: params.uid, achievementIdentity: fixtureIdentity, locale: params.locale, weeks: 4,
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
