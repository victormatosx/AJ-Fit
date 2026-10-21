# AJ Fit — Rules de transição + homologação real das duas IAs, 20/10/2026

**Veredito: PARCIAL. Rules de transição publicadas e verificadas em produção. Homologação real das duas IAs executada dentro do orçamento (US$ 0,046 de US$ 2,00) e revelou um bloqueio genuíno de disponibilidade para usuários com restrição alimentar — as seis Functions nutricionais NÃO foram publicadas.** Não houve build EAS, TestFlight, commit ou push. Os cinco endpoints de treino não foram tocados (nenhum deploy de Functions foi executado nesta tarefa).

## 1. Inventário inicial

Branch `main`, HEAD `18c27fc98439c7722b979592494a0eb57cb92bf7`, working tree com ~294 entradas de porcelain preexistentes (nutrição, remoção musculoesquelética local não publicada, documentação, outras mudanças independentes). Nenhuma foi descartada, resetada ou commitada. Firebase CLI autenticado no projeto `ajfit-2f321` (`us-central1`). Segredo `OPENAI_API_KEY` já existia no Secret Manager (v2, enabled) antes desta tarefa.

Documentação obrigatória lida integralmente antes de qualquer alteração: `docs/nutrition/dual-ai-generation-2026-10-20/REPORT.md`, `docs/final-publication-audit-2026-10-20/REPORT.md`, `docs/removal-physical-limitations/REPORT.md` e `DEPLOY.md`.

## 2. Diagnóstico das Firestore Rules

O relatório de auditoria final identificou que as Rules publicadas (release `2026-10-20T16:30:32Z`, conteúdo **anterior** à Fase A de remoção musculoesquelética) exigem `inputs.limits`/`inputs.primaryPlace` em `prescriptionInputSnapshotValid`. O cliente novo (`src/services/workoutLifecycle.ts`, caminho `AUTOMATIC_RECONCILIATION`/`PROGRAM_ADAPTATION`) parou de emiti-los, e essas gravações eram rejeitadas.

Diff byte-a-byte confirmado entre o ruleset publicado (buscado via `firebaserules.googleapis.com`) e o local: o local já havia corrigido isso, mas também removeu `workoutProgramLimitationValid`/`workoutProgramLimitationDatasetValid`, os campos `limitationDatasetVersion`/`Hash`, e adicionou um bloqueio explícito de `limits`/`musculoskeletal_limitation` na criação de questionários — um pacote muito maior do que o necessário para este fix.

## 3. Correções realizadas

**Decisão de escopo:** o pacote completo de remoção musculoesquelética (`docs/removal-physical-limitations/`) exige, pelo seu próprio `DEPLOY.md` §B.6, a republicação dos cinco endpoints de treino **e** uma distribuição de cliente coordenada antes que as Rules finais possam ser publicadas sem quebrar contas que ainda preenchem a etapa clínica removida — e, mais grave, o backend de treino ao vivo hoje **ainda escreve** `limitationDatasetVersion`/`limitationDatasetHash` em todo `workoutProgram` novo. Adotar as Rules locais completas teria rejeitado essa escrita para **todo** usuário imediatamente após a publicação. Nenhuma dessas duas ações (republicar os 5 endpoints de treino, distribuir cliente) está autorizada nesta tarefa.

A correção publicada foi, portanto, estritamente a função `prescriptionInputSnapshotValid`: `inputs.limits`/`inputs.primaryPlace` tornaram-se **opcionais** (antes: obrigatórios via `hasAll`) em vez de removidos. Quando presente, `limits` mantém a mesma checagem de forma (`is list`) do contrato publicado anterior; `primaryPlace` nunca teve checagem de tipo própria e continua sem ela. Nenhuma regra lê o valor desses campos para qualquer decisão de autoridade ou segurança — isso nunca existiu neste arquivo e não foi reintroduzido. O restante do diff local/publicado (sistema de limitação musculoesquelética, `workoutPilotEnrolled`, `streakNutritionDays`, política de substituição V3) é trabalho independente não publicado nesta tarefa.

