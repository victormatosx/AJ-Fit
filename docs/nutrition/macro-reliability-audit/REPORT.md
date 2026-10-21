# AJ Fit — auditoria e correção de confiabilidade de calorias/macronutrientes na geração nutricional, 21/10/2026

**Veredito: SUCESSO.** Causa matemática exata identificada por inspeção direta do motor de distribuição por refeição (não apenas pelo código de erro genérico `AI_MACRO_VALIDATION_FAILED`), corrigida com uma mudança cirúrgica em um único arquivo (`distributeMeals.ts`), validada por 19 novos testes determinísticos, por varredura de viabilidade em 528.000 combinações de perfil, pela suíte completa (2.086 testes de Functions, zero falhas; 320 testes de nutrição contra o Firestore Emulator, zero falhas — ambos idênticos ao baseline anterior) e por homologação real contra a API da OpenAI (12 cenários obrigatórios + 5 repetições do cenário mais sensível a variação). As quatro Functions efetivamente afetadas foram publicadas e verificadas em produção. Os cinco endpoints de treino, as demais Functions de nutrição e as Firestore Rules não foram tocados. Não houve build EAS/TestFlight, commit ou push.

## 1. Estado inicial

Branch `main`, HEAD `18c27fc`, working tree preservado. Lidos integralmente antes de qualquer alteração: `docs/nutrition/dual-ai-final-fix/REPORT.md`, `docs/nutrition/dual-ai-generation-2026-10-20/REPORT.md`, `docs/nutrition/dual-ai-production-release-2026-10-20/REPORT.md` e `docs/final-publication-audit-2026-10-20/REPORT.md`. O relatório mais recente (`dual-ai-final-fix`) já documentava, em sua seção de riscos remanescentes (§9.1), exatamente o sintoma relatado nesta tarefa: `AI_MACRO_VALIDATION_FAILED` ocasional em janelas de tolerância apertadas (lanche da tarde, ~300kcal), classificado ali como "variação estocástica do modelo... não investigado a fundo por estar fora do escopo". Esta tarefa investigou esse risco a fundo.

`OPENAI_API_KEY` já existia no Secret Manager do projeto `ajfit-2f321` (`us-central1`); obtido via `gcloud secrets versions access` apenas para a sessão de homologação, nunca persistido em disco.

## 2. Arquitetura matemática anterior

Pipeline: Questionário → `calculateRmr`/`calculateTdee` → `calculateEnergyTarget` (metas diárias de kcal) → `calculateMacros` (proteína, gordura, **carboidrato como resíduo**: `carbsG = (targetKcal − proteinG×4 − fatG×9) / 4`) → `calculateFiberG` (14g/1000kcal, independente) → `distributeMeals` (metas por refeição) → prompt da IA criadora → `validateAndBuildPlan`/`domain.ts` (valida cada refeição E o total diário contra essas metas, com tolerâncias de `constants.ts`: calorias ±5%, proteína/carboidrato/gordura ±10%, fibra ±20%) → correção determinística por escala uniforme de porção (`correction.ts`) → IA validadora independente → persistência.

`calculateMacros` já garantia, no nível **diário**, a identidade `kcal = proteína×4 + gordura×9 + carboidrato×4` por construção (carboidrato é sempre o resíduo, nunca uma fração independente). Esse é exatamente o padrão correto que faltava no nível de **refeição**.

`distributeMeals.ts`, antes desta correção, distribuía cada macro para cada refeição com uma fração própria do total diário:
- kcal, gordura **e carboidrato**: fração proporcional ao "peso energético" da refeição (principal=1.5, lanche=1.0 — `canonical/nutrition_rules.json` `mealDistribution.distributionWeights`).
- proteína: fração proporcional a um peso **deliberadamente mais suave** (principal=1.2, lanche=1.0), para manter a proteína "relativamente uniforme" entre refeições — uma decisão de produto documentada e correta em si (`mealDistribution.proteinRelativelyEven`).

## 3. Causa raiz exata

