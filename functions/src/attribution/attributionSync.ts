import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../lib/firebaseAdmin';
import { logFunctionError, logInfo, logWarn } from '../lib/logger';
import {
  ATTRIBUTION_FIELD,
  couponRedemptionDocPath,
  userDocPath,
} from './constants';
import {
  correlateAppleOffer,
  type AppleOfferCorrelationResult,
} from './appleOfferCorrelation';
import {
  correlateGooglePlayOffer,
  parseGooglePlayProductId,
  type GooglePlayOfferCorrelationResult,
} from './googlePlayOfferCorrelation';
import type {
  AppleOfferCorrelationConfig,
  IOSPromotionConfig,
  PromoCodeAndroidOfferSnapshot,
  PromoCodeAppleCorrelationSnapshot,
  PromoCodeAppleOfferSnapshot,
} from './types';
import {
  isPromoPurchaseIntentActiveAt,
  parseStoredPromoPurchaseIntent,
} from './promoPurchaseIntent';

/**
 * Firestore-facing half of the promo-code module: apply or swap a uid's
 * pending attribution as a single atomic transaction. Mirrors the shape of
 * `billing/subscriptionSync.ts`'s `applySubscriptionEventAtomically` +
 * `decideSubscriptionEventOutcome` split — a pure decision function with
 * zero Firestore dependency (unit-testable without an emulator), wrapped by
 * a thin transaction that reads, decides, and writes atomically.
 *
 * Two Firestore documents are written together in the SAME transaction:
 * `couponRedemptions/{uid}` (source of truth) and `users/{uid}.attribution`
 * (read-optimized mirror). Firestore transactions are atomic across
 * multiple documents, so a reader can never observe one updated without the
 * other, and two concurrent calls for the same uid can never leave the two
 * pointing at different codes — Firestore serializes conflicting
 * transactions on the same documents and retries the loser.
 */

const SCOPE = 'attribution:attributionSync';

export interface PendingPromoCodeAttribution {
  couponCode: string;
  campaignId: string;
  influencerId: string;
  /**
   * FASE 4C.3A — the Android offer pair(s) authorized for this code AT THIS
   * MOMENT (already resolved fail-closed by `promoCodeCatalog.ts`'s
   * `resolveAndroidOfferPair` — see `validatePromoCode.ts`). Snapshotted
   * verbatim into `couponRedemptions/{uid}.androidOffer` — see that field's
   * doc comment in `types.ts` for why this must never be re-derived later
   * from the live catalog.
   */
  androidOffer: PromoCodeAndroidOfferSnapshot;
  /**
   * FASE iOS-1 — the Apple offer-code config authorized for this code AT
   * THIS MOMENT, computed unconditionally by `validatePromoCode.ts` exactly
   * like `androidOffer` (regardless of the client's requested `platform`).
   * Snapshotted verbatim into `couponRedemptions/{uid}.appleOffer` — see
   * that field's doc comment in `types.ts`.
   */
  appleOffer: PromoCodeAppleOfferSnapshot;
  /**
   * FASE iOS-6 — the Apple correlation config authorized for this code AT
   * THIS MOMENT, computed unconditionally by `validatePromoCode.ts` exactly
   * like `androidOffer`/`appleOffer` (regardless of the client's requested
   * `platform`). Snapshotted verbatim into
   * `couponRedemptions/{uid}.appleOfferCorrelation` — see that field's doc
   * comment in `types.ts`. This, not `appleOffer`, is what
   * `correlateAppleOffer` compares a real webhook event against.
   */
  appleOfferCorrelation: PromoCodeAppleCorrelationSnapshot;
  /**
   * FASE 1 — the iOS promotional (Offering/SKU) config authorized for this
   * code AT THIS MOMENT, computed unconditionally by `validatePromoCode.ts`
   * exactly like `androidOffer`/`appleOffer`/`appleOfferCorrelation`.
   * Snapshotted verbatim into `couponRedemptions/{uid}.iosPromotion` — see
   * that field's doc comment in `types.ts`. Never written to
   * `users/{uid}.attribution` (the display-only mirror) — same exclusion as
   * every other snapshot field, docs §33 rule 6.
   */
  iosPromotion: IOSPromotionConfig | null;
}