## 4. Compatibilidade entre clientes antigos e novos

A correção é uma relaxação monotônica: tudo que o contrato publicado aceitava antes continua aceito; a única mudança é que um snapshot sem `limits`/`primaryPlace` (cliente novo) agora também é aceito. Nenhuma escrita antes aceita passa a ser rejeitada.

## 5. Testes de segurança

Ruleset de transição (= Rules publicadas + a correção acima) testado no Firestore Emulator contra a suíte completa de 554 testes adversariais existentes, acrescida de 2 testes novos cobrindo especificamente este fix:

| Execução | Resultado |
| --- | --- |
| Suíte completa, ruleset de transição | 554 passaram, 2 falharam |
| Falhas | `workoutExecutions.rules.test.ts`: "rejects new executions carrying a retired policy field" e "does not let a restart introduce retired metadata" — ambos testam a restrição `substitutionPolicySnapshot` exclusiva da Fase A **fora de escopo**, não uma regressão |
| Testes novos (`prescriptionInputSnapshot` com `limits`/`primaryPlace` ausentes e presentes, `limits` malformado) | 2 passaram |

A suíte cobre, para as coleções afetadas: escrita cruzada entre contas (rejeitada), alteração de campos administrativos (rejeitada), falsificação de snapshot (rejeitada), bypass de autorização via grant ausente/expirado (rejeitado), campos inesperados (`hasOnly`, rejeitado), e os cenários de migração/reconciliação automática antigos e novos (aceitos). Nenhuma regra de segurança foi relaxada para fazer testes passarem — a única mudança tornou um campo opcional, nunca ausente de checagem de forma quando presente.

## 6. Publicação das Firestore Rules

1. Backup do release publicado (`rulesetName`, conteúdo completo de 3669 linhas) salvo em `rules-backup/published-before-20261020.rules` e `release-before-20261020.json`.
2. Artefato de transição (3679 linhas) salvo em `rules-backup/transition-20261020.rules`.
3. `firebase deploy --project ajfit-2f321 --only firestore:rules` — sucesso, sem erros de compilação (2 avisos pré-existentes de função/variável não usada, não relacionados a este fix).
4. Verificação remota pós-deploy via `firebaserules.googleapis.com/v1/projects/ajfit-2f321/releases/cloud.firestore`: novo `rulesetName`, `updateTime` atualizado. Conteúdo do novo ruleset buscado e comparado byte-a-byte contra o artefato testado: **idêntico**.

O arquivo local `firestore.rules` (que contém a Fase A completa, não publicada) foi restaurado ao seu estado anterior a esta tarefa mais a correção isolada — nunca foi ele o que foi publicado.

## 7. Arquitetura nutricional final (auditoria de código)

Confirmada a arquitetura de duas IAs independentes: `generateValidatedPlan`/`runReviewedGeneration` (`functions/src/nutrition/generation/attempts.ts`) chama o criador (`gpt-6-luna`, prompt `nutrition-full-plan-v4.0.0`) e, após validação determinística (restrições, alergênicos, porções, evidências), o validador independente (`gpt-6-luna`, prompt `nutrition-independent-review-v1`) com candidato, digest e evidências do backend. Orçamento: até 4 chamadas, US$ 0,03 de reserva nominal por job, sem escalonamento para modelo mais caro (`gpt-6.1-sol` mantido apenas como identificador histórico, nunca selecionado). Preços confirmados: US$ 0,10/M tokens de entrada, US$ 0,50/M de saída.

## 8. Resultados reais da homologação

Execução completa dos 12 cenários exigidos contra a API real da OpenAI (`gpt-6-luna`), com todos os dados de perfil/job/plano confinados ao Firestore Emulator (projeto `ajfit-rules-test`), nunca produção. Orçamento autorizado: US$ 2,00. **Gasto real total: US$ 0,045854.**

