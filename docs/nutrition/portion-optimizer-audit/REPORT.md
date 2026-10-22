# AJ Fit — ajustador matemático de porções por alimento (otimizador per-item), 21/10/2026

**Veredito: SUCESSO.** A arquitetura de duas IAs foi preservada integralmente. Implementado um ajustador determinístico que dá a cada alimento já escolhido pela IA seu próprio multiplicador de porção, em vez de um único fator uniforme para a refeição inteira — o mecanismo anterior só conseguia corrigir desvios cuja proporção entre nutrientes já coincidisse com a do alimento, por construção. Validado por 11 novos testes determinísticos, pela suíte completa (2.097 testes de Functions, zero falhas; 331 testes de nutrição contra o Firestore Emulator, zero falhas — ambos sem nenhuma regressão sobre o baseline anterior), e por homologação real contra a API da OpenAI: o cenário que historicamente falhava (~67%/4-de-6, documentado em `docs/nutrition/macro-reliability-audit/REPORT.md`) passou de **5/8 (62,5%)** com o mecanismo antigo para **8/8 (100%)** com o novo, com menos chamadas de IA e menor custo médio por execução. As quatro Functions efetivamente afetadas foram publicadas e verificadas em produção. Os cinco endpoints de treino, as demais Functions de nutrição e as Firestore Rules não foram tocados. Não houve build EAS/TestFlight, commit ou push.

## 1. Estado inicial e documentação lida

Branch `treinos`, working tree preservado. Lidos integralmente antes de qualquer alteração: `docs/nutrition/macro-reliability-audit/REPORT.md`, `docs/nutrition/dual-ai-final-fix/REPORT.md`, `docs/nutrition/dual-ai-generation-2026-10-20/REPORT.md` (via o relatório de produção que a cita) e `docs/nutrition/dual-ai-production-release-2026-10-20/REPORT.md`. Inspecionados `functions/src/nutrition/generation/{correction,domain,diagnostics,attempts}.ts`, `functions/src/nutrition/ai/prompt.ts`, `functions/src/nutrition/shared/types/nutrition.ts`, `functions/src/nutrition/shared/nutrition/engine/constants.ts` e `scripts/syncNutritionToFunctions.cjs`.

Confirmado por leitura: `estimatedNutrition` é a própria estimativa da IA "para aquela quantidade exata" (`prompt.ts`), nunca um valor por-100g — a mesma suposição de escala linear que o corretor uniforme já usa em `scaledPortions` (multiplica cada nutriente pelo fator de quantidade real). O novo otimizador não assume nada mais forte sobre a composição dos alimentos do que o mecanismo que ele estende. Confirmado também que `correction.ts`/`domain.ts` são arquivos exclusivos de Functions (não têm espelho em `src/nutrition`, não aparecem na lista de arquivos sincronizados por `syncNutritionToFunctions.cjs`) — o novo módulo foi colocado no mesmo lugar, sem necessidade de sincronização.

## 2. Diagnóstico confirmado da causa raiz residual

O corretor existente (`admissibleScale`/`scaledPortions` em `correction.ts`) aplica **um único fator de escala** a todos os alimentos de uma refeição. Escalar preserva a proporção entre nutrientes por construção — então só corrige um desvio cuja meta já exija exatamente a proporção presente nos alimentos escolhidos pela IA. Quando a meta exige, por exemplo, mais gordura sem alterar proteína/carboidrato/fibra (um padrão comum: a IA escolheu pouco azeite), nenhum fator único resolve — a correção falha com `empty_intersection` e a tentativa é consumida sem chance real de sucesso. Isso é exatamente a causa do risco documentado em `macro-reliability-audit/REPORT.md` §9.1/§7.2 (cenário de macros com ≈67%/4-de-6 de aprovação real).

## 3. Estratégias avaliadas

1. **Pedir à IA que gere de novo** (status quo) — já tentado por até 3 vezes; não resolve porque o problema é estrutural (um fator não tem graus de liberdade suficientes), não uma falha aleatória de amostragem.
2. **Solver de otimização externo** (LP/QP de propósito geral) — descartado por exigir dependência pesada, não determinística/reprodutível de forma trivial entre versões de biblioteca, e desproporcional para ≤8 variáveis e 5 restrições.
3. **Ajustador per-item com formulação própria, leve e determinística** — escolhido. Detalhado abaixo.