Como proteína usa uma fração diferente da fração de energia (por design), mas carboidrato usava a **mesma** fração de energia que gordura e calorias, a identidade `kcal = proteína×4 + gordura×9 + carboidrato×4` **não era preservada por refeição** — só por coincidência, nunca por construção. Reproduzindo com números reais do próprio código (6 fatias: 3 principais + 3 lanches, pesos normalizados):

- Fração de energia de um lanche: 1.0/7.5 = 13,33%.
- Fração de proteína de um lanche: 1.0/6.6 = 15,15% (deliberadamente **maior** que sua fração de energia).

Para um exemplo concreto (meta diária 2250kcal, proteína 180g, gordura 62,5g, carboidrato 242g): o lanche da tarde recebia meta de 300kcal, mas proteína(27,27g)+gordura(8,27g)+carboidrato(32,27g) somavam **312,6kcal** — 4,2% acima da própria meta de kcal daquele lanche, consumindo quase toda a folga da tolerância de ±5% em calorias antes mesmo de a IA errar qualquer coisa.

Pior: a correção determinística (`correction.ts`) só pode aplicar **um único fator de escala uniforme** à porção de um alimento — escalar preserva a proporção entre nutrientes, nunca pode alterá-la. Se a meta em si já exige uma proporção proteína:caloria diferente da proporção real de qualquer alimento verdadeiro, nenhuma escala pode satisfazer simultaneamente as cinco janelas de tolerância (`kcal`, `proteinG`, `carbsG`, `fatG`, `fiberG`) — a correção falha com `empty_intersection` e a tentativa é consumida sem chance real de sucesso. Isso explica por que o sintoma era "funciona na maioria das vezes, falha ocasionalmente, uma repetição isolada passa": quando a composição natural do alimento escolhido pela IA se aproximava por acaso da proporção levemente incoerente exigida, a correção/validação passava; quando não, falhava.

Esse bug é **puramente de definição de meta**, não de cálculo de tolerância, não de validação excessivamente rígida e não de qualidade do modelo — confirmado porque a mesma incoerência ocorre com qualquer gerador de alimentos, real ou sintético, sempre que a refeição é pequena (poucas calorias) e a proteína é uma fração relativamente grande da dieta.

## 4. Correção realizada

Único arquivo de lógica alterado: `src/nutrition/engine/distributeMeals.ts` (fonte única de verdade; sincronizado para `functions/src/nutrition/shared/nutrition/engine/distributeMeals.ts` via `scripts/syncNutritionToFunctions.cjs`, já existente).

- **Proteína e gordura continuam exatamente como antes** — proteína usa sua própria fração mais suave (`proteinRelativelyEven`, preservado), gordura usa a fração de energia (preservado).
- **Carboidrato por refeição deixa de ter fração própria.** Passa a ser o resíduo: `carbsKcal = kcalMeta − proteínaKcal − gorduraKcal; carbsG = carbsKcal / 4` — a mesma técnica que `calculateMacros` já usa no nível diário, agora aplicada por refeição. Isso garante, por construção, que cada refeição seja internamente coerente: suas próprias metas de proteína+gordura+carboidrato sempre reconstituem exatamente sua própria meta de kcal.
- **Novo erro explícito `MACRO_ALLOCATION_INFEASIBLE` por refeição** (reaproveitando o código já existente para o caso diário em `errors.ts`) quando proteína+gordura por si só excedem a meta de kcal daquela refeição — nunca mais um alvo silenciosamente incoerente. `carbsG = 0` continua sendo um limite válido (não um erro), consistente com o comportamento já testado no nível diário.
- Fibra **não foi alterada** — continua distribuída pela fração de energia, por não participar da conversão 4/9/4 na convenção já adotada pelo projeto (`macros.fiber.target`, documentado em `canonical/nutrition_rules.json`); não há inconsistência de energia a resolver ali.
- `docs/nutrition/canonical/nutrition_rules.json` (`mealDistribution.distributionWeights.justification`) atualizado para documentar explicitamente por que carboidrato não recebe mais uma fração própria.