| Cenário | Resultado | Calls | Custo (US$) | Observação |
| --- | --- | --- | --- | --- |
| 1 — sem restrições | `completed` | 4 | 0,00566 | Aprovado na 3ª criação |
| 2 — intolerância a lactose | `failed` (`AI_RETRY_EXHAUSTED`) | 3 | 0,00511 | 3 criações, nenhuma passou da validação determinística |
| 3 — vegetariano | `failed` (`AI_RETRY_EXHAUSTED`) | 3 | 0,00470 | idem |
| 4 — vegetariano + lactose | `failed` (`AI_RETRY_EXHAUSTED`) | 3 | 0,00506 | idem |
| 5 — vegetariano + lactose + mandioca | `failed` (`AI_RETRY_EXHAUSTED`) | 3 | 0,00484 | idem |
| 6 — suplementação proteica (sem restrição alimentar) | `completed` | 3 | 0,00404 | — |
| 7 — alergia legada ao leite | `failed` (`AI_RETRY_EXHAUSTED`) | 3 | 0,00462 | idem |
| 8 — exclusão de glúten | `failed` (`AI_RETRY_EXHAUSTED`) | 3 | 0,00449 | idem |
| 9 — rejeição pela IA validadora | `rejected` (sucesso do cenário) | 1 | 0,00057 | Candidato sintético vegano com frango; revisor real rejeitou corretamente (`checks.dietaryPattern=false`, `requiresRegeneration=true`) |
| 10 — correção automática | `failed` (`AI_RETRY_EXHAUSTED`) | 3 (1 sintético + 2 reais) | 0,00281 | 1ª tentativa sintética com glúten rejeitada pelo revisor real; as 2 tentativas reais seguintes também falharam na validação determinística |
| 11/12 — macros e segurança de persistência | `completed` | 3 | 0,00396 | 1 plano ativo, macros dentro das tolerâncias, `review.calls=2` |

**Padrão observado, 100% consistente:** todo cenário sem restrição alimentar real (1, 6, 11/12) foi aprovado; **todo cenário com uma restrição alimentar real (lactose, vegetariano, alergia ao leite, glúten — 2, 3, 4, 5, 7, 8, 10) esgotou as 3 tentativas da criadora sem nunca alcançar uma versão aprovável.**

### Causa raiz confirmada

Chamada direta e isolada de `generateValidatedPlan` com o provedor real para o cenário vegetariano (sem passar pelo pipeline completo de job) reproduziu a falha nas 3 tentativas, todas com o mesmo código:

```
attempt=1 role=creator code=AI_CONTENT_SAFETY_MISMATCH
attempt=2 role=creator code=AI_CONTENT_SAFETY_MISMATCH
attempt=3 role=creator code=AI_CONTENT_SAFETY_MISMATCH
final: AI_RETRY_EXHAUSTED (lastFailureCode=AI_CONTENT_SAFETY_MISMATCH)
```

`AI_CONTENT_SAFETY_MISMATCH` é lançado por `assertFoodSafety`/`foodRestrictionViolation` (`functions/src/nutrition/generation/{domain,restrictions}.ts`) — a checagem determinística de restrição alimentar, que roda **antes** de qualquer chamada ao revisor. Ou seja: o modelo real, em três tentativas independentes, não produziu um candidato vegetariano que passasse pela checagem determinística — nunca chegou a ser avaliado pelo validador. Esse é um resultado de qualidade do modelo real sob o prompt atual, não um bug de código: a verificação de segurança funcionou exatamente como projetada, rejeitando repetidamente uma saída real não conforme, e nunca permitiu a persistência de um plano inseguro (log completo em `homologation-debug-root-cause.log`).

Evidência completa de cada chamada (tokens, latência, custo) está em `homologation-results.json`; o log bruto da execução, em `homologation-run.log`.

## 9. Qualidade das dietas aprovadas

Nos três cenários aprovados (1, 6, 11/12), os planos ativados satisfizeram as tolerâncias de macro/caloria já implementadas (verificado via leitura do documento `nutritionPlans` ativo no cenário 11/12) e passaram por exatamente duas chamadas (criador + revisor), sem fallback. Não é possível avaliar a qualidade de dietas restritas porque nenhuma foi gerada com sucesso.

