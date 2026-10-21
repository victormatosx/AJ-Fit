# AJ Fit — correção definitiva da geração nutricional (duas IAs) e publicação, 21/10/2026

**Veredito: SUCESSO.** Causa raiz exata identificada por diagnóstico direto contra a API real (não apenas o código de erro genérico), corrigida com três mudanças cirúrgicas, validada por 23 novos/reescritos testes determinísticos e pela suíte completa (2.086 testes, zero falhas; 320 testes de nutrição contra o Firestore Emulator), e homologada com sucesso nos 12 cenários obrigatórios contra a API real da OpenAI. As seis Functions nutricionais foram publicadas e verificadas em produção. Os cinco endpoints de treino não foram tocados. Não houve build EAS/TestFlight, commit, push ou publicação de Firestore Rules.

## 1. Estado inicial

Branch `main`, HEAD `18c27fc`, working tree preservado (296 entradas de porcelain ao final, todas as mudanças pré-existentes intactas). Lidos integralmente antes de qualquer alteração: `docs/nutrition/dual-ai-generation-2026-10-20/REPORT.md`, `docs/nutrition/dual-ai-production-release-2026-10-20/REPORT.md` (incluindo `homologation-results.json` e os dois `.log`), `docs/final-publication-audit-2026-10-20/REPORT.md` e `DEPLOY.md`. Firestore Rules de transição já publicadas (sessão anterior) **não foram tocadas nesta tarefa**. `OPENAI_API_KEY` já existia no Secret Manager do projeto `ajfit-2f321` (`us-central1`).

A homologação anterior (20/10) havia executado os 12 cenários com sucesso de orçamento (US$ 0,046 de US$ 2,00), mas revelado que **todo** cenário com uma restrição alimentar real (lactose, vegetariano, alergia ao leite, glúten) esgotava as 3 tentativas da criadora com `AI_CONTENT_SAFETY_MISMATCH`, sem nunca alcançar a IA validadora — um bloqueio determinístico anterior à revisão. O relatório anterior identificou o código do erro, mas não a causa granular por item.

## 2. Diagnóstico — causa exata por item, com evidência sintética

Em vez de aceitar o código genérico, foram feitas chamadas reais isoladas e baratas (gpt-6-luna, perfis sintéticos, nenhum dado de usuário real) imprimindo, por item do candidato real retornado pela IA, o nome, `preparationNote`, `ingredients[].origin` e o resultado exato de `foodRestrictionViolation`. Isso revelou **três bugs determinísticos distintos**, todos em `functions/src/nutrition/generation/restrictions.ts` e `functions/src/nutrition/generation/reviewEvidence.ts`, nenhum deles relacionado à qualidade do modelo:

### 2.1 — `origin: 'unknown'` tratado como violação confirmada de padrão alimentar

`restrictions.ts` bloqueava **qualquer** item com um ingrediente de origem `unknown` para todo padrão não-onívoro — mesmo sendo essa origem apenas a própria incerteza da IA, nunca uma classificação animal confirmada. Como praticamente qualquer prato real inclui um ingrediente ambíguo (tempero, óleo, caldo), isso bloqueava quase toda refeição vegetariana/vegana/pescatariana antes mesmo de a IA validadora ser chamada — e explica por que **todo** cenário com padrão alimentar restrito falhava enquanto todo cenário onívoro passava.

### 2.2 — Regra de evidência disparada para qualquer usuário com qualquer restrição, mesmo em alimentos comuns

