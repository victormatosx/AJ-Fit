# Nutrition — Test Environment Checklist (Fase 33)

Atualizado em 2026-10-08 (segunda rodada da Fase 33) — `ajfit-2f321` é o
ambiente de teste autorizado (ainda sem usuários públicos reais) e as
escritas abaixo já foram executadas nele, exceto onde marcado `[ ]`.

## Ambiente

`.firebaserc` continua com `"production": "ajfit-2f321"` — esse nome não
foi alterado (não é parte do escopo). O que mudou é a autorização: esta
rodada usa esse mesmo projeto como ambiente de teste, com uma confirmação
explícita extra (`--allow-current-test-project <id>`) em todo script que
escreve nele, em vez de apontar para um segundo projeto. O guard de
produção (`src/nutrition/catalog/projectGuard.ts`) continua recusando o
projeto por padrão; só aceita quando a flag bate exatamente com `--project`.

## Checklist

- [x] **catalog imported** — 519 alimentos reais da TACO 4ª edição
      importados em `ajfit-2f321` (`created: 519, updated: 0, unchanged: 0`
      — nenhum dado pré-existente foi tocado/apagado).
- [x] **curadoria de dietary flags/allergens** — 58 alimentos revisados item a item em
      `scripts/nutrition/sources/taco-v1-enrichment.json`, com `rationale`
      por alimento; TACO 401 é a única exceção preparada documentada, com
      alergênicos conservadores e nenhum macro alterado. Aplicado via `scripts/nutrition/applyEnrichment.ts`
      (nunca edita o arquivo raw diretamente).
- [x] **catalog coverage pass** — `npm run nutrition:catalog:audit`:
      `sufficientForGeneration: true` para omnivore/vegetarian/vegan/
      pescatarian, em todas as contagens de refeição (2 a 6), em todos os
      6 meal slots. Ver limitação de `protein_source`/`dairy` abaixo.
- [x] **rollout 100%** — `nutritionRolloutConfig/active` em `ajfit-2f321`:
      ambos os flags `{enabled:true, percentage:100}`.
- [x] **Rules deployed** — `firebase deploy --only firestore:rules --project ajfit-2f321`.
- [x] **indexes deployed** — `firebase deploy --only firestore:indexes --project ajfit-2f321`
      (os 3 índices compostos de `nutritionFoods`/`nutritionGenerationJobs`).
- [x] **OPENAI_API_KEY configured** — configurada em `ajfit-2f321`
      (confirmado apenas pelo sucesso do deploy subsequente; valor nunca
      lido/impresso).
- [x] **Functions deployed** — as 7 functions de Nutrição estão live em
      `ajfit-2f321` (confirmado via `firebase functions:list`):
      `requestNutritionPlanGeneration`, `onNutritionGenerationJobCreated`,
      `retryNutritionGenerationJobs`, `requestNutritionMealAlternative`,
      `restoreNutritionPlan`, `onNutritionGenerationCompleted`,
      `monitorNutritionAiOperations`.
- [x] **app build/version** — build atual já aponta para `ajfit-2f321`
      (mesmo `.env`); nenhuma mudança de build necessária.