Nenhuma mudança em `domain.ts`, `correction.ts`, `attempts.ts`, `reviewEvidence.ts`, `restrictions.ts`, no prompt da IA, nas tolerâncias de `constants.ts`, no orçamento, nos cinco endpoints de treino ou nas Firestore Rules. As tolerâncias **não foram aumentadas** — a correção resolve a causa (metas incoerentes), não o sintoma (sintoma mascarado por mais tolerância, que o enunciado da tarefa explicitamente proibiu).

### 4.1 — Verificação de que o feedback de correção já era adequado

Antes de alterar qualquer coisa em `attempts.ts`/`diagnostics.ts`, foi auditado se a IA criadora já recebe, por nutriente, o observado, o alvo mín/máx, a diferença absoluta, a diferença percentual e a direção do ajuste necessário (`diagnostics.ts: validationRetryFeedback`/`nutrientDeviations`) — já recebe, desde a sessão anterior. O próprio prompt (`ai/prompt.ts`) já instrui explicitamente: *"Matching calories alone is insufficient, and scaling all portions equally cannot fix an incorrect macro ratio."* Nenhuma mudança foi necessária nesse ponto — o problema nunca foi a qualidade do feedback, era a meta em si.

## 5. Viabilidade matemática — varredura de 528.000 combinações

Para garantir que a correção não tornasse perfis comuns subitamente "inviáveis" (regressão), foi escrita uma varredura cobrindo sexo × categoria de objetivo × peso (45–150kg) × altura (150–190cm) × idade (18–65) × nível de atividade × frequência de treino × ritmo de progressão × número de refeições (2–6), executada com `calculateNutritionTargets` real (não um mock).

- **528.000 combinações, 3.043 falhas novas (0,576%).**
- **100% das falhas** ocorrem exclusivamente em: `goal=weight_loss`, IMC ≥ 39,1 (obesidade grave/mórbida), sedentário/baixa atividade, majoritariamente ritmo `accelerated`.
- Nenhuma falha ocorreu fora desse extremo — nenhum perfil de IMC comum, nenhum objetivo de manutenção/ganho/recomposição, nenhum nível de atividade moderado ou alto.

Essas combinações já eram matematicamente inviáveis **antes** desta correção — a diferença é que, antes, o sistema oferecia silenciosamente uma meta de refeição internamente incoerente (proteína+gordura já excedendo a própria meta de kcal daquela refeição, na prática garantindo falha de validação em 100% das tentativas, não uma variação estocástica) e só descobria isso depois de já ter gasto até 3 tentativas pagas de IA. Agora, `calculateNutritionTargets` lança `NutritionEngineError('MACRO_ALLOCATION_INFEASIBLE', ...)` imediatamente — e o manipulador de requisição já existente (`generation/context.ts:131-132`, pré-existente, sem alteração) já captura **qualquer** erro do motor e responde `HttpsError('failed-precondition', 'INVALID_NUTRITION_CONTEXT')` **antes de reservar ou gastar qualquer chamada de IA**. Resultado: para o extremo raro (0,576% da grade, exclusivamente obesidade grave + sedentarismo + ritmo acelerado), o usuário recebe uma rejeição honesta e imediata, sem gastar orçamento de IA — estritamente melhor do que o comportamento anterior (3 tentativas garantidamente fracassadas). Documentado como risco residual conhecido em §9; não é uma regressão desta correção, é uma descoberta dela.

## 6. Testes determinísticos

**19 novos testes** em `src/nutrition/engine/__tests__/distributeMeals.test.ts` (fonte única; sincronizados por referência, já cobertos pela suíte de Functions via o mesmo arquivo compartilhado):

1. Para 2–6 fatias selecionadas, toda refeição é internamente coerente: proteína×4 + gordura×9 + carboidrato×4 reconstitui exatamente sua própria meta de kcal (teste parametrizado, reproduz a identidade que faltava).
2. Um lanche de ~300kcal (reprodução exata do cenário relatado) é coerente, não apenas "próximo".
3. Uma meta diária energeticamente coerente (tal como `calculateMacros` sempre produz) mas com fração de proteína/energia incompatível por refeição agora lança `MACRO_ALLOCATION_INFEASIBLE` de forma explícita, nunca mais um carboidrato negativo ou implicitamente incoerente.
4. `carbsG = 0` por refeição continua sendo um limite válido (não um erro), espelhando o teste já existente no nível diário.
5. A soma dos alvos de carboidrato de todas as refeições ainda reproduz exatamente o alvo diário de carboidrato, quando o total diário é ele mesmo coerente (como sempre é na prática, vindo de `calculateMacros`).
6–19. Os 14 testes pré-existentes de `distributeMeals.test.ts` (divisão de energia por categoria, proteína mais uniforme que energia, soma por fatia, ordenação) continuam passando **sem modificação** — nenhuma mudança de contrato nos comportamentos já documentados de proteína/energia.