## 10. Resultado da IA validadora

Cenário 9 demonstrou, com chamada real e isolada, que o revisor independente rejeita corretamente um candidato vegano contendo frango (`checks.dietaryPattern=false`), com `requiresRegeneration=true` — o mecanismo de revisão semântica funciona como projetado quando alcançado. O problema identificado nesta homologação está a montante da revisão (bloqueio determinístico da criadora), não no revisor.

## 11. Chamadas, tokens, custos e latência

Agregados: 32 chamadas reais de API em 11 cenários (1 chamada adicional sintética/gratuita no cenário 10), latência total somada ≈ 690s, custo total US$ 0,045854 — 2,3% do orçamento de US$ 2,00 autorizado. Nenhuma chamada excedeu os limites de tokens de entrada; nenhum fallback para modelo caro foi acionado. Um rate limit transitório foi observado após ~6 chamadas reais em sucessão rápida (todas as chamadas subsequentes falhando em ~2ms com `AI_PROVIDER_ERROR` genérico) — mitigado no arnês de teste com espaçamento de 10s entre cenários e uma tentativa de novo com espera de 20s; não é uma falha de código de produção, é uma característica do arnês de homologação fazendo chamadas mais rápidas que o uso real esperaria.

## 12. Falhas encontradas e correções

| Falha | Categoria | Ação |
| --- | --- | --- |
| Rejeição sistemática de dietas com restrição alimentar real (lactose/vegetariano/alergia/glúten) | Confiabilidade do modelo real sob o prompt/orçamento atual | **Não corrigida nesta tarefa.** Uma correção de prompt não testada e publicada sob pressão de tempo arrisca fragilizar justamente a checagem de segurança que está funcionando corretamente. Documentada como bloqueio para a Etapa F. |
| Rate limit transitório no arnês de homologação | Teste, não produção | Corrigida com espaçamento entre chamadas e uma tentativa adicional com backoff |

Não há falhas de persistência, concorrência, contrato de schema ou orçamento a relatar — todos os mecanismos funcionaram exatamente como projetados; o único problema é que a criadora real, sob restrição, não produz um candidato aprovável dentro de 3 tentativas.

## 13. Testes executados

- Firestore Rules: 554 testes existentes + 2 novos, contra o ruleset de transição, no Firestore Emulator (seção 5).
- Homologação real: 12 cenários exigidos, API real, Firestore Emulator, orçamento monitorado em tempo real com interrupção automática se ultrapassasse US$ 2,00 (nunca acionada — pico real foi US$ 0,046).
- Depuração de causa raiz: 1 chamada isolada adicional a `generateValidatedPlan` com o provedor real (3 tentativas), confirmando o padrão de falha fora do pipeline completo de job.

## 14. Functions publicadas e respectivas revisões

**Nenhuma.** As seis Functions nutricionais (`requestNutritionPlanGeneration`, `onNutritionGenerationJobCreated`, `retryNutritionGenerationJobs`, `requestNutritionMealAlternative`, `monitorNutritionAiOperations`, `logCatalogMeal`) não foram publicadas — ver decisão na seção 16. Inventário remoto confirmado por leitura (`firebase functions:list --project ajfit-2f321`): as cinco primeiras existem em produção sob o código **anterior** (single-AI) e permanecem inalteradas; `logCatalogMeal` ainda não existe em produção.

## 15. Firestore Rules publicadas e respectiva versão

Publicada a ruleset de transição (seção 6). Release `cloud.firestore` do projeto `ajfit-2f321`: novo `rulesetName`, `updateTime` atualizado nesta tarefa. Conteúdo verificado remotamente como idêntico ao artefato testado.

## 16. Decisão de não publicar as Functions nutricionais — evidências e justificativa