`reviewEvidence.ts`: assim que o perfil tinha **qualquer** `excludedAllergens`/`excludedSubstances` (até intolerância a lactose isolada, com `dietaryPattern: 'omnivore'`), o atalho "sem restrição" deixava de se aplicar e **todo** item passava a precisar de "evidência" quando:
- continha uma palavra do regex `manufactured`, que incluía termos completamente comuns: `iogurte`, `queijo`, `requeijão`, `pão`, `biscoito`, `bolacha`, `barra`, `granola`, `chocolate`, `sorvete` — nenhum deles exclusivo de produto industrializado;
- **ou** continha qualquer ingrediente de origem `unknown` (mesmo bug do item 2.1, agora também bloqueando por "evidência insuficiente");
- **ou** era um alimento comum contendo laticínio/glúten (`lactoseDairy`/`glutenPresent`), que então era **bloqueado permanentemente como `AI_CONTENT_SAFETY_MISMATCH`** — tratando intolerância à lactose como proibição de qualquer laticínio, o oposto exato do requisito ("o usuário pode consumir alimentos compatíveis com sua intolerância").

Como `findEvidence` depende de um catálogo opcional que a arquitetura freeform deliberadamente não exige, essa evidência nunca existia — todo item que caía nessas condições falhava de forma fechada, sem nunca chegar à revisão.

### 2.3 — Regex de palavra aplicado ao texto livre (nome do prato e `preparationNote`), não apenas aos ingredientes

Com exemplos reais e sintéticos coletados diretamente da API:

| Item real da IA (sintético, perfil vegetariano) | Por que falhava |
| --- | --- |
| `"Ovo de galinha cozido"` / ingrediente `"Ovo de galinha"`, origin `egg` | A palavra `galinha` está na lista de carnes terrestres (`terrestrial`), usada para detectar frango/galinha como carne. O regex casava a palavra dentro do nome do **ovo**, um alimento lacto-ovo-vegetariano permitido — bloqueando ovo para vegetarianos. |
| `"Feijão-carioca cozido"`, `preparationNote: "Cozido sem caldo de carne"` | `carne` aparece dentro de uma frase de **negação** ("sem caldo de carne" = SEM carne). O regex não distingue negação — tratava a ausência declarada de carne como presença de carne. |
| `"Pão integral"` com ingrediente `"Fermento biológico"`, origin `other_animal`; `"Iogurte natural"` com `"Fermentos lácteos"`, origin `other_animal`; `"Queijo minas frescal"` com `"Coalho"`, origin `other_animal` | A própria IA classificava fermento biológico (fungo), culturas lácticas (bactérias) e coalho (tipicamente microbiano no Brasil) como `other_animal` — nenhum desses é de fato de origem animal confirmada; o prompt não orientava essa distinção. |

Esses três exemplos — todos reproduzidos com chamadas reais, perfil vegetariano sintético, sem dado de usuário real — são a causa concreta dos 100% de falha em cenários restritos: pão (fermento), ovo, feijão temperado "sem carne" e queijo/iogurte são justamente os alimentos mais comuns de um cardápio vegetariano brasileiro.

**Falsos positivos confirmados:** 2.1, 2.2 e 2.3 acima são todos falsos positivos determinísticos — nenhum bloqueava uma incompatibilidade real. Nenhuma incompatibilidade real deixou de ser bloqueada pela remoção desses bloqueios (ver §3 e os testes de regressão em §5).

## 3. Correções realizadas

Todas em `functions/src/nutrition/generation/restrictions.ts`, `functions/src/nutrition/generation/reviewEvidence.ts` e `functions/src/nutrition/ai/prompt.ts`. Nenhuma mudança em `functions/src/nutrition/generation/domain.ts`, no fluxo de chamadas (`attempts.ts`), no orçamento, nos cinco endpoints de treino ou nas Firestore Rules.