/** What `decidePromoCodeAttributionOutcome` needs to know about the currently-stored redemption record — nothing Firestore-specific. */
export interface CurrentAttributionState {
  /** `null`/`undefined` = not locked yet, i.e. still swappable. Any other value = locked. */
  lockedAt: unknown;
  /** Active or malformed nested intents block replacement of the attribution snapshot. */
  hasBlockingPurchaseIntent?: boolean;
}

export type PromoCodeAttributionDecision =
  | { action: 'apply' }
  | { action: 'locked' }
  | { action: 'purchase_intent_active' };

/**
 * Pure decision function — zero Firestore dependency. `current` is
 * `undefined` when this is the uid's first-ever promo code application (no
 * `couponRedemptions/{uid}` document yet). A locked attribution can never be
 * replaced, regardless of whether the incoming code is the same one or a
 * different one — docs §8: once the store confirms trial/subscription
 * start, "atribuição comercial definitiva" applies and this app never
 * revisits it (the "unlock" itself is out of scope for this phase — no code
 * anywhere sets `lockedAt` to a non-null value yet).
 */
export function decidePromoCodeAttributionOutcome(
  current: CurrentAttributionState | undefined,
): PromoCodeAttributionDecision {
  if (current && current.lockedAt !== null && current.lockedAt !== undefined) {
    return { action: 'locked' };
  }
  if (current?.hasBlockingPurchaseIntent) return { action: 'purchase_intent_active' };
  return { action: 'apply' };
}

export type ApplyPromoCodeAttributionResult =
  | { status: 'applied' }
  | { status: 'locked' }
  | { status: 'purchase_intent_active' }
  | { status: 'user_not_found' };

/**
 * THE official write path for applying/swapping a uid's pending promo-code
 * attribution. Single Firestore transaction:
 *
 * 1. Reads `users/{uid}` (existence guard — mirrors
 *    `billing/subscriptionSync.ts`'s `validFirebaseUserExists` precondition,
 *    re-checked inside the transaction so a delete racing this call can
 *    never leave a dangling `couponRedemptions/{uid}` for a user that no
 *    longer exists) and `couponRedemptions/{uid}` (current attribution
 *    state, if any).
 * 2. Decides via `decidePromoCodeAttributionOutcome` (pure, see above).
 * 3. On `apply`, writes BOTH `couponRedemptions/{uid}` (full overwrite —
 *    this is a lifecycle record, not an event log, so swapping the code
 *    replaces `couponCode`/`campaignId`/`influencerId`/`androidOffer`/
 *    `appliedAt` while preserving `createdAt` from the first-ever
 *    application) and `users/{uid}.attribution` (merge into the nested map
 *    field, same pattern `subscriptionSync.ts` uses for `subscription` —
 *    deliberately WITHOUT `androidOffer`, docs §33/Fase 4C.3A rule 6: the
 *    mirror stays a display-only snapshot, never a correlation source) in
 *    the SAME transaction — see this file's top doc comment for why that
 *    matters under concurrency.
 *
 * `trialStartedAt`/`convertedAt`/`lockedAt` are always written as `null`
 * here — this function never confirms a trial/conversion/lock itself
 * (that's `applyAttributionRevenueCatEvent`, below).
 */
export async function applyPromoCodeAttributionTransactionally(
  uid: string,
  attribution: PendingPromoCodeAttribution,
): Promise<ApplyPromoCodeAttributionResult> {
  const userRef = db.doc(userDocPath(uid));
  const redemptionRef = db.doc(couponRedemptionDocPath(uid));

  try {
    return await db.runTransaction(async (transaction) => {
      const [userSnapshot, redemptionSnapshot] = await Promise.all([
        transaction.get(userRef),
        transaction.get(redemptionRef),
      ]);

      if (!userSnapshot.exists) {
        return { status: 'user_not_found' };
      }

      const existing = redemptionSnapshot.exists
        ? (redemptionSnapshot.data() as Record<string, unknown> | undefined)
        : undefined;

      let hasBlockingPurchaseIntent = false;
      if (existing && Object.prototype.hasOwnProperty.call(existing, 'purchaseIntent')) {
        const intent = parseStoredPromoPurchaseIntent(existing.purchaseIntent);
        // A malformed server-owned intent is never erased by a coupon swap.
        hasBlockingPurchaseIntent =
          intent === null || isPromoPurchaseIntentActiveAt(intent, Timestamp.now());
      }

      const decision = decidePromoCodeAttributionOutcome(
        existing
          ? { lockedAt: existing.lockedAt, hasBlockingPurchaseIntent }
          : undefined,
      );

      if (decision.action === 'locked') {
        return { status: 'locked' };
      }
      if (decision.action === 'purchase_intent_active') {
        return { status: 'purchase_intent_active' };
      }

      const now = FieldValue.serverTimestamp();
      const createdAt = existing?.createdAt ?? now;

      transaction.set(redemptionRef, {
        uid,
        couponCode: attribution.couponCode,
        campaignId: attribution.campaignId,
        influencerId: attribution.influencerId,
        androidOffer: attribution.androidOffer,
        appleOffer: attribution.appleOffer,
        appleOfferCorrelation: attribution.appleOfferCorrelation,
        iosPromotion: attribution.iosPromotion,
        appliedAt: now,
        createdAt,
        updatedAt: now,
        trialStartedAt: null,
        convertedAt: null,
        lockedAt: null,
      });

      transaction.set(
        userRef,
        {
          [ATTRIBUTION_FIELD]: {
            couponCode: attribution.couponCode,
            campaignId: attribution.campaignId,
            influencerId: attribution.influencerId,
            appliedAt: now,
          },
        },
        { merge: true },
      );

      return { status: 'applied' };
    });
  } catch (err) {
    logFunctionError(SCOPE, err, { uid });
    throw err;
  }
}

