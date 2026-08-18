/**
 * Fase 2 do modelo de acesso por assinatura (docs/13_assinaturas_e_billing.md):
 * a camada de PRODUCT AUTHORIZATION, separada da camada de SUBSCRIPTION STATE
 * (`SubscriptionContext`/`useSubscription`) e da camada de NAVEGAÇÃO
 * (`premiumGate.ts`, que a partir da Fase 1 nunca mais lê `isPremium`).
 *
 * Esta camada não é uma segunda fonte de verdade: `resolvePremiumCapabilities`
 * é uma função pura que recebe o `isPremium` já resolvido pelo
 * `SubscriptionContext` (que por sua vez deriva de
 * `CustomerInfo.entitlements.active['premium']` do RevenueCat) e traduz esse
 * único booleano em decisões de autorização por ação de produto. Nenhuma
 * capability aqui consulta RevenueCat, Firestore ou AsyncStorage.
 *
 * Política desta fase (intencionalmente simples — sem tiers, sem trials com
 * regras próprias, sem limites): entitlement Premium ativo libera todas as
 * capabilities; qualquer outro caso (inativo, ou estado de assinatura ainda
 * não resolvido) nega todas. Ver `resolvePremiumCapabilities` abaixo para o
 * fail-closed de estado não resolvido.
 */

/**
 * Ações de produto Premium reconhecidas pela camada de autorização. Cada
 * capability nomeia uma AÇÃO, nunca uma tela ou componente — a mesma tela
 * pode misturar ações premium e não-premium (ex.: `ProgressScreen` permite
 * visualizar histórico livremente, mas `REGISTER_BODY_WEIGHT` e
 * `ADD_PROGRESS_PHOTO` são capabilities separadas dentro dela).
 *
 * Deliberadamente NÃO inclui ações básicas de conta (perfil, idioma,
 * unidades, suporte, logout, gerenciar assinatura, restore) — essas
 * continuam fora da camada Premium nesta fase; ver o comentário de
 * `ACCOUNT_ACTIONS_OUT_OF_SCOPE` mais abaixo.
 */
export type PremiumCapability =
  | 'START_WORKOUT'
  | 'VIEW_WORKOUT_DETAILS'
  | 'REGISTER_WORKOUT'
  | 'REGISTER_LOAD'
  | 'REGISTER_BODY_WEIGHT'
  | 'REGISTER_MEASUREMENTS'
  | 'ADD_PROGRESS_PHOTO'
  | 'DELETE_PROGRESS_PHOTO'
  | 'CREATE_ASSESSMENT';

/**
 * Cada capability precisa aparecer aqui explicitamente. Um novo membro de
 * `PremiumCapability` sem entrada correspondente falha o typecheck deste
 * arquivo (ver `PREMIUM_CAPABILITIES` abaixo, que é tipado com
 * `Record<PremiumCapability, true>`) — não existe fallback silencioso para
 * capability desconhecida.
 */
const PREMIUM_CAPABILITIES: Record<PremiumCapability, true> = {
  START_WORKOUT: true,
  VIEW_WORKOUT_DETAILS: true,
  REGISTER_WORKOUT: true,
  REGISTER_LOAD: true,
  REGISTER_BODY_WEIGHT: true,
  REGISTER_MEASUREMENTS: true,
  ADD_PROGRESS_PHOTO: true,
  DELETE_PROGRESS_PHOTO: true,
  CREATE_ASSESSMENT: true,
};

/**
 * Documentação viva, não código executável: ações que permanecem fora desta
 * camada nesta fase, mesmo existindo dentro de telas que também têm ações
 * Premium. Reavaliar apenas com uma decisão de produto explícita — não
 * promover uma dessas para `PremiumCapability` por conveniência de
 * implementação de uma feature futura.
 */
export const ACCOUNT_ACTIONS_OUT_OF_SCOPE = [
  'VIEW_PROFILE',
  'EDIT_PROFILE',
  'CHANGE_PROFILE_PHOTO',
  'CHANGE_LANGUAGE',
  'CHANGE_UNITS',
  'OPEN_SETTINGS',
  'CONTACT_SUPPORT',
  'LOGOUT',
  'MANAGE_SUBSCRIPTION',
  'RESTORE_PURCHASES',
] as const;

/**
 * O único dado de entrada desta camada: o `isPremium` já resolvido por
 * `useSubscription()`. Propositalmente não aceita `CustomerInfo`,
 * `SubscriptionCenterStatus` ou o mirror do Firestore — a autoridade de
 * acesso continua sendo exclusivamente o entitlement ativo do RevenueCat,
 * como a Fase 1 preservou. `resolved` cobre o fail-closed de
 * `subscriptionLoading`/`!subscriptionConfigured`: chamadores que ainda não
 * têm `isPremium` confiável devem passar `resolved: false` em vez de omitir
 * o campo — ver `usePremiumCapabilities` para o caso real de uso.
 */
export type PremiumAccessState = {
  isPremium: boolean;
  /**
   * `false` enquanto a assinatura ainda não terminou de resolver
   * (`subscriptionLoading` ou `!subscriptionConfigured` no
   * `SubscriptionContext`). Nunca omita isto para "ainda não sei" — omitir
   * equivaleria a presumir `true`, que é exatamente o que a Fase 2 proíbe
   * (ver critério de aprovação "estado não resolvido nunca libera capability
   * Premium").
   */
  resolved: boolean;
};

/**
 * Função pura e síncrona: nenhum I/O, nenhum acesso a RevenueCat/Firestore/
 * AsyncStorage, segura para chamar durante o render do React.
 *
 * Regra desta fase: `resolved && isPremium` libera todas as
 * PremiumCapabilities; qualquer outro caso nega todas — inclusive quando
 * `resolved` é `false` (fail-closed para estado de assinatura ainda
 * desconhecido, o mesmo princípio que `premiumGate.ts` já aplicava antes da
 * Fase 1 para bloquear a navegação enquanto `subscriptionLoading` era
 * `true`; aqui ele passa a proteger a autorização de ações em vez da
 * navegação).
 */
export function canPerformPremiumCapability(
  capability: PremiumCapability,
  access: PremiumAccessState,
): boolean {
  // `PREMIUM_CAPABILITIES[capability]` existing is guaranteed by the
  // `Record<PremiumCapability, true>` typing above — this is not a runtime
  // fallback, it documents that every capability was deliberately catalogued.
  void PREMIUM_CAPABILITIES[capability];
  return access.resolved && access.isPremium;
}

/**
 * Convenience: resolve todas as capabilities de uma vez, útil para o hook
 * React (`usePremiumCapabilities`) construir seu objeto de retorno sem
 * repetir `canPerformPremiumCapability` capability por capability.
 */
export function resolvePremiumCapabilities(
  access: PremiumAccessState,
): Record<PremiumCapability, boolean> {
  const allowed = access.resolved && access.isPremium;
  return {
    START_WORKOUT: allowed,
    VIEW_WORKOUT_DETAILS: allowed,
    REGISTER_WORKOUT: allowed,
    REGISTER_LOAD: allowed,
    REGISTER_BODY_WEIGHT: allowed,
    REGISTER_MEASUREMENTS: allowed,
    ADD_PROGRESS_PHOTO: allowed,
    DELETE_PROGRESS_PHOTO: allowed,
    CREATE_ASSESSMENT: allowed,
  };
}