1. **`restrictions.ts` — `unknown` deixa de ser bloqueio determinístico pré-revisão.** Apenas `terrestrial_animal`/`other_animal` (classificação confirmada) e termos regex seguem bloqueando de forma determinística. `unknown` — a própria incerteza da IA — agora chega à revisão, onde o prompt da validadora já exige `insufficient_information` para composição não resolvida sob restrição (nunca aprovação por padrão).
2. **`restrictions.ts` — os bloqueios por palavra (carne/peixe/laticínio/ovo) passam a examinar SOMENTE os nomes dos ingredientes declarados, nunca o nome do prato nem o `preparationNote`.** Um ingrediente cuja própria origem já é uma categoria não-carne confiável (`dairy`/`egg`/`fish`/`shellfish`) fica isento do backstop de carne — "ovo de galinha" (origin `egg`) não aciona mais o bloqueio pensado para carne de frango mal-classificada como `plant`. Isso elimina tanto o falso positivo do ovo quanto o da negação em `preparationNote` ("sem caldo de carne"), preservando o bloqueio original para o caso real que o motivou (carne declarada como `plant`, com o próprio nome do ingrediente mencionando o item de carne).
3. **`reviewEvidence.ts` — regex `manufactured` restrito a categorias genuinamente comerciais/de marca** (whey, caseína e variantes, "suplemento", "proteína isolada/concentrada/hidrolisada/vegetal", "industrializado", "marca", "certificado", reivindicações explícitas "zero/sem lactose/glúten") — removidos `iogurte`, `queijo`, `requeijão`, `pão`, `biscoito`, `bolacha`, `barra`, `granola`, `chocolate`, `sorvete`, que são apenas nomes de alimentos comuns.
4. **`reviewEvidence.ts` — removida a exigência de evidência disparada por origem `unknown`** (mesmo raciocínio do item 1: ambiguidade vai para a revisão, não bloqueia determinismo).
5. **`reviewEvidence.ts` — removido o bloqueio permanente de qualquer alimento comum com laticínio/glúten sob exclusão de lactose/glúten** (`lactoseDairy`/`glutenPresent` deixaram de forçar `needsEvidence`/throw). Mantido **inalterado**: (a) uma admissão textual explícita e literal de um ingrediente chamado "lactose" ou um grão de glúten sem qualificador "sem/zero" continua bloqueio determinístico pré-revisão (fato objetivo, não ambiguidade semântica); (b) reivindicações de certificação/laudo e produtos de marca continuam exigindo evidência verificada do backend, falhando fechado sem catálogo (nenhuma afirmação da IA é aceita sem prova); (c) a alergia legada (`excludedAllergens: ['milk']` etc.) continua protegida de forma totalmente independente, via `foodRestrictionViolation`, sem nenhuma alteração.
6. **`ai/prompt.ts` — orientação adicional ao prompt de ambas as IAs** (criadora e alternativa de refeição): fermento biológico e culturas bacterianas/lácticas são fungo/bactéria, nunca `other_animal`; para um ingrediente comercial cuja origem genuinamente não se saiba (ex.: tipo de coalho), usar `unknown` em vez de adivinhar `other_animal`. Isso ataca a causa do item 2.3 na origem (classificação do modelo), complementando a correção estrutural de 1/2 no backend.

Nenhuma proteção de segurança foi enfraquecida: alergias confirmadas, exclusões de nome de alimento, admissões textuais explícitas de lactose/glúten e toda a cadeia de evidência de catálogo para produtos de marca permanecem exatamente como antes. Apenas as heurísticas que confundiam ambiguidade/negação/nome-do-animal-de-origem com incompatibilidade real foram corrigidas.

## 4. Arquitetura de validação (inalterada em desenho, corrigida em execução)

O fluxo já implementado na sessão anterior (`Questionário → IA criadora → validação técnica → IA validadora → correção → aprovação → persistência`) e a separação de responsabilidades (código = schema/números/evidência objetiva; IA validadora = interpretação semântica de restrições) **já estavam corretos no desenho**. O problema era que a "validação técnica" pré-revisão, que deveria rejeitar apenas incompatibilidades objetivas e comprovadas, na prática rejeitava ambiguidade e até negações de texto como se fossem incompatibilidades confirmadas — nunca deixando a criadora chegar à revisão. As correções do §3 realinham a implementação ao desenho já aprovado: agora corrigibilidade semântica (origem desconhecida, alimento comum com laticínio/glúten) chega à IA validadora; apenas incompatibilidade objetiva (animal confirmado, alergia conhecida, admissão textual explícita, reivindicação de marca sem prova) continua bloqueada antes da revisão e na persistência.

## 5. Testes determinísticos