/**
 * FASE 4B — confirmação de atribuição a partir de um evento RevenueCat já
 * validado pelo webhook (docs/13 §8/§34). Chamada por `billing/revenuecat.ts`.
 *
 * FASE 4B.1 (correção de robustez): billing e attribution são dois
 * consumidores INDEPENDENTES do mesmo evento RevenueCat, cada um com sua
 * própria idempotência. `billing/revenuecat.ts` agora chama esta função
 * para os resultados `processed`, `duplicate` E `stale` de
 * `applySubscriptionEventAtomically` — não mais só `processed` — porque o
 * resultado de deduplicação do billing não pode, sozinho, decidir se a
 * attribution precisa ou não processar o evento (ver o relatório da Fase
 * 4B.1 para o cenário de falha que isso corrige: billing processa com
 * sucesso, attribution falha transitoriamente, o retry do RevenueCat chega
 * como `duplicate` no billing — sem essa mudança, a attribution nunca
 * teria uma segunda chance).
 *
 * Essa mudança só é segura porque os três campos de
 * `couponRedemptions/{uid}` que esta função escreve
 * (`lockedAt`/`trialStartedAt`/`convertedAt`) são "trincos" de mão única —
 * só vão de `null` para um valor real, uma única vez, relidos de dentro da
 * própria transação a cada chamada. Chamar esta função múltiplas vezes para
 * o mesmo estado real (retries, ou uma entrega `stale` do lado do billing
 * que ainda assim é a única evidência que a attribution já viu daquele
 * INITIAL_PURCHASE) nunca sobrescreve um timestamp já confirmado — ver
 * `decideInitialPurchaseAttributionConfirmation`/`decideRenewalAttributionConfirmation`.
 *
 * `users/{uid}` e `users/{uid}.subscription` NUNCA são lidos ou escritos
 * aqui — este módulo só toca `couponRedemptions/{uid}`. `SubscriptionMirror`
 * permanece inteiramente responsabilidade de `subscriptionSync.ts`.
 */

const CONFIRMATION_SCOPE = 'attribution:revenueCatConfirmation';

function isAttributionFieldSet(value: unknown): boolean {
  return value !== null && value !== undefined;
}

/**
 * `period_type` real e documentado pelo RevenueCat (webhook docs,
 * event-types-and-fields — auditado nesta tarefa, Fase 4B):
 * `TRIAL`, `INTRO`, `NORMAL`, `PROMOTIONAL`, `PREPAID`.
 *
 * `PROMOTIONAL` é um entitlement concedido manualmente pelo painel do
 * RevenueCat — NÃO é uma cobrança real da loja. Não é trial, mas também não
 * pode ser tratado como conversão paga. `INTRO`/`PREPAID` envolvem cobrança
 * real (com desconto ou pré-paga) — mesmo grupo de `NORMAL` para efeito de
 * "este uid efetivamente pagou".
 */
export type InitialPurchasePeriodClassification = 'trial' | 'paid' | 'unclassified';

const PAID_INITIAL_PURCHASE_PERIOD_TYPES = new Set(['NORMAL', 'INTRO', 'PREPAID']);