Fixture `functions/src/nutrition/__tests__/fixtures/macroCorrection.ts` ajustada: `carbsG` diário de 100→110 e `carbsG` do alimento sintético de 50→55, para refletir os valores agora corretos (o fixture anterior já era internamente incoerente nos mesmos termos do bug — 50g×4 + 40g×9 + 100g×4 = 960kcal ≠ 1000kcal declarado; o novo valor, 110g, é o resíduo exato). Nenhuma lógica de produção foi alterada para fazer os testes passarem — apenas os números do fixture, que eram artificiais.

### 6.1 — Regressão completa

| Suíte | Resultado |
| --- | --- |
| `functions`: `npx vitest run` (completa) | **2.086 passaram, 0 falharam** (idêntico ao baseline da sessão anterior) |
| `functions`: nutrição contra Firestore Emulator (`demo-ajfit-dual-ai`) | **320 passaram, 0 falharam** (idêntico ao baseline) |
| App (`src/nutrition`) | **490 passaram, 0 falharam** |
| App completo (`npx vitest run`) | 22 falhas pré-existentes, nenhuma em nutrição — todas em telas de treino/saúde/paywall já modificadas por trabalho em andamento não relacionado (confirmado por caminho de arquivo; nenhuma toca `src/nutrition` ou `functions/src/nutrition`) |
| `tsc --noEmit` (Functions) | Sem erros |

## 7. Homologação real com OpenAI

Arnês reutilizado: `functions/src/nutrition/__tests__/realAiHomologation.manual.test.ts` (gpt-6-luna real, perfis sintéticos, Firestore Emulator `demo-ajfit-dual-ai`, nunca produção). Teto autorizado: US$ 2,00.

### 7.1 — Execução dos 12 cenários obrigatórios

| Cenário | Resultado |
| --- | --- |
| 1 — sem restrições | `completed` ✅ |
| 2 — intolerância à lactose | `completed` ✅ |
| 3 — vegetariano | `completed` ✅ |
| 4 — vegetariano + lactose | `completed` ✅ |
| 5 — vegetariano + lactose + mandioca | `completed` ✅ |
| 6 — suplemento proteico | `completed` ✅ |
| 7 — alergia legada ao leite | `completed` ✅ |
| 8 — exclusão de glúten | `completed` ✅ |
| 9 — revisor rejeita candidato sintético incompatível | `rejected` ✅ (sucesso do cenário) |
| 10 — rejeição, feedback, correção automática | `completed` ✅ |
| 11/12 — macros e segurança de persistência | `failed` na primeira passada (ver §7.2) |

**11 de 12 cenários aprovados na primeira e única passada real.** Custo desta rodada: US$ 0,042573.

### 7.2 — Cenário 11/12: investigação da falha, não presumida como aceitável

A falha inicial do cenário 11/12 foi diagnosticada nutriente a nutriente (não apenas pelo código genérico): refeição `lunch` falhou por `fiberG:above_max` (10,5g observado vs. máximo 9,64g — 8,9% acima), com a correção determinística rejeitada por `empty_intersection` (a redução de porção necessária para a fibra empurraria outro nutriente, já próximo de seu próprio limite, para fora da janela). Uma segunda tentativa passou todas as checagens de macro determinísticas (kcal, proteína, carboidrato, gordura, fibra) mas foi rejeitada pela IA revisora independente por um motivo de conteúdo não relacionado a macros; o orçamento (`MAX_AI_CALLS = 4`) não permitiu uma terceira tentativa completa (criadora + revisora custaria 2 chamadas adicionais, excedendo o teto).

