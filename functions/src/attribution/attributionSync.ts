import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../lib/firebaseAdmin';
import { logFunctionError, logInfo, logWarn } from '../lib/logger';
import {
  ATTRIBUTION_FIELD,
  couponRedemptionDocPath,
  userDocPath,
} from './constants';
import {
  correlateApplePromoPurchaseIntent,
  type ApplePromoPurchaseIntentCorrelationResult,
} from './applePromoPurchaseIntentCorrelation';
import {
  correlateGooglePlayOffer,
  parseGooglePlayProductId,
  type GooglePlayOfferCorrelationResult,
} from './googlePlayOfferCorrelation';
import type {
  AndroidSubscriptionOfferConfig,
  IOSPromotionConfig,
  PromoCodeAndroidOfferSnapshot,
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
   * FASE 1 — the iOS promotional (Offering/SKU) config authorized for this
   * code AT THIS MOMENT, computed unconditionally by `validatePromoCode.ts`
   * exactly like `androidOffer`.
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
 * different one — docs §8: once the store confirms a real, correlated
 * purchase happened (trial or paid — FASE 5.5: never conditioned on trial
 * specifically), "atribuição comercial definitiva" applies and this app
 * never revisits it (the "unlock" itself is out of scope for this phase —
 * no code anywhere sets `lockedAt` to a non-null value yet).
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
 * 3. On `apply`, writes BOTH `couponRedemptions/{uid}` (explicit merge of
 *    every active lifecycle field, so swapping replaces
 *    `couponCode`/`campaignId`/`influencerId`/`androidOffer`/`iosPromotion`/
 *    `appliedAt`, clears an obsolete intent and preserves `createdAt` plus
 *    unknown historical fields) and `users/{uid}.attribution` (merge into the nested map
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
          intent === null ||
          intent.status === 'purchase_confirmed' ||
          isPromoPurchaseIntentActiveAt(intent, Timestamp.now());
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

      const redemptionWrite: Record<string, unknown> = {
        uid,
        couponCode: attribution.couponCode,
        campaignId: attribution.campaignId,
        influencerId: attribution.influencerId,
        androidOffer: attribution.androidOffer,
        iosPromotion: attribution.iosPromotion,
        appliedAt: now,
        createdAt,
        updatedAt: now,
        trialStartedAt: null,
        convertedAt: null,
        lockedAt: null,
      };
      if (existing && Object.prototype.hasOwnProperty.call(existing, 'purchaseIntent')) {
        redemptionWrite.purchaseIntent = FieldValue.delete();
      }
      // Preserve unknown historical evidence without reading or rewriting
      // it. Active fields are replaced explicitly and an obsolete intent is
      // still cleared when a new application is allowed.
      transaction.set(redemptionRef, redemptionWrite, { merge: true });

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
 * `matched` (with which plan) or not. Both
 * `GooglePlayOfferCorrelationResult` and the matched iOS purchase-intent
 * result satisfy this structurally.
 */
export type OfferCorrelationInput =
  | { status: 'matched'; plan: 'monthly' | 'annual' }
  | { status: 'not_matched' };

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
      /** Stable webhook ID, used to distinguish an exact retry from reuse. */
      eventId: string;
      /** Raw RevenueCat `purchased_at_ms`; null when absent/invalid. */
      purchasedAtMs: number | null;
      periodType: string | undefined;
      /**
       * Raw `event.store`: Google keeps its offer correlation; Apple uses
       * only purchase-intent correlation; unknown stores fail closed.
       */
      store: string | undefined;
      /** Raw `event.product_id` — parsed by `parseGooglePlayProductId` (`googlePlayOfferCorrelation.ts`). */
      productId: string | undefined;
      /** Raw `event.offer_code` — read by `extractGooglePlayOfferCode`. `undefined` when the field itself is absent (same effect as `null`: no proof of an offer). */
      offerCode: string | null | undefined;
      transactionId?: string;
      originalTransactionId?: string;
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
  | 'offer_not_matched'
  | 'no_intent'
  | 'product_mismatch'
  | 'campaign_mismatch'
  | 'offering_mismatch'
  | 'snapshot_product_mismatch'
  | 'expired'
  | 'purchase_before_intent'
  | 'malformed'
  | 'unsupported_event'
  | 'already_processed'
  | 'already_consumed';

export type AttributionConfirmationResult =
  | { status: 'confirmed' }
  | { status: 'skipped'; reason: AttributionConfirmationSkipReason };

function parseAndroidOfferPair(value: unknown): AndroidSubscriptionOfferConfig | null {
  if (value === null || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.basePlanId !== 'string') return null;
  if (v.offerId !== null && v.offerId !== undefined && typeof v.offerId !== 'string') return null;
  // FASE 5.7 — absent (every snapshot frozen before this phase, including
  // every LEGACY offerId-bearing one) parses as null, same treatment as
  // `offerId`. Never used by webhook correlation (client-only concern), but
  // read through so the snapshot round-trips the full stored shape.
  if (
    v.offeringIdentifier !== null &&
    v.offeringIdentifier !== undefined &&
    typeof v.offeringIdentifier !== 'string'
  ) {
    return null;
  }
  return {
    basePlanId: v.basePlanId,
    offerId: (v.offerId as string | undefined) ?? null,
    offeringIdentifier: (v.offeringIdentifier as string | undefined) ?? null,
  };
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

function mapApplePromoCorrelationSkipReason(
  result: Exclude<
    ApplePromoPurchaseIntentCorrelationResult,
    { status: 'matched' } | { status: 'not_promotional' }
  >,
): AttributionConfirmationSkipReason {
  switch (result.status) {
    case 'no_intent':
    case 'product_mismatch':
    case 'campaign_mismatch':
    case 'offering_mismatch':
    case 'snapshot_product_mismatch':
    case 'expired':
    case 'purchase_before_intent':
    case 'malformed':
    case 'unsupported_event':
    case 'already_processed':
    case 'already_consumed':
      return result.status;
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
 * FASE 8: `APP_STORE` avalia somente a correlação por purchase intent. Intent
 * ausente, produto normal ou qualquer conflito nunca cai para Apple Offer
 * Code. Qualquer outra loja futura continua `not_matched` por construção.
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

        // Explicit per-store dispatch. PLAY_STORE behavior remains on the
        // existing Google offer proof. APP_STORE uses only the FASE 3
        // purchase-intent proof; `not_promotional` remains unattributed.
        // Unknown stores fail closed.
        let productIdentity: ReturnType<typeof parseGooglePlayProductId> = null;
        let offerCorrelation: OfferCorrelationInput;
        let applePromoCorrelation: ApplePromoPurchaseIntentCorrelationResult | undefined;

        if (input.store === 'PLAY_STORE') {
          const rawOfferCode = typeof input.offerCode === 'string' ? input.offerCode : null;
          productIdentity = parseGooglePlayProductId(input.productId);
          const androidOffer = parseStoredAndroidOfferSnapshot(stored.androidOffer);
          const googleResult: GooglePlayOfferCorrelationResult = correlateGooglePlayOffer(
            productIdentity?.basePlanId ?? null,
            rawOfferCode,
            androidOffer,
          );
          offerCorrelation = googleResult;
        } else if (input.store === 'APP_STORE') {
          applePromoCorrelation = correlateApplePromoPurchaseIntent({
            eventType: input.eventType,
            eventId: input.eventId,
            productId: input.productId,
            purchasedAtMs: input.purchasedAtMs,
            redemptionCampaignId: stored.campaignId,
            iosPromotion: stored.iosPromotion,
            hasPurchaseIntent: Object.prototype.hasOwnProperty.call(stored, 'purchaseIntent'),
            purchaseIntent: stored.purchaseIntent,
          });

          if (applePromoCorrelation.status === 'not_promotional') {
            offerCorrelation = { status: 'not_matched' };
          } else if (applePromoCorrelation.status === 'matched') {
            offerCorrelation = applePromoCorrelation;
          } else {
            const reason = mapApplePromoCorrelationSkipReason(applePromoCorrelation);
            const logContext = {
              uid,
              correlationStatus: applePromoCorrelation.status,
              hasProductId: typeof input.productId === 'string',
              hasPurchaseTimestamp: input.purchasedAtMs !== null,
            };
            if (reason === 'already_processed') {
              logInfo(CONFIRMATION_SCOPE, 'apple_promo_purchase_intent_correlation', logContext);
            } else {
              logWarn(CONFIRMATION_SCOPE, 'apple_promo_purchase_intent_correlation', logContext);
            }
            return { status: 'skipped', reason };
          }
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
              hasOfferCode:
                input.store === 'PLAY_STORE' && typeof input.offerCode === 'string',
              correlationStatus: offerCorrelation.status,
            });
          }
          return { status: 'skipped', reason };
        }

        logInfo(CONFIRMATION_SCOPE, 'promo_attribution_offer_matched', {
          uid,
          plan: offerCorrelation.status === 'matched' ? offerCorrelation.plan : undefined,
          correlationMethod:
            applePromoCorrelation?.status === 'matched' ? 'apple_purchase_intent' : 'store_offer',
        });
        if (applePromoCorrelation?.status === 'matched') {
          logInfo(CONFIRMATION_SCOPE, 'apple_promo_purchase_intent_correlation', {
            uid,
            correlationStatus: 'matched',
            plan: applePromoCorrelation.plan,
          });
        }

        const eventTimestamp = Timestamp.fromMillis(input.eventTimestampMs);
        const update: Record<string, unknown> = {
          lockedAt: eventTimestamp,
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (
          typeof input.transactionId === 'string' && input.transactionId.length > 0 &&
          typeof input.originalTransactionId === 'string' && input.originalTransactionId.length > 0 &&
          typeof input.store === 'string' && typeof input.productId === 'string'
        ) {
          update.subscriptionOrigin = {
            transactionKey: `${input.store}:${input.originalTransactionId}`,
            transactionId: input.transactionId,
            originalTransactionId: input.originalTransactionId,
            revenueCatEventId: input.eventId,
            store: input.store,
            productId: input.productId,
            confirmedAt: eventTimestamp,
          };
        }
        if (decision.setTrialStartedAt) update.trialStartedAt = eventTimestamp;
        if (decision.setConvertedAt) update.convertedAt = eventTimestamp;
        if (applePromoCorrelation?.status === 'matched') {
          update.purchaseIntent = {
            ...applePromoCorrelation.intent,
            status: 'purchase_confirmed',
            updatedAt: eventTimestamp,
            confirmedAt: eventTimestamp,
            revenueCatEventId: input.eventId,
          };
        }

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