/**
 * Pura. `PROMOTIONAL`, ausente, ou qualquer valor futuro não documentado
 * caem deliberadamente em `unclassified` em vez de adivinhados — ver o
 * comentário desta função.
 */
export function classifyInitialPurchasePeriodType(
  periodType: string | undefined,
): InitialPurchasePeriodClassification {
  if (periodType === 'TRIAL') return 'trial';
  if (periodType !== undefined && PAID_INITIAL_PURCHASE_PERIOD_TYPES.has(periodType)) return 'paid';
  return 'unclassified';
}

/** O que as funções de decisão de confirmação precisam saber do registro atualmente armazenado — nada específico de Firestore. */
export interface StoredAttributionConfirmationState {
  trialStartedAt: unknown;
  convertedAt: unknown;
  lockedAt: unknown;
}

export type InitialPurchaseConfirmationDecision =
  | { action: 'confirm'; setTrialStartedAt: boolean; setConvertedAt: boolean }
  | { action: 'skip_locked' }
  | { action: 'skip_no_redemption' }
  | { action: 'skip_offer_not_matched' };

/**
 * FASE iOS-1 — the shape `decideInitialPurchaseAttributionConfirmation`
 * actually needs from EITHER store's correlation result: only whether it is
 * `matched` (with which plan) or anything else. Both
 * `GooglePlayOfferCorrelationResult` and `AppleOfferCorrelationResult`
 * satisfy this structurally — `AppleOfferCorrelationResult`'s extra
 * `unsupported` variant is treated identically to `not_matched` here (never
 * confirms), the distinction between the two existing only for
 * logging/observability at the call site.
 */
export type OfferCorrelationInput =
  | { status: 'matched'; plan: 'monthly' | 'annual' }
  | { status: 'not_matched' }
  | { status: 'unsupported' };

/**
 * Pura — regra 1 da Fase 4B, **revisada pela Fase 4C.3A**.
 *
 * FASE 4C.3A (correção de bug de correlação — ver o relatório da auditoria
 * bloqueadora da Fase 4C.3): antes desta mudança, `lockedAt` era preenchido
 * em TODO INITIAL_PURCHASE Premium com uma redemption pendente,
 * independentemente de a compra ter realmente usado a oferta promocional
 * autorizada — isso permitia que uma compra NORMAL (sem oferta) confirmasse
 * e travasse uma atribuição pendente, gerando comissão falsa.
 *
 * Agora `offerCorrelation` (calculado por `googlePlayOfferCorrelation.ts`
 * a partir de `product_id`/`offer_code` do evento real e do snapshot
 * `androidOffer` gravado na redemption) precisa ser `'matched'` para
 * QUALQUER confirmação acontecer — incluindo `lockedAt`. Uma correlação
 * `'not_matched'` (compra normal, oferta errada, plano errado, ou
 * `androidOffer` ausente/legado) resulta em `skip_offer_not_matched`: a
 * compra/Premium seguem seu curso normal (responsabilidade exclusiva de
 * `subscriptionSync.ts`), mas a redemption pendente permanece exatamente
 * como estava — nunca travada, nunca convertida.
 *
 * `couponCode`/`campaignId`/`influencerId`/`androidOffer` nunca são
 * tocados aqui — nunca alterados nesta etapa, conforme exigido.
 */
export function decideInitialPurchaseAttributionConfirmation(
  current: StoredAttributionConfirmationState | undefined,
  classification: InitialPurchasePeriodClassification,
  offerCorrelation: OfferCorrelationInput,
): InitialPurchaseConfirmationDecision {
  if (!current) return { action: 'skip_no_redemption' };
  if (isAttributionFieldSet(current.lockedAt)) return { action: 'skip_locked' };
  if (offerCorrelation.status !== 'matched') return { action: 'skip_offer_not_matched' };
  return {
    action: 'confirm',
    setTrialStartedAt: classification === 'trial',
    setConvertedAt: classification === 'paid',
  };
}

export type RenewalConfirmationDecision =
  | { action: 'confirm_conversion' }
  | { action: 'skip_no_redemption' }
  | { action: 'skip_not_trial_started' }
  | { action: 'skip_already_converted' }
  | { action: 'skip_not_paid_renewal' };