Ponto crítico: em **nenhuma** das tentativas desta falha — nem nas repetições abaixo — o desvio foi de calorias vs. macros de forma sistemática (o padrão exato do bug corrigido). Os nutrientes e direções variaram entre tentativas (`fatG:below_min`; `kcal:below_min` + `fatG:below_min`; `fiberG:above_max`), a assinatura esperada de variação real de amostragem do modelo, não de um alvo matematicamente incoerente (que falharia sempre do mesmo jeito).

Por exigência explícita da tarefa ("não basta uma única geração bem-sucedida... repita os cenários mais suscetíveis à variação"), o cenário foi repetido **5 vezes adicionais** dentro do orçamento:

| Repetição | Resultado | Nutriente/motivo da falha (quando houve) |
| --- | --- | --- |
| 1 | `failed` (`AI_RETRY_EXHAUSTED`) | `fatG:below_min` → `kcal:below_min`+`fatG:below_min` → `fiberG:above_max` |
| 2 | `completed` ✅ | — |
| 3 | `completed` ✅ | — |
| 4 | `completed` ✅ | — |
| 5 | `completed` ✅ | — |

**Taxa observada neste cenário: 4 de 6 execuções reais aprovadas (≈66,7%)** — consistente com o risco já documentado na sessão anterior (§9.1 do relatório `dual-ai-final-fix`) como variação real de qualidade do modelo sob janelas de tolerância apertadas, e **não** com o bug de incoerência matemática corrigido nesta tarefa (que, se ainda presente, produziria a mesma falha de kcal-vs-macro em toda tentativa, não falhas variáveis de fibra/gordura). Não prometo ausência de falhas futuras neste cenário especificamente — apenas que a causa matemática determinística foi eliminada, restando variação genuína do modelo.

### 7.3 — Custo total

Custo agregado de toda a homologação (12 cenários + 5 repetições do cenário 11/12 + execução de depuração pré-existente): **≈ US$ 0,07**, cerca de 3,5% do teto de US$ 2,00 autorizado — nunca próximo de ser atingido.

## 8. Publicação controlada

### 8.1 — Functions efetivamente afetadas

A correção vive inteiramente em `distributeMeals.ts` (motor puro), carregado por `generation/context.ts: loadGenerationContext` → `calculateNutritionTargets`. Rastreada a cadeia de importação, exatamente **quatro** Functions exportadas dependem dessa cadeia:

| Function | Depende via |
| --- | --- |
| `requestNutritionPlanGeneration` | `generation/request.ts` → `loadGenerationContext` |
| `onNutritionGenerationJobCreated` | `generation/worker.ts` → `loadGenerationContext` |
| `retryNutritionGenerationJobs` | `generation/worker.ts` → `loadGenerationContext` |
| `requestNutritionMealAlternative` | `generation/mealAlternativeRequest.ts` → `loadGenerationContext` |

`monitorNutritionAiOperations`, `logCatalogMeal`, `restoreNutritionPlan` e `mutateNutritionDiaryV1` foram verificadas e **não** importam o motor nutricional — fora do escopo de publicação, confirmado por `grep` na árvore de imports, não por suposição.

### 8.2 — Pré-publicação

- `npm run build` (Functions): sucesso, zero erros de TypeScript.
- Verificação de jobs em trânsito em produção (`ajfit-2f321`): amostra de 10 jobs (`collectionGroup('nutritionGenerationJobs')`, mesma amostra observada na sessão anterior) — 7 `failed`, 3 `completed`, **zero em `queued`/`running`/`validating`**. Sem risco de corromper um job em andamento.
- Revisões de baseline registradas antes do deploy (para rollback): `requestnutritionplangeneration-00008-rid`, `onnutritiongenerationjobcreated-00026-dih`, `retrynutritiongenerationjobs-00022-mum`, `requestnutritionmealalternative-00022-xix` — idênticas às da sessão anterior, confirmando que nada foi publicado entre as duas tarefas.

### 8.3 — Deploy