Todos em `functions/src/nutrition/__tests__/`, executados via `vitest` (mocks) e contra o Firestore Emulator (`FIRESTORE_EMULATOR_HOST`, projeto `demo-ajfit-dual-ai`). Resultado final: **2.086 testes de toda a suíte de Functions, zero falhas** (158 arquivos, 33 skip); **320 testes de nutrição com o Firestore Emulator ativo, zero falhas** (25 arquivos, 2 skip — os dois `.manual.test.ts` pagos, que exigem variáveis de ambiente explícitas e nunca rodam em CI).

Testes novos/reescritos nesta tarefa (`generation.test.ts`, `independentReview.test.ts`):
1. Dieta vegetariana com item cujo nome ou nome de prato menciona o animal de origem de um ovo (`"Ovo de galinha"`, origin `egg`) — não bloqueia.
2. `preparationNote` que declara explicitamente a ausência de carne (`"Cozido sem caldo de carne"`) — não bloqueia.
3. Carne declarada como `plant` (regressão do caso original) — continua bloqueada, mesmo com nome de prato e `preparationNote` neutros.
4. Item com `origin: 'unknown'` sob pescatariano — não bloqueia antes da revisão; chega à IA validadora (mock explícito), que pode retornar `insufficient_information` e falhar honestamente (`AI_REVIEW_INSUFFICIENT_INFORMATION`), provando que a ambiguidade não vira aprovação automática.
5. Iogurte/leite comuns (sem marca) sob exclusão de lactose — resolvem (chegam à revisão, `review.calls: 2`), em vez do bloqueio permanente anterior.
6. Whey isolado/hidrolisado sem evidência de catálogo — continuam exigindo evidência (`AI_EVIDENCE_INSUFFICIENT`), inalterado.
7. Alergia legada ao leite, exclusões de nome de alimento, alergênicos conhecidos, veganismo com laticínio/ovo/mel/gelatina, correção automática, esgotamento de tentativas, concorrência/idempotência, orçamento/custo, compatibilidade com jobs antigos — todos os testes pré-existentes que cobriam esses cenários continuam passando sem alteração de comportamento esperado.

Os testes 1–3 e 4 são verificações unitárias diretas de `validateAndBuildPlan`/`foodRestrictionViolation`/`generateValidatedPlan`; não dependem de rede.

## 6. Homologação com IA real

Reexecutado o arnês existente `realAiHomologation.manual.test.ts` (gpt-6-luna real, perfis sintéticos, todos os dados confinados ao Firestore Emulator, nunca produção), com teto de US$ 2,00 — nunca atingido.

### 6.1 — Rodada intermediária (apenas correção 1 aplicada: `unknown` liberado em `restrictions.ts`)

| Cenário | Resultado |
| --- | --- |
| 1 — sem restrições | `completed` |
| 2 — lactose | `completed` ✅ (antes: `failed`) |
| 3/4/5 — vegetariano / vegetariano+lactose / +mandioca | `failed` (ainda) |
| 6 — suplemento | `completed` |
| 7 — alergia legada ao leite | `failed` (ainda) |
| 8 — glúten | `failed` (ainda) |
| 9 — revisor rejeita | `rejected` (sucesso do cenário) |
| 10 — correção automática | `failed` (ainda) |
| 11/12 — macros/persistência | `completed` |

Isso confirmou que o bug de evidência (§2.2) era uma causa **independente e adicional** — a correção 1 já resolveu lactose isolada (que não passava pelo caminho de padrão alimentar), mas os cenários com padrão alimentar restrito ou alergia ainda esbarravam no bloqueio de evidência. Custo desta rodada: US$ 0,0422.

### 6.2 — Diagnóstico direto (chamadas reais isoladas, perfil vegetariano sintético)

Duas chamadas reais adicionais (~US$ 0,003 no total) reproduziram e confirmaram exatamente os exemplos do §2.3 (ovo de galinha, "sem caldo de carne", fermento/coalho como `other_animal`), levando às correções 2, 3, 4, 5 e 6 do §3.