/**
 * Pura — regra 2 da Fase 4B. `isTrialConversion` DEVE vir do campo próprio
 * do RevenueCat `is_trial_conversion` (exclusivo de RENEWAL, confirmado
 * contra a documentação oficial do webhook nesta tarefa) — nunca inferido
 * de `period_type`, que não carrega esse significado específico em RENEWAL.
 */
export function decideRenewalAttributionConfirmation(
  current: StoredAttributionConfirmationState | undefined,
  isTrialConversion: boolean,
): RenewalConfirmationDecision {
  if (!current) return { action: 'skip_no_redemption' };
  if (!isAttributionFieldSet(current.trialStartedAt)) return { action: 'skip_not_trial_started' };
  if (isAttributionFieldSet(current.convertedAt)) return { action: 'skip_already_converted' };
  if (!isTrialConversion) return { action: 'skip_not_paid_renewal' };
  return { action: 'confirm_conversion' };
}

export type AttributionConfirmationInput =
  | {
      eventType: 'INITIAL_PURCHASE';
      eventTimestampMs: number;
      periodType: string | undefined;
      /**
       * FASE 4C.3A. Raw `event.store` — correlation is only ever attempted
       * for `'PLAY_STORE'`; any other value (iOS, or an unrecognized future
       * store) fails closed with `skip_offer_not_matched`, since no
       * Apple-side correlation is implemented yet (see this file's report,
       * rule 19).
       */
      store: string | undefined;
      /** Raw `event.product_id` — parsed by `parseGooglePlayProductId` (`googlePlayOfferCorrelation.ts`). */
      productId: string | undefined;
      /** Raw `event.offer_code` — read by `extractGooglePlayOfferCode`. `undefined` when the field itself is absent (same effect as `null`: no proof of an offer). */
      offerCode: string | null | undefined;
    }
  | { eventType: 'RENEWAL'; eventTimestampMs: number; isTrialConversion: boolean };

/**
 * Every one of these is a NORMAL, expected outcome — never represented as a
 * thrown exception (Fase 4B.1 principle: redemption inexistente, já
 * confirmada, ou evento não aplicável são resultados do domínio, não
 * falhas). Only a genuine infrastructure/transaction failure throws — see
 * `applyAttributionRevenueCatEvent`'s `catch` block.
 */
export type AttributionConfirmationSkipReason =
  | 'no_redemption'
  | 'locked'
  | 'not_trial_started'
  | 'already_converted'
  | 'not_paid_renewal'
  /** FASE 4C.3A — the store/offer correlation required for INITIAL_PURCHASE did not prove this purchase used the authorized promotional offer. */
  | 'offer_not_matched';

export type AttributionConfirmationResult =
  | { status: 'confirmed' }
  | { status: 'skipped'; reason: AttributionConfirmationSkipReason };

function parseAndroidOfferPair(value: unknown): { basePlanId: string; offerId: string } | null {
  if (value === null || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.basePlanId !== 'string' || typeof v.offerId !== 'string') return null;
  return { basePlanId: v.basePlanId, offerId: v.offerId };
}

/**
 * FASE 4C.3A — defensive read of `couponRedemptions/{uid}.androidOffer`.
 * Returns `null` for anything that isn't the exact `{monthly, annual}`
 * shape — including the field being entirely absent, which is exactly the
 * case for every `couponRedemptions` document created before this task
 * (docs §20, "schema legado"): a legacy record is NEVER silently
 * reconstructed from the current `promoCodes` catalog, it simply cannot be
 * correlated, and `correlateGooglePlayOffer` already treats a `null`
 * snapshot as `not_matched` by construction.
 */