- [ ] **push configured** — não verificado nesta rodada; independente de Nutrição.
- [x] **real generation smoke** — **EXECUTADO E CONCLUÍDO PÓS-FIX**.
      1ª (via app real, usuário de teste): falhou com `AI_TIMEOUT` nos 3
      attempts — causa raiz encontrada e corrigida (ver "Bug encontrado e
      corrigido" abaixo). 2ª (pós-fix, 1 geração controlada): não travou
      mais em timeout (2 de 3 attempts passaram do timeout), mas terminou
      em `AI_SAFETY_VALIDATION_FAILED` no 3º attempt — o modelo recusou a
      resposta. A investigação posterior provou duas causas estruturais:
      o lanche era inviável em densidade proteica com o catálogo aprovado,
      e o request não informava a matriz de meal slots aceita pelo validator.
      Após adicionar `allowedMealSlots`, um preflight de densidade e um
      `protein_source` TACO curado, a geração real completou na primeira
      tentativa, passou pelo validator e persistiu exatamente um plano ativo.
- [ ] **real alternative smoke** — não executado (regra do round: só
      roda se o full-plan passar; não passou ainda).
- [ ] **diary / restore / weekly / account deletion** — cobertos por E2E
      automatizado (Fase 31); repetir manualmente no app quando uma
      geração completar com sucesso.

## Bug encontrado e corrigido: timeout de 45s insuficiente

**Causa raiz**: `functions/src/nutrition/ai/provider.ts` usava
`AbortSignal.timeout(45000)` fixo para a chamada à Responses API da
OpenAI. O primeiro smoke real (via app, usuário de teste, 2026-10-09
~03:41 UTC) falhou com `AI_TIMEOUT` nos 3 attempts, todos abortando a
~45,0-45,1s — tempos quase idênticos entre si, o que é a assinatura de um
teto fixo sendo batido de forma consistente, não de uma variação de rede
aleatória.

**Correção**: extraído para a constante `OPENAI_REQUEST_TIMEOUT_MS = 90_000`
(90s), documentando a evidência real no próprio código. 90s mantém uma
margem de ~30s sob o timeout mais apertado que compartilha esse provider
(`requestNutritionMealAlternative`, `timeoutSeconds: 120`); o worker de
full-plan tem orçamento de 540s, nunca foi a restrição.

**Teste de regressão**: `functions/src/nutrition/__tests__/generation.test.ts`
agora afirma `OPENAI_REQUEST_TIMEOUT_MS > 45_000` e
`OPENAI_REQUEST_TIMEOUT_MS < 120_000 - 20_000`, para que um futuro ajuste
não possa reintroduzir silenciosamente um valor menor que a janela de
segurança do callable mais apertado.

**Redeploy**: só as 3 functions que de fato usam `OpenAiNutritionProvider`
(`onNutritionGenerationJobCreated`, `retryNutritionGenerationJobs`,
`requestNutritionMealAlternative`) foram republicadas — as outras 4 não
foram tocadas.

## Bug de ferramenta (não de produção) encontrado durante o diagnóstico

Scripts em `scripts/nutrition/realAi*SmokeTest.ts` criavam sua própria
instância do Admin SDK a partir do `firebase-admin` da raiz do repositório
e passavam esse `db` para código em `functions/src/...`, que importa
`firebase-admin` da SUA PRÓPRIA cópia em `functions/node_modules`
(mesma versão, módulo diferente). Isso faz `instanceof Timestamp` falhar
silenciosamente dentro de `validProfile()` (`context.ts`), mesmo com um
perfil 100% válido — reproduzido e confirmado campo a campo. Esse bug
NUNCA afeta produção (a function deployada roda inteiramente dentro do
pacote `functions/`, com uma única cópia do `firebase-admin`); só afeta
chamar esse código a partir de um script fora de `functions/`. Corrigido
nos dois smoke scripts reutilizando `functions/src/lib/firebaseAdmin`'s
`db` em vez de criar um novo.

## Limitação real de cobertura: protein_source e dairy

A curadoria desta rodada cobriu cereais, leguminosas, frutas, vegetais e
a maioria das fontes de gordura — e isso já é suficiente para
`hasCandidateCoverage` em todos os slots/padrões. **Carnes, peixes, ovos e
a maior parte dos laticínios simples NÃO entraram no subconjunto aprovado**,
não por falta de curadoria de alergia, mas por uma restrição técnica real:
`foodAllowed()` (`functions/src/nutrition/generation/domain.ts`) exige
`nutritionPer100g.fiberG != null`, e a própria TACO marca fibra como "NA"
(não analisado) para carne/peixe/ovo/leite puros — não "0,0". Preencher
isso com `0` seria inventar um dado que a fonte oficial deixou em branco,
o que esta rodada também evita. Resultado prático: os 4 padrões
alimentares (omnivore/vegetarian/vegan/pescatarian) têm hoje exatamente o
mesmo pool de candidatos, porque nenhum item aprovado é de origem animal
— pescatarian não tem peixe real disponível ainda. Isso é uma limitação
de catálogo a resolver incrementalmente (seção "Catálogo após smoke"),
não um bug do Engine nem do validator.

## Checklist manual no app (sequência exata)

1. abrir Nutrição
2. criar perfil
3. gerar dieta
4. fechar app
5. reabrir durante a geração
6. abrir o plano
7. registrar uma refeição
8. editar a refeição registrada
9. solicitar uma alternativa
10. favoritar uma opção
11. abrir o histórico
12. restaurar um plano anterior
13. ver o resumo semanal
14. verificar push (plan ready / daily log reminder / weekly summary)

Passos 1-2 já são testáveis hoje (Rules + rollout estão live). Passos 3+
dependem do deploy das Functions (bloqueado pelo secret).

## Troubleshooting

| Sintoma | Causa provável | Onde olhar |
|---|---|---|
| Aba Nutrição não aparece | `nutritionEnabled` ausente/desligado, ou ainda resolvendo (`null`) | `nutritionRolloutConfig/active` (já em 100% em `ajfit-2f321`); confirme que o app está lendo esse projeto |
| `FEATURE_DISABLED` | `nutritionPlanGenerationEnabled` desligado para esse uid | mesmo doc — já 100% |
| Callable não encontrada / erro de rede ao gerar | Functions de Nutrição não deployadas ainda | ver item "Functions deployed" acima |
| `CATALOG_INSUFFICIENT` | Perfil pede um meal slot/padrão sem cobertura | `npm run nutrition:catalog:audit` — hoje só protein_source/dairy ficam de fora |
| Erro de secret ausente | `OPENAI_API_KEY` não configurada | `firebase functions:secrets:set OPENAI_API_KEY --project ajfit-2f321` (nunca cole o valor em texto puro) |
| Erro de provider (AI_PROVIDER_ERROR) | Timeout/5xx da OpenAI, rate limit real | `nutritionAiOperations` do uid — `resultStatus`/`failureCode`, nunca o prompt/output |
| Index missing | Índice composto não implantado | Já deployados nesta rodada; se reaparecer, `firebase deploy --only firestore:indexes --project ajfit-2f321` |
| Erro de App Check | App Check não configurado/token inválido | Firebase Console > App Check > confirmar o app registrado |
| Permissão de push negada | Usuário/dispositivo sem permissão concedida | Esperado — Nutrição não deve exigir push ligado para funcionar |

Nenhum item acima deve ser resolvido expondo o valor de um secret em log,
chat ou código.