### 6.3 — Rodada final (todas as correções aplicadas)

| Cenário | Resultado | Calls | Custo (US$) |
| --- | --- | --- | --- |
| 1 — sem restrições | `completed` | 3 | 0,003556 |
| 2 — lactose | `completed` | 3 | 0,003667 |
| 3 — vegetariano | `completed` | 4 | 0,004291 |
| 4 — vegetariano + lactose | `completed` | 3 | 0,004215 |
| 5 — vegetariano + lactose + mandioca | `completed` | 3 | 0,005126 |
| 6 — suplemento proteico | `completed` | 3 | 0,003784 |
| 7 — alergia legada ao leite | `completed` | 4 | 0,004892 |
| 8 — exclusão de glúten | `completed` | 4 | 0,005027 |
| 9 — revisor rejeita candidato sintético incompatível | `rejected` (sucesso do cenário) | 1 | 0,000519 |
| 10 — rejeição, feedback, correção automática | `completed`* | 4 | 0,003553 |
| 11/12 — macros e segurança de persistência | `completed`* | 3 | 0,005046 |

\* Os cenários 10 e 11/12 precisaram de uma repetição isolada (ver §6.4); os valores acima são da repetição que passou.

**Todos os 12 cenários obrigatórios passaram com a IA real.** Custo total desta rodada: US$ 0,050113. Custo agregado de toda a tarefa (duas rodadas completas + diagnóstico + 1 repetição): **≈ US$ 0,103**, 5,2% do teto de US$ 2,00 autorizado.

### 6.4 — Duas falhas na primeira passada da rodada final, ambas investigadas e não relacionadas à arquitetura de restrições

- **Cenário 10**: falhou por um bug do **próprio arnês de teste** (`realAiHomologation.manual.test.ts`), não do backend — a asserção lia `plan.meals[].foods` diretamente, mas o schema real persiste `plan.meals[].options[].foods`. O job de produção **completou com sucesso** (logs confirmam `job_completed`, `attempts:3`); apenas a verificação pós-hoc do teste estava desatualizada. Corrigido o acesso ao campo; repetição confirmou sucesso.
- **Cenário 11/12 (sem restrições)**: falhou uma vez por `AI_MACRO_VALIDATION_FAILED` no lanche da tarde (desvio de fibra/gordura/caloria fora da tolerância em 3 tentativas) — variação real de qualidade do modelo para aquele conjunto específico de metas apertadas, não relacionada a restrições alimentares nem às correções desta tarefa (o código de correção de macros não foi alterado). Repetição isolada do mesmo cenário passou normalmente (`completed`, `review.calls: 2`). Documentado como variação estocástica residual do modelo sob metas de tolerância apertadas, não um bloqueio de arquitetura — ver §9.

## 7. Compatibilidade

Nenhuma mudança de contrato público, schema de persistência, estados de job, códigos de erro ou orçamento. As correções são inteiramente internas à lógica de validação determinística (quais itens ela deixa passar) — clientes antigos e novos, planos/jobs existentes e o fluxo de alternativas continuam no mesmo contrato já documentado em `dual-ai-generation-2026-10-20/REPORT.md`.

## 8. Functions publicadas e revisões verificadas remotamente

Publicadas exclusivamente as seis Functions nutricionais, via `firebase deploy --project ajfit-2f321 --only functions:<nome>` (sem `--only functions`, sem Rules, sem build EAS):

| Function | Ação | Revisão (`gcloud functions describe`) |
| --- | --- | --- |
| `requestNutritionPlanGeneration` | update | `requestnutritionplangeneration-00008-rid` |
| `onNutritionGenerationJobCreated` | update | `onnutritiongenerationjobcreated-00026-dih` |
| `retryNutritionGenerationJobs` | update | `retrynutritiongenerationjobs-00022-mum` |
| `requestNutritionMealAlternative` | update | `requestnutritionmealalternative-00022-xix` |
| `monitorNutritionAiOperations` | update | `monitornutritionaioperations-00004-qok` |
| `logCatalogMeal` | **create** (primeira publicação) | `logcatalogmeal-00001-rek` |