export function parseStoredAndroidOfferSnapshot(value: unknown): PromoCodeAndroidOfferSnapshot | null {
  if (value === null || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  return {
    monthly: parseAndroidOfferPair(v.monthly),
    annual: parseAndroidOfferPair(v.annual),
  };
}

function parseNullableAppleOfferCode(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * FASE iOS-1 — defensive read of `couponRedemptions/{uid}.appleOffer`,
 * mirroring `parseStoredAndroidOfferSnapshot`'s policy: anything that isn't
 * the exact `{offerCodeMonthly, offerCodeAnnual}` shape — including the
 * field being entirely absent (every `couponRedemptions` document created
 * before FASE iOS-1) — resolves each plan's code to `null` rather than being
 * silently reconstructed from the live `promoCodes` catalog.
 */
export function parseStoredAppleOfferSnapshot(value: unknown): PromoCodeAppleOfferSnapshot | null {
  if (value === null || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  return {
    offerCodeMonthly: parseNullableAppleOfferCode(v.offerCodeMonthly),
    offerCodeAnnual: parseNullableAppleOfferCode(v.offerCodeAnnual),
  };
}

function parseAppleOfferCorrelationConfig(value: unknown): AppleOfferCorrelationConfig | null {
  if (value === null || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.productId !== 'string' || typeof v.offerReference !== 'string') return null;
  return { productId: v.productId, offerReference: v.offerReference };
}

/**
 * FASE iOS-6 — defensive read of `couponRedemptions/{uid}.appleOfferCorrelation`,
 * mirroring `parseStoredAndroidOfferSnapshot`'s policy: anything that isn't
 * the exact `{monthly, annual}` shape — including the field being entirely
 * absent (every `couponRedemptions` document created before FASE iOS-6) —
 * resolves each plan's config to `null` rather than being silently
 * reconstructed from the live `promoCodes` catalog. `correlateAppleOffer`
 * treats a `null` snapshot for either plan as unable to match that plan —
 * never a guess.
 */
export function parseStoredAppleOfferCorrelationSnapshot(
  value: unknown,
): PromoCodeAppleCorrelationSnapshot | null {
  if (value === null || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  return {
    monthly: parseAppleOfferCorrelationConfig(v.monthly),
    annual: parseAppleOfferCorrelationConfig(v.annual),
  };
}

function mapInitialPurchaseSkipReason(
  action: Exclude<InitialPurchaseConfirmationDecision['action'], 'confirm'>,
): AttributionConfirmationSkipReason {
  switch (action) {
    case 'skip_locked':
      return 'locked';
    case 'skip_no_redemption':
      return 'no_redemption';
    case 'skip_offer_not_matched':
      return 'offer_not_matched';
  }
}

/**
 * THE caminho oficial de escrita para confirmar uma atribuição de
 * promo-code a partir de um evento RevenueCat (Fase 4B, correlação
 * revisada pela Fase 4C.3A). Transação Firestore única — relê
 * `couponRedemptions/{uid}` de dentro da transação (nunca confia numa
 * leitura pré-transação), decide via as funções puras acima, e só escreve
 * quando a decisão é `confirm`/`confirm_conversion`.
 *
 * FASE 4C.3A: para `INITIAL_PURCHASE`, antes de decidir, computa a
 * correlação Google Play (`googlePlayOfferCorrelation.ts`) a partir de
 * `input.store`/`input.productId`/`input.offerCode` (o evento real) contra
 * `stored.androidOffer` (o snapshot gravado na aplicação do código — nunca
 * o catálogo `promoCodes` ao vivo, docs regra 4/6). Correlação só é
 * tentada quando `input.store === 'PLAY_STORE'`.
 *
 * FASE iOS-6: `input.store === 'APP_STORE'` agora passa pela mesma ideia,
 * via `appleOfferCorrelation.ts`'s `correlateAppleOffer` — `productId` +
 * `offerCode` do evento real contra `stored.appleOfferCorrelation` (nunca o
 * catálogo `promoCodes` ao vivo). Qualquer outra loja (um valor futuro
 * desconhecido) continua resultando em `not_matched` por construção.
 *
 * `RENEWAL` permanece EXATAMENTE como na Fase 4B — sem checagem de
 * correlação — porque `offer_code` não é garantido presente num RENEWAL de
 * conversão (documentação RevenueCat, "Sometimes"). A prova da promoção
 * acontece uma única vez, no `INITIAL_PURCHASE`; `trialStartedAt` já não
 * nulo é o que atesta, para o RENEWAL, que aquela prova já ocorreu.
 *
 * Nunca toca `users/{uid}` — esta fase deliberadamente não estende o
 * espelho de leitura (`AttributionSnapshot`) com o estado de trava; ver o
 * relatório da Fase 4B para essa decisão de escopo. Nunca cria
 * `couponRedemptions/{uid}` — se não existir, é um no-op
 * (`skipped: no_redemption`), conforme a regra 1 ("se não existir, seguir
 * normalmente sem criar atribuição").
 */
export async function applyAttributionRevenueCatEvent(
  uid: string,
  input: AttributionConfirmationInput,
): Promise<AttributionConfirmationResult> {
  const redemptionRef = db.doc(couponRedemptionDocPath(uid));

  try {
    return await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(redemptionRef);
      if (!snapshot.exists) {
        return { status: 'skipped', reason: 'no_redemption' };
      }

      const stored = snapshot.data() as Record<string, unknown>;
      const state: StoredAttributionConfirmationState = {
        trialStartedAt: stored.trialStartedAt,
        convertedAt: stored.convertedAt,
        lockedAt: stored.lockedAt,
      };

      if (input.eventType === 'INITIAL_PURCHASE') {
        const classification = classifyInitialPurchasePeriodType(input.periodType);

        // FASE iOS-1 — explicit per-store dispatch (previously a binary
        // "PLAY_STORE or nothing" check). PLAY_STORE behavior is byte-for-
        // byte unchanged from Fase 4C.3A; APP_STORE gets its OWN typed
        // path through `appleOfferCorrelation.ts`, never sharing the generic
        // "unknown store" fallback. FASE iOS-6: that path now performs a
        // real, deterministic match (productId + offer reference) instead
        // of always returning `unsupported` — see `correlateAppleOffer`'s
        // doc comment. Any other/future store value keeps the pre-existing
        // fail-closed fallback.
        const rawOfferCode = typeof input.offerCode === 'string' ? input.offerCode : null;
        let productIdentity: ReturnType<typeof parseGooglePlayProductId> = null;
        let offerCorrelation: OfferCorrelationInput;

        if (input.store === 'PLAY_STORE') {
          productIdentity = parseGooglePlayProductId(input.productId);
          const androidOffer = parseStoredAndroidOfferSnapshot(stored.androidOffer);
          const googleResult: GooglePlayOfferCorrelationResult = correlateGooglePlayOffer(
            productIdentity?.basePlanId ?? null,
            rawOfferCode,
            androidOffer,
          );
          offerCorrelation = googleResult;
        } else if (input.store === 'APP_STORE') {
          const appleOfferCorrelation = parseStoredAppleOfferCorrelationSnapshot(
            stored.appleOfferCorrelation,
          );
          const appleProductId = typeof input.productId === 'string' ? input.productId : null;
          const appleResult: AppleOfferCorrelationResult = correlateAppleOffer(
            appleProductId,
            rawOfferCode,
            appleOfferCorrelation,
          );
          offerCorrelation = appleResult;
        } else {
          offerCorrelation = { status: 'not_matched' };
        }

        const decision = decideInitialPurchaseAttributionConfirmation(
          state,
          classification,
          offerCorrelation,
        );

        if (decision.action !== 'confirm') {
          const reason = mapInitialPurchaseSkipReason(decision.action);
          if (reason === 'offer_not_matched') {
            logWarn(CONFIRMATION_SCOPE, 'promo_attribution_offer_mismatch', {
              uid,
              store: input.store,
              hasProductId: productIdentity !== null,
              hasOfferCode: rawOfferCode !== null,
              correlationStatus: offerCorrelation.status,
            });
          }
          return { status: 'skipped', reason };
        }

        logInfo(CONFIRMATION_SCOPE, 'promo_attribution_offer_matched', {
          uid,
          plan: offerCorrelation.status === 'matched' ? offerCorrelation.plan : undefined,
        });

        const eventTimestamp = Timestamp.fromMillis(input.eventTimestampMs);
        const update: Record<string, unknown> = {
          lockedAt: eventTimestamp,
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (decision.setTrialStartedAt) update.trialStartedAt = eventTimestamp;
        if (decision.setConvertedAt) update.convertedAt = eventTimestamp;

        transaction.set(redemptionRef, update, { merge: true });
        return { status: 'confirmed' };
      }

      const decision = decideRenewalAttributionConfirmation(state, input.isTrialConversion);
      if (decision.action !== 'confirm_conversion') {
        const reason: 'no_redemption' | 'not_trial_started' | 'already_converted' | 'not_paid_renewal' =
          decision.action === 'skip_no_redemption'
            ? 'no_redemption'
            : decision.action === 'skip_not_trial_started'
              ? 'not_trial_started'
              : decision.action === 'skip_already_converted'
                ? 'already_converted'
                : 'not_paid_renewal';
        return { status: 'skipped', reason };
      }

      transaction.set(
        redemptionRef,
        {
          convertedAt: Timestamp.fromMillis(input.eventTimestampMs),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return { status: 'confirmed' };
    });
  } catch (err) {
    logFunctionError(CONFIRMATION_SCOPE, err, { uid, eventType: input.eventType });
    throw err;
  }
}