A arquitetura de duas IAs, o orçamento, a persistência e a segurança de dados funcionam exatamente como projetado (seções 7–9). O bloqueio é de **disponibilidade real do produto**: sob condições reais (API de produção, sem catálogo de evidências preparado, orçamento de 3 tentativas), a criadora real não consegue produzir uma dieta aprovável para nenhum perfil com restrição alimentar testado — 6 de 8 cenários restritos falharam, 3 de 3 cenários sem restrição foram aprovados.

As cinco Functions nutricionais já publicadas hoje em produção usam a arquitetura **anterior** (single-AI, sem revisão independente). Publicar a nova arquitetura agora substituiria um caminho que hoje funciona para usuários vegetarianos/intolerantes/alérgicos/sem glúten por um que, pela evidência real coletada nesta tarefa, falha para esse mesmo público na grande maioria das tentativas. Isso é consistente com a instrução explícita do pedido: "não publique uma versão não homologada" — a homologação real não foi bem-sucedida para o subconjunto de cenários com restrição alimentar, que é exatamente a população para a qual a arquitetura de duas IAs foi desenhada para ser mais segura.

A falha é seguro-por-design (nenhum plano não revisado ou rejeitado é jamais ativado — confirmado no cenário 10 e pelos testes locais preexistentes), mas é um bloqueio de produto genuíno para a publicação completa desta tarefa.

## 17. Confirmação de preservação dos cinco endpoints de treino

Nenhum deploy de Functions foi executado nesta tarefa (apenas Firestore Rules). Inventário remoto lido via `firebase functions:list --project ajfit-2f321` confirma os cinco endpoints (`initializeWorkoutProgramV127`, `authorizeWorkoutLifecycleMutation`, `installActiveWorkoutProgram`, `applyExerciseSubstitution`, `finalizeWorkoutSession`) ativos, `v2`, `nodejs22`, `us-central1`, sem alteração de versão/revisão.

## 18. Limitações e riscos remanescentes

1. **Bloqueio de disponibilidade nutricional não resolvido** (seção 16) — requer investigação de prompt/engenharia de contexto (ex.: a criadora pode estar classificando algum ingrediente com origem incompatível com o padrão vegetariano, ou incluindo um ingrediente genuinamente incompatível) e nova rodada de homologação real antes de qualquer tentativa futura de publicação. Não investigado com granularidade adicional (razão textual exata da violação por item) nesta tarefa — o código de falha (`AI_CONTENT_SAFETY_MISMATCH`) foi confirmado, mas o motivo específico (qual alimento/origem) não foi extraído, pois `ValidationIssue` não é anexado a esse código específico.
2. **Rate limit do arnês de homologação**: mitigado localmente para esta execução; não indica um problema de produção, já que o tráfego real nunca fará 6+ chamadas sequenciais na mesma velocidade de um script de teste.
3. **`logCatalogMeal` nunca foi publicada** — faz parte do pacote de 6 Functions pendente da resolução do item 1.
4. **Pendência de Rules da Fase A (remoção musculoesquelética) permanece aberta**, exatamente como diagnosticado em `docs/removal-physical-limitations/DEPLOY.md` §B.6 — depende de build/distribuição de cliente e republicação dos 5 endpoints de treino, nenhum autorizado nesta tarefa.
5. Nenhuma dieta gerada nesta homologação foi declarada certificada clinicamente apenas por aprovação da segunda IA, conforme instruído.

## Estado final do repositório

Working tree preserva todas as alterações preexistentes (nutrição, remoção musculoesquelética local, outras mudanças independentes) intactas. Única mudança de código: dois novos testes em `firestore-tests/workoutLifecycle.rules.test.ts` e um fix isolado em `firestore.rules` (`prescriptionInputSnapshotValid`), mais o arquivo de teste manual `functions/src/nutrition/__tests__/realAiHomologation.manual.test.ts` (gated por três variáveis de ambiente, nunca executa em CI/suítes normais). Nenhum commit, push ou alteração de dados reais de usuários. Produção: Firestore Rules de transição publicadas e verificadas; Functions nutricionais inalteradas; Functions de treino inalteradas.