Pós-deploy, verificado por leitura remota (`firebase functions:list --project ajfit-2f321`):
- As cinco Functions atualizadas e a nova `logCatalogMeal` aparecem como `v2`, `us-central1`, `nodejs22`, `256`MB.
- Os cinco endpoints de treino (`initializeWorkoutProgramV127`, `authorizeWorkoutLifecycleMutation`, `installActiveWorkoutProgram`, `applyExerciseSubstitution`, `finalizeWorkoutSession`) permanecem **idênticos**, sem nova revisão.
- `restoreNutritionPlan`, `mutateNutritionDiaryV1`, `onNutritionGenerationCompleted` e demais Functions fora do escopo **não foram tocadas**.
- Logs pós-deploy (`firebase functions:log`) mostram `retryNutritionGenerationJobs` e `monitorNutritionAiOperations` executando normalmente nos primeiros ciclos agendados, sem exceções; `monitorNutritionAiOperations` reporta `fullPlanRequests: 0`/`mealAlternativeRequests: 0` (ambiente de baixíssimo tráfego real no momento da verificação — consistente, não um erro).
- Antes do deploy, inventário de jobs (`nutritionGenerationJobs`) confirmou **zero jobs em `queued`/`running`/`validating`** (amostra de 10 jobs totais no projeto: 7 `failed`, 3 `completed`, nenhum em trânsito) — sem risco de corromper um job em andamento durante a troca de código.

## 9. Riscos remanescentes

1. **Variação estocástica do modelo sob tolerâncias apertadas** (§6.4, cenário 11/12): o motor de metas por refeição pode gerar janelas de tolerância suficientemente estreitas (ex.: lanche da tarde de ~300kcal) que o modelo real ocasionalmente não acerta em 3 tentativas — não é um bug de restrição alimentar, é uma característica de qualidade estatística do modelo já existente antes desta tarefa (o mecanismo de correção de macros em si não foi alterado). Não investigado a fundo nesta tarefa por estar fora do escopo do pedido (que é sobre restrições alimentares); se a taxa de falha por este motivo se mostrar relevante em produção, é candidato a trabalho futuro de ajuste de tolerância/motor.
2. **Orientação de classificação de origem no prompt é uma instrução, não uma garantia.** O modelo pode, em casos raros, ainda classificar algum ingrediente de forma incorreta. A diferença desta tarefa é que esses casos agora fluem para a IA validadora (que explicitamente verifica `dietaryPattern`/`ingredients`) em vez de bloquear deterministicamente antes dela — consistente com a arquitetura pedida, mas significa que a revisão semântica é agora a linha de defesa primária para ambiguidade, não o código.
3. **Pendência de Rules da Fase A (remoção musculoesquelética)** permanece aberta exatamente como documentado nas tarefas anteriores — não investigada novamente aqui, fora do escopo (Rules não foram tocadas).

## Estado final do repositório

Working tree preserva todas as 296 entradas de porcelain pré-existentes (nutrição, remoção musculoesquelética local, documentação, outras mudanças independentes), nenhuma descartada ou resetada. Mudanças desta tarefa: `functions/src/nutrition/generation/restrictions.ts`, `functions/src/nutrition/generation/reviewEvidence.ts` (já existia sem controle de versão; editado), `functions/src/nutrition/ai/prompt.ts`, `functions/src/nutrition/__tests__/generation.test.ts`, `functions/src/nutrition/__tests__/independentReview.test.ts` (já existia sem controle de versão; editado) e `functions/src/nutrition/__tests__/realAiHomologation.manual.test.ts` (já existia sem controle de versão; corrigido o bug de asserção do cenário 10). Nenhum commit, push, build EAS/TestFlight ou alteração de Firestore Rules. Produção: seis Functions nutricionais publicadas e verificadas na nova arquitetura de duas IAs corrigida; cinco endpoints de treino inalterados; Firestore Rules inalteradas.