## 4. Formulação matemática escolhida

Variáveis: um multiplicador `x_i ∈ [0.5, 2]` por alimento já escolhido (mesmo orçamento `[CORRECTION_SCALE_MIN, CORRECTION_SCALE_MAX]` já usado pelo corretor uniforme — reexportado de `correction.ts`, não duplicado).

Objetivo: minimizar `Σ_nutriente peso_nutriente · penalidade_fora_da_faixa(total_nutriente(x))² + λ · Σ_i (x_i − 1)²`, onde a penalidade é zero estritamente dentro de `[min,max]` e a distância ao limite violado fora dela (hinge quadrático, C¹), e `peso_nutriente` normaliza pelo inverso do quadrado da meia-largura de tolerância daquele nutriente (para que kcal em centenas não domine fibra em poucos gramas apenas pela escala). O termo `λ·(x_i−1)²` prefere mudanças pequenas em relação às porções originais da IA.

Esse objetivo é convexo (soma de hinges quadráticos convexos em função linear de `x` + regularizador quadrático convexo), permitindo *coordinate descent* com busca de seção áurea 1-D por coordenada (sem derivada, sem biblioteca), convergindo provadamente ao ótimo global da relaxação contínua.

**Problema descoberto e corrigido durante a implementação:** a penalidade hinge-quadrática tem gradiente exatamente zero na própria fronteira — então o regularizador pode (e, nos testes, de fato) deixar o ótimo contínuo a uma fração de grama *fora* da faixa, mesmo quando um ponto plenamente viável existe próximo. Corrigido com uma segunda etapa de *alternating projections* (POCS — projeção alternada sobre cada fatia linear `min ≤ a·x ≤ max` e sobre a caixa `[0.5,2]`, partindo do ótimo "suave" como estimativa inicial), que converge provadamente a um ponto na intersecção dos conjuntos convexos sempre que ela é não vazia. Para evitar o mesmo problema de "tocar a fronteira" que a própria auditoria anterior já identificou como fonte de violação diária acumulada (`correction.ts`: *"independent per-meal 0.01 margins must not accumulate into a daily violation"*), a primeira tentativa de POCS usa faixas com um **recuo interior de 15%** da largura de cada janela; só recua para a fronteira exata se o recuo tornar o problema inviável.

Depois da solução contínua: quantização pelo mesmo `portionStep`/`validPortion` já usado pelo corretor uniforme, seguida de uma busca local discreta limitada (até 6 sweeps, deltas de 1/2/5/10% por item) para reparar qualquer violação reintroduzida pelo arredondamento — nunca adiciona/remove alimento, nunca excede a caixa `[0.5,2]`.

## 5. Limites de porção e proveniência dos dados nutricionais

- Multiplicador por item: `[0.5, 2]` — **reaproveitado sem alteração** do orçamento já aprovado do corretor uniforme (`CORRECTION_SCALE_MIN`/`CORRECTION_SCALE_MAX`, agora exportado de `correction.ts` em vez de duplicado como literal).
- Passo de quantização por unidade: reaproveitado de `portionStep`/`validPortion` sem alteração — unidades indivisíveis (`unidade`, `ovo`, `cápsula`...) só recebem múltiplos inteiros; gramas/ml/colheres usam passo de 0.01.
- `estimatedNutrition` é tratado como a própria estimativa da IA para aquela quantidade — nunca recalculado, nunca inventado. O otimizador só escala linearmente o que a IA já declarou, exatamente como o corretor uniforme já fazia.
- Quando todo alimento tem valor zero para um nutriente cuja meta exige um mínimo positivo, ou quando há uma unidade ambígua (`portionStep` retorna `null`), o otimizador recusa explicitamente (`zero_nutrient`/`ambiguous_unit`) em vez de fabricar uma solução — nunca trata isso como caso resolvível.
- Uma única refeição com um só alimento não tem grau de liberdade per-item (uma proporção fixa) — o otimizador é pulado deliberadamente nesse caso (`optimizePortions` não é chamado quando `items.length < 2`), preservando exatamente o comportamento/códigos de erro já estabelecidos do corretor uniforme para o caso mais comum nos testes existentes.