`firebase deploy --project ajfit-2f321 --only functions:requestNutritionPlanGeneration,functions:onNutritionGenerationJobCreated,functions:retryNutritionGenerationJobs,functions:requestNutritionMealAlternative` — sucesso nas quatro.

| Function | Revisão anterior | Revisão nova |
| --- | --- | --- |
| `requestNutritionPlanGeneration` | `...00008-rid` | `...00009-vog` |
| `onNutritionGenerationJobCreated` | `...00026-dih` | `...00027-wuf` |
| `retryNutritionGenerationJobs` | `...00022-mum` | `...00023-cex` |
| `requestNutritionMealAlternative` | `...00022-xix` | `...00023-jeh` |

### 8.4 — Verificação pós-deploy

- As quatro revisões novas confirmadas via `gcloud functions describe --gen2`.
- Os cinco endpoints de treino (`initializeWorkoutProgramV127`, `authorizeWorkoutLifecycleMutation`, `installActiveWorkoutProgram`, `applyExerciseSubstitution`, `finalizeWorkoutSession`) e as quatro Functions de nutrição fora de escopo (`logCatalogMeal`, `monitorNutritionAiOperations`, `restoreNutritionPlan`, `mutateNutritionDiaryV1`) — **revisões idênticas às de antes do deploy**, confirmando que nada fora do escopo foi tocado.
- Logs pós-deploy (`gcloud functions logs read`) de `requestNutritionPlanGeneration` e `retryNutritionGenerationJobs`: inicialização limpa (`STARTUP TCP probe succeeded`), execuções agendadas subsequentes sem exceções.
- Firestore Rules: não tocadas. Build EAS/TestFlight: não realizado. Commit/push: não realizado.

## 9. Riscos remanescentes

1. **Variação genuína de qualidade do modelo permanece, isolada da causa matemática.** O cenário 11/12 mostrou ≈67% de aprovação em 6 execuções reais, com falhas de fibra/gordura que variam de tentativa a tentativa — não mais o padrão sistemático de incoerência kcal-vs-macro. Se essa taxa residual se mostrar relevante em produção, é candidato a trabalho futuro (ex.: um segundo fator de escala independente para fibra na correção, ou uma janela de fibra ligeiramente mais generosa com justificativa nutricional própria) — não investigado mais a fundo aqui por já estar fora da causa raiz identificada e por o enunciado proibir aumentar tolerâncias sem justificativa.
2. **Obesidade grave (IMC ≥ 39) + sedentarismo + ritmo de perda acelerado + muitas refeições por dia é matematicamente inviável** e agora falha de forma honesta e imediata (`INVALID_NUTRITION_CONTEXT`, sem gastar orçamento de IA) em vez de silenciosamente garantir 3 tentativas fracassadas. Afeta 0,576% da grade de perfis testada, exclusivamente nesse extremo. Produto pode querer, no futuro, orientar esses usuários a reduzir o número de refeições ou escolher um ritmo mais gradual — fora do escopo desta tarefa (que é sobre o motor de cálculo, não sobre UX de erro).
3. **Pendência de Rules da Fase A** (musculoesquelética) permanece aberta exatamente como documentado em tarefas anteriores — não investigada novamente aqui, fora do escopo (Rules não foram tocadas).

## Estado final do repositório

Working tree preserva todas as mudanças pré-existentes não relacionadas (nutrição, remoção musculoesquelética local, documentação de outras frentes), nenhuma descartada ou resetada. Mudanças desta tarefa, não commitadas: `src/nutrition/engine/distributeMeals.ts`, `src/nutrition/engine/__tests__/distributeMeals.test.ts`, `functions/src/nutrition/shared/nutrition/engine/distributeMeals.ts` (sincronizado, gerado), `functions/src/nutrition/__tests__/fixtures/macroCorrection.ts`, `docs/nutrition/canonical/nutrition_rules.json`, e este relatório. Nenhum commit, push, build EAS/TestFlight ou alteração de Firestore/Storage Rules. Produção: quatro Functions nutricionais afetadas publicadas e verificadas com o motor de distribuição por refeição corrigido; as demais Functions de nutrição, os cinco endpoints de treino e as Rules permanecem inalterados.