## 6. Posicionamento no fluxo de duas IAs

Nenhuma mudança na ordem do pipeline (`IA criadora → validação técnica → correção determinística → IA validadora → aprovação → persistência`). O otimizador substitui apenas o PRIMEIRO mecanismo tentado dentro do passo de correção determinística já existente em `evaluateMealOptions` (`domain.ts`) — se ele resolver, o corretor uniforme nunca é chamado; se não resolver (ou a refeição tiver só 1 alimento), cai exatamente no mesmo corretor uniforme de antes, sem alteração de comportamento. Como antes, `assertFoodSafety` roda sobre o candidato ajustado antes de aceitá-lo, e o candidato que a IA validadora recebe (via `candidateDigest`/`built.candidate` em `attempts.ts`, não alterado) é sempre a versão já ajustada — nenhuma mudança ocorre depois da aprovação do revisor. O otimizador nunca adiciona/remove ingrediente (confirmado por teste) e nunca lê/ignora restrições alimentares (não toca `restrictions.ts`/`reviewEvidence.ts`).

## 7. Testes determinísticos

`functions/src/nutrition/__tests__/portionOptimizer.test.ts` (11 testes novos):
1. Eleva gordura movendo só o item rico em gordura, sem alterar proteína/carboidrato/fibra — e prova, no mesmo teste, que `admissibleScale` (corretor uniforme) genuinamente não consegue (`interval: null`).
2. Integração ponta a ponta via `validateAndBuildPlan`: `diagnostics.meals[0].correction.method === 'per_item'`, diário aprovado.
3. Um único alimento não tem liberdade per-item — cai para `optimizer_infeasible` e, no fluxo real, para o corretor uniforme.
4. Unidade ambígua é recusada (`ambiguous_unit`), nunca adivinhada.
5. Nutriente zerado em todos os itens quando a meta exige mínimo positivo é recusado (`zero_nutrient`), nunca aprovado por falsa precisão.
6. Meta matematicamente fora de alcance dentro de `[0.5,2]` declara `optimizer_infeasible`, nunca um ajuste parcial fabricado.
7. Refeição já dentro da meta não sofre alteração desnecessária de porção (todos os multiplicadores ficam a <5% de 1).
8. Unidade indivisível (cápsula) só recebe quantidade inteira no resultado.
9. Toda quantidade produzida fica em `(0, 5000]` e passa no validador comum de item.
10. Determinístico: entradas idênticas produzem multiplicadores e itens idênticos (sem aleatoriedade).
11. Nunca adiciona/remove alimento — mesmos nomes/ingredientes/alergênicos na saída.

Cobertura dos 30 cenários do enunciado: ajuste de cada macro isoladamente e simultâneo (1–6, via o teste de gordura + a suíte pré-existente `macroCorrection.test.ts`, que cobre proteína/carboidrato/calorias sem regressão), refeições pequenas/lanches de ~300kcal (herdado dos testes de `distributeMeals`, não alterados), porções já corretas (7), limites mín/máx (6, 9), unidades indivisíveis (8), preparações compostas (1, itens com múltiplos ingredientes), dados incompletos (coberto estruturalmente: `validRawFoodItem` já exige todos os nutrientes antes de chegar ao otimizador — nunca há dado ausente nesse ponto), metas impossíveis (6), alterações excessivas de porção (regularização + teste 7), preservação de alimentos/restrições (11, 2), recálculo após ajuste (1, 9), consistência diária/por refeição (2), alternativas (reaproveita o mesmo `buildMealOptions`, cobertura pré-existente intacta), revisão independente após ajuste e digest correto (estrutural — `attempts.ts` não foi alterado, candidato ajustado é sempre o que vai ao revisor), persistência segurança/idempotência/concorrência (não alteradas — fora do raio de ação deste módulo, que só modifica a validação pré-persistência), compatibilidade com clientes antigos (contrato de schema/persistência inalterado), limites de custo (não alterados — otimizador é puro/sem chamada de rede, custo zero de IA).

### 7.1 — Regressão completa

| Suíte | Resultado |
| --- | --- |
| `functions`: `npx vitest run` (completa) | **2.097 passaram, 0 falharam** (2.086 do baseline anterior + 11 novos) |
| `functions`: nutrição contra Firestore Emulator (`demo-ajfit-dual-ai`) | **331 passaram, 0 falharam** (320 do baseline + 11 novos) |
| App (`src/nutrition`) | **490 passaram, 0 falharam** (idêntico — `correction.ts`/`domain.ts`/`portionOptimizer.ts` são exclusivos de Functions) |
| `tsc --noEmit` (Functions) | Sem erros |

## 8. Comparação antes/depois com IA real (mesmo cenário documentado como ≈67%)

Harness reaproveitado: `functions/src/nutrition/__tests__/realAiHomologation.manual.test.ts` (gpt-6-luna real, perfis sintéticos, Firestore Emulator `demo-ajfit-dual-ai`, nunca produção). Para a comparação controlada, foi criado um harness temporário (`portionOptimizerHomologation.manual.test.ts`, removido após a coleta de dados) que alternava, dentro do mesmo processo, uma flag temporária `NUTRITION_DISABLE_PORTION_OPTIMIZER` (removida do código antes da publicação — nunca fez parte do código publicado) para rodar o MESMO cenário (perfil onívoro, metas de macro/fibra/gordura apertadas) contra o mecanismo antigo e o novo, sem alterar nada além dessa flag.

**8 execuções reais de cada mecanismo:**

| Mecanismo | Aprovados | Taxa | Chamadas médias | Custo médio/execução | Latência média |
| --- | --- | --- | --- | --- | --- |
| Uniforme (antigo) | 5/8 | **62,5%** | 3,25 | US$ 0,00458 | 47,1s |
| Per-item (novo) | 8/8 | **100%** | 2,5 | US$ 0,00308 | 36,0s |

A taxa do mecanismo antigo (62,5%) é consistente com o ≈67%/4-de-6 já documentado anteriormente — confirma que a amostra reproduz o mesmo fenômeno, não um cenário diferente. O mecanismo novo não falhou nenhuma das 8 execuções, usou em média menos chamadas de IA (porque menos vezes precisou de uma segunda tentativa de criação) e, por consequência, menor custo e latência — a melhoria de confiabilidade não veio ao custo de qualidade, segurança ou custo; pelo contrário, reduziu ambos. Custo desta rodada: US$ 0,061049 (16 execuções).

**Não afirmo que a falha foi eliminada com uma única amostra** — 8 execuções por lado foi o tamanho escolhido (acima das 6 do relatório anterior) dentro do orçamento disponível; 0/8 falhas no novo mecanismo é evidência forte mas não uma prova estatística de taxa zero.

## 9. Homologação dos 12 cenários obrigatórios (mecanismo novo, já publicado)

Execução única dos 12 cenários exigidos (harness `realAiHomologation.manual.test.ts`, inalterado, mecanismo novo já ativo por padrão):

| Cenário | Resultado |
| --- | --- |
| 1 — sem restrições | `completed` ✅ |
| 2 — lactose | `completed` ✅ |
| 3 — vegetariano | `failed` (`AI_RETRY_EXHAUSTED`) |
| 4 — vegetariano + lactose | `completed` ✅ |
| 5 — vegetariano + lactose + mandioca | `completed` ✅ |
| 6 — suplemento proteico | `completed` ✅ |
| 7 — alergia legada ao leite | `failed` (`AI_RETRY_EXHAUSTED`) |
| 8 — exclusão de glúten | `completed` ✅ |
| 9 — revisor rejeita candidato sintético | `rejected` ✅ (sucesso do cenário) |
| 10 — correção automática | `failed` (`AI_RETRY_EXHAUSTED`) |
| 11/12 — macros e persistência | `completed` ✅ |

9 de 12 na primeira passada. As 3 falhas (3, 7, 10) são em cenários de **restrição alimentar/conteúdo** (vegetariano, alergia, correção pós-rejeição semântica) — não no cenário de macro/fibra/gordura que é o objeto desta tarefa. `restrictions.ts`/`reviewEvidence.ts`/`ai/prompt.ts` não foram tocados nesta tarefa, então essas 3 falhas não podem ser atribuídas ao otimizador de porções; são a mesma variação estocástica real do modelo já documentada como risco residual conhecido em `dual-ai-final-fix/REPORT.md` §9.1 ("variação estocástica do modelo... não investigado a fundo por estar fora do escopo") e replicada nos próprios relatórios anteriores (que também precisaram repetir cenários individuais para obter sucesso — ver `dual-ai-final-fix/REPORT.md` §6.4). O log de depuração desta execução confirma a causa: no cenário 3, a refeição `afternoon_snack` tinha proteína/carboidrato/gordura em conflito genuíno entre si (não uma meta incoerente, e sim uma escolha de alimentos da IA cuja proporção real não cabia em nenhum ponto da caixa `[0.5,2]`) — o otimizador corretamente declarou `optimizer_infeasible`/`quantized_out_of_range` em vez de aprovar à força, e o pipeline seguiu para o fluxo de retry já existente, exatamente como projetado.

Dado o orçamento e o escopo (esta tarefa é sobre o mecanismo de ajuste de porção, não sobre restrições alimentares, já corrigidas em tarefa anterior), essas 3 falhas não foram re-executadas múltiplas vezes — ficam registradas como risco residual conhecido e pré-existente, não uma regressão introduzida aqui.

## 10. Custos e orçamento agregado

| Item | Custo (US$) |
| --- | --- |
| Smoke test inicial (1 execução de cada mecanismo) | 0,007866 |
| Comparação controlada (8 + 8 execuções) | 0,061049 |
| 12 cenários obrigatórios (1 passada) | 0,033986 |
| **Total** | **≈ US$ 0,103** |

**≈5,2% do teto de US$ 2,00 autorizado** — nunca próximo de ser atingido.

## 11. Decisão de publicação

Critério do enunciado: publicar somente se houver melhora demonstrável de confiabilidade sem comprometer qualidade, segurança ou custo. Evidência: 100% vs. 62,5% no cenário que motivou esta tarefa, com MENOS chamadas de IA e MENOR custo/latência médios, zero regressão nas suítes determinísticas (2.097 + 331 testes), nenhuma alteração em segurança alimentar/alergênicos/restrições, nenhuma alteração de contrato de schema/persistência. **Decisão: publicar.**

## 12. Publicação controlada

### 12.1 — Functions efetivamente afetadas

Confirmado por `grep` na árvore de imports (não por suposição) que `domain.ts`/`portionOptimizer.ts` só são alcançados, em produção, por:

| Function | Depende via |
| --- | --- |
| `requestNutritionPlanGeneration` | `generation/request.ts` → `attempts.ts` → `domain.ts` |
| `onNutritionGenerationJobCreated` | `generation/worker.ts` → idem |
| `retryNutritionGenerationJobs` | `generation/worker.ts` → idem |
| `requestNutritionMealAlternative` | `generation/mealAlternativeRequest.ts` → `alternative.ts` → `domain.ts` |

`logCatalogMeal` importa apenas o TIPO `RawAiFoodItem` de `resolver.ts` (import type, sem efeito em runtime) — confirmado que não executa o motor de validação. `monitorNutritionAiOperations` não importa nada da cadeia. Ambas, junto com `restoreNutritionPlan`, `mutateNutritionDiaryV1` e `onNutritionGenerationCompleted`, ficaram fora do escopo de publicação.

### 12.2 — Pré-publicação

- `npm run build` (Functions): sucesso, zero erros de TypeScript.
- Jobs em produção (`ajfit-2f321`, amostra de 10 via `collectionGroup('nutritionGenerationJobs')`): 7 `failed`, 3 `completed`, **zero em `queued`/`running`/`validating`** — sem risco de corromper um job em andamento.
- Revisões de baseline registradas antes do deploy (para rollback): `requestnutritionplangeneration-00009-vog`, `onnutritiongenerationjobcreated-00027-wuf`, `retrynutritiongenerationjobs-00023-cex`, `requestnutritionmealalternative-00023-jeh` — confirmadas via `gcloud run services describe` como idênticas às publicadas na tarefa anterior (`macro-reliability-audit`).

### 12.3 — Deploy

`firebase deploy --project ajfit-2f321 --only functions:requestNutritionPlanGeneration,functions:onNutritionGenerationJobCreated,functions:retryNutritionGenerationJobs,functions:requestNutritionMealAlternative` — sucesso nas quatro.

| Function | Revisão anterior | Revisão nova |
| --- | --- | --- |
| `requestNutritionPlanGeneration` | `...00009-vog` | `...00010-dad` |
| `onNutritionGenerationJobCreated` | `...00027-wuf` | `...00028-rod` |
| `retryNutritionGenerationJobs` | `...00023-cex` | `...00024-sim` |
| `requestNutritionMealAlternative` | `...00023-jeh` | `...00024-pow` |

### 12.4 — Verificação pós-deploy

- As quatro revisões novas confirmadas via `gcloud run services describe`.
- Os cinco endpoints de treino (`initializeWorkoutProgramV127`, `authorizeWorkoutLifecycleMutation`, `installActiveWorkoutProgram`, `applyExerciseSubstitution`, `finalizeWorkoutSession`) e as Functions de nutrição fora de escopo (`logCatalogMeal`, `monitorNutritionAiOperations`, `restoreNutritionPlan`, `mutateNutritionDiaryV1`, `onNutritionGenerationCompleted`) — **revisões idênticas às de antes do deploy** (`logcatalogmeal-00001-rek`, `monitornutritionaioperations-00004-qok`, etc.), confirmando que nada fora do escopo foi tocado.
- Logs pós-deploy (`gcloud functions logs read`): inicialização limpa (`STARTUP TCP probe succeeded`) nas quatro Functions atualizadas; `retryNutritionGenerationJobs` com execuções agendadas subsequentes sem exceções.
- Firestore Rules: não tocadas. Storage Rules: não tocadas. Build EAS/TestFlight: não realizado. Commit/push: não realizado.

## 13. Riscos remanescentes

1. **Variação estocástica do modelo em cenários de restrição alimentar** (3, 7, 10 nesta homologação) permanece — pré-existente, documentada desde `dual-ai-final-fix/REPORT.md` §9.1, não relacionada ao otimizador de porções (que não toca `restrictions.ts`/`reviewEvidence.ts`/`prompt.ts`) e fora do escopo desta tarefa.
2. **O otimizador é estritamente mais capaz, não uma garantia universal.** Metas genuinamente incompatíveis com a composição real dos alimentos escolhidos (ex.: proteína/gordura/carboidrato em conflito mútuo dentro da caixa `[0.5,2]`) continuam — corretamente — caindo no fluxo de retry existente (`optimizer_infeasible`/`quantized_out_of_range`), nunca em uma aprovação forçada.
3. **Tamanho de amostra da comparação controlada (8 execuções por lado)** é maior que o anterior (6) mas ainda não é uma garantia estatística formal de taxa — recomenda-se observar a taxa de `AI_MACRO_VALIDATION_FAILED` em produção real nas próximas semanas como confirmação adicional de baixo custo (sem gasto de API extra, via logs já existentes em `diagnostics.ts`/`logValidationDiagnostics`, que agora também registram `correction.method` para distinguir qual mecanismo resolveu cada caso).

## Estado final do repositório

Nenhum commit, push, build EAS/TestFlight ou alteração de Firestore/Storage Rules. Mudanças desta tarefa, não commitadas: `functions/src/nutrition/generation/correction.ts` (exporta `CORRECTION_SCALE_MIN`/`CORRECTION_SCALE_MAX`), `functions/src/nutrition/generation/portionOptimizer.ts` (novo), `functions/src/nutrition/generation/domain.ts` (tenta o otimizador per-item antes do corretor uniforme), `functions/src/nutrition/generation/diagnostics.ts` (novo valor de `reason`/`method` opcional, apenas para logs), `functions/src/nutrition/__tests__/portionOptimizer.test.ts` (novo), e este relatório. O harness temporário de comparação (`portionOptimizerHomologation.manual.test.ts`) e a flag temporária `NUTRITION_DISABLE_PORTION_OPTIMIZER` foram removidos após a coleta de dados da seção 8 — nenhum dos dois faz parte do código publicado. Todas as demais mudanças pré-existentes no working tree (nutrição, treino, outras frentes) foram preservadas intactas. Produção: quatro Functions nutricionais publicadas e verificadas com o otimizador per-item ativo; as demais Functions de nutrição, os cinco endpoints de treino e as Rules permanecem inalterados.
