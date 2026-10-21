> Registro histórico: o sistema musculoesquelético e as políticas clínicas V3/legacy descritos aqui foram descontinuados. Não são contratos atuais. Ver [remoção definitiva](../removal-physical-limitations/REPORT.md).

> **Atualização após o teste físico de 20/10/2026:** a prontidão declarada neste relatório é histórica. A geração com limitações apresentou bloqueios de conteúdo e falhas de alocação diagnosticadas em [v3-geracao-stiff-relatorio.md](v3-geracao-stiff-relatorio.md). As novas correções são locais, ainda não publicadas; a ausência de configuração segura continua bloqueando a geração.

# AJ Fit — conclusão local da ativação V3 (20/10/2026)

**V3 ativa no código local e no backend publicado. PRONTO PARA GERAR O BUILD NORMAL E TESTAR NO IPHONE.** Rules e exclusivamente as três Functions autorizadas foram publicadas e verificadas individualmente. Nenhum build do app/EAS, OTA, commit, push ou alteração de dados reais foi executado; a planilha permanece intacta.

Este relatório registra a continuação local e, ao final, a publicação explicitamente autorizada pelo proprietário em 20/10/2026. A compilação TypeScript exclusiva das Functions e a recompilação automática do predeploy também receberam autorização expressa. O bloqueio inicial de publicação foi resolvido conforme a seção 8.

## 1. Estado recuperado

Antes de editar: executados `git status --short`, `git diff`, inventário de arquivos não rastreados e busca da constante. Encontrados 36 arquivos rastreados modificados, além da planilha, dataset, vídeos, documentação, importador e testes V3 ainda não rastreados. Nenhum reset/clean/checkout destrutivo foi feito. O trabalho existente foi preservado.

`ACTIVE_SUBSTITUTION_POLICY` **já estava em `'v3'`** em `src/workoutPrescription/substitutionPolicyV3.ts:73`. O relatório anterior ainda dizia `'legacy'`, portanto estava desatualizado em relação ao disco.

Lidos os relatórios 6A, 6B, 6C e de ativação, o dataset, o importador, os resolvedores e os diffs dos consumidores/testes. O plano `~/.claude/plans/polymorphic-spinning-moonbeam.md` existe, mas ainda descreve a Etapa 3, com V3 desativada; não contém o andamento final informado na passagem de sessão. Os diffs e resultados reais foram usados como referência. A documentação versionada do Expo 56 foi consultada antes das alterações.

Recuperado dos agentes:

- Evolução/equivalência/substituição manual: overrides explícitos para os contratos históricos, integração editorial e testes próprios V3, preservados.
- Motor v1.27: `PrescriptionGenerationContext.substitutionPolicy` opcional e propagação pelo motor/composição, preservados. Os cenários históricos de cobertura continuam expondo suas falhas anteriores.
- Retry de limitation-resolver: **alterações efetivamente presentes**, incluindo políticas explícitas e cinco mocks locais de `ACTIVE_SUBSTITUTION_POLICY`. Dois desses mocks foram removidos nesta continuação após corrigir a propagação da política; três permanecem apenas nas auditorias do dataset histórico cujo classificador não recebe ambiente/política.

A primeira suíte completa desta sessão deu **47 falhas**, não 111: os ajustes herdados já haviam recuperado 64 das 67 falhas adicionais. Restavam três fixtures de preferências em `myPlanPresentation.test.ts`.

## 2. Fonte editorial e caso Goblet

A investigação anterior recuperável no relatório concluía que `barbell-back-squat → goblet-squat` não estava aprovado para academia. Conferência indispensável da planilha e do dataset confirmou:

- `Academia - comuns`: `Agachamento Livre` tem Smith, Hack e Leg Press 45.
- `Casa - comuns`: `Agachamento Livre` tem Goblet, Sumô com Halter e Búlgaro com Halter.
- A academia **aprova Goblet para outras âncoras**, por exemplo `Agachamento` (`bodyweight-squat → goblet-squat`). Também existe a direção Goblet → Agachamento Livre. Essas relações continuam válidas.
- Não há autorização adicional incondicional para a direção Agachamento Livre → Goblet em academia nas demais fontes importadas. A aba de condicionais não constitui aprovação automática; a auditoria V3 diferencia explicitamente relações removidas, condicionais e `REVISAR`.

As três colunas exprimem prioridade das relações declaradas. **Não se inferiu uma proibição física de Goblet na academia, nem uma regra universal de que toda lista de três proíbe uma quarta relação autorizada por outra fonte.** Neste par específico, falta aprovação positiva dirigida e contextual; não há autorização para inventar simetria ou transportar a aprovação de casa para academia. A preferência não autorizada mantém o exercício prescrito. Um teste novo também comprova que Goblet continua oferecido na academia para a âncora em que a planilha o aprova.

Os testes de Meu Plano passam a usar Smith, aprovado para ambas as âncoras utilizadas no teste de colisão. Permanecem no **padrão global V3, sem override**. As fixtures de equipamento, perfil, indisponibilidade e remoção da preferência continuam verificando seus respectivos bloqueios com uma relação aprovada, sem esconder o motivo sob falta de autorização editorial.

**Ambiguidades C:** nenhuma relação nova foi autorizada. A eventual inclusão do par Agachamento Livre → Goblet em academia continua sendo uma decisão editorial externa; sua possibilidade física não foi usada como aprovação. Permanecem intactos os estados editoriais pendentes já existentes.

## 3. Classificação das falhas

O arquivo [etapa6c-ativacao-validacao.json](etapa6c-ativacao-validacao.json) registra **individualmente os 67 testes adicionais**, classificação, justificativa e resultado final, e identifica nominalmente os **44 testes da baseline**. A comparação usa os nomes completos extraídos de `/tmp/etapa6c_final_app.log` e `/tmp/etapa_activation_app.log`, preservados da sessão anterior, confrontados com o JSON da execução final desta sessão.

| Arquivo (basename) | Adicionais originais | Classificação/tratamento |
|---|---:|---|
| cycleEvolution.test.ts | 4 | A — contratos históricos de novidade/família; legacy explícito |
| equivalence.test.ts | 2 | A — equivalência histórica; legacy explícito |
| myPlanPresentation.test.ts | 3 | A — fixtures corrigidas para relação editorial aprovada; V3 global |
| engineV127Integration.test.ts | 2 | A — cenários históricos de fallback; legacy explícito |
| equivalenceDivergence.characterization.test.ts | 2 | A — caracterização histórica; legacy explícito |
| limitationClinicalDecisions.test.ts | 2 | A — auditoria histórica; chamadas legacy e mock do classificador |
| limitationDatasetAudit.test.ts | 2 | A — auditoria histórica; mock local legacy |
| limitationDatasetQualityGate.test.ts | 3 | A — métricas históricas; mock local legacy |
| limitationIntegration.test.ts | 11 | A — integração histórica v2; legacy explícito, sem mock |
| limitationResolver.test.ts | 12 | A — Resolver V1 histórico; legacy explícito, sem mock |
| manualSubstitutionResolver.test.ts | 8 | A — contrato histórico/fixtures sintéticas; legacy explícito |
| musclePriorityV127.test.ts | 1 | A — adaptação histórica no cenário de prioridade |
| musculoskeletalFullCoverageV127.test.ts | 1 | A — cenário histórico; as 18 falhas antigas continuam visíveis |
| musculoskeletalLimitationPerRegionCoverage.test.ts | 4 | A — cobertura histórica por região |
| musculoskeletalLimitationV127.test.ts | 9 | A — fixtures e regras históricas |
| spineHomeClosureV127.test.ts | 1 | A — ordem histórica de fallback; falha antiga do fechamento mantida |
| **Total** | **67** | **Todos aprovados na execução final** |

**D — baseline do app:** os 44 testes que falham são exatamente os mesmos, nos mesmos 16 arquivos. Nenhuma falha foi removida, renomeada ou convertida em skip para esconder a baseline. A suíte final tem nove testes aprovados a mais: oito globais novos e um caso novo de Meu Plano.

Também foram isoladas duas expectativas históricas do backend puro (bodyweight como substituto doméstico e veto mecânico de hip thrust → kickback) com `policy: 'legacy'`. O teste de duplicidade do backend agora usa Smith para testar uma relação aprovada, e a paridade de todo o dataset foi convertida para o **padrão global real**, sem override, com asserção de que ele é V3.

**B — bugs reais encontrados além das expectativas antigas:** corrigidos conforme a seção seguinte. Não foram classificados como “apenas testes legados”.

## 4. Bugs reais corrigidos

1. **Evolução com contexto de slot:** `evaluateEquivalenceCandidate` aceitava a exceção editorial e depois reaplicava padrão/mecânica via `SESSION_CONTEXT_MISMATCH`. `evolveCycle` sempre passa esse contexto, enquanto a antiga paridade isolada não passava. Agora as duas checagens respeitam os mesmos escopos editoriais. Equipamento, perfil, estado operacional, duplicidade e imutabilidade da âncora continuam independentes. Regressão global exercita evolução real `hip-thrust → cable-glute-kickback`, preservando dose/descanso e entrada imutável; outra verifica todas as relações elegíveis com contexto real de slot.
2. **Política explícita perdida no Resolver V1:** o ramo `avoid` não encaminhava `policy`/`environment` para `evaluateDirectLimitationCandidate`. Com global V3, uma chamada explicitamente legacy podia cair na regra V3 internamente. A propagação foi corrigida e o mock que escondia isso foi removido. `engine.ts` também encaminha a propriedade de contexto já adicionada pelo Claude, permitindo testar o motor v2 histórico explicitamente, sem mock global.
3. **Orçamento de expressões das Rules:** a suíte completa revelou que o teste existente de oito exercícios excedia 1.000 expressões com as validações do snapshot. **Não foi considerado preexistente sem prova:** o mesmo teste foi executado com o conteúdo exato das Rules de `HEAD` e passou; com as Rules encontradas nesta sessão falhava. A correção mantém os checks dos índices 0–19, agrupando os checks de posições ausentes após o índice 7 para sessões de até oito exercícios. A validação do enum usa `get` com fallback legacy somente quando ausente; `null`, valores estranhos e tipos inválidos continuam rejeitados. Imutabilidade e exceção de reinício após abandono permanecem. O teste de oito exercícios voltou a passar e foi adicionado o teste real de sete exercícios com snapshot V3, registro de séries e veto a troca/remoção da política.

A comparação temporária de políticas e de Rules foi feita no próprio workspace, com restauração dos bytes em `finally`, sem ambiente paralelo e sem publicação. Estado final: fonte e espelho gerado das Functions em V3; Rules locais com a correção acima.

## 5. Dataset atual e segurança preservada

Recontagem offline dos dados atuais, sem reimportar/escrever a planilha ou modificar o dataset:

| Estado | Quantidade |
|---|---:|
| Relações primárias | 1.156 |
| Operacionais | 871 |
| Bloqueadas por perfil | 50 |
| Bloqueadas por equipamento | 4 |
| Bloqueadas por exercício/estado/catálogo | 231 |
| Bloqueios residuais sem classificação | 0 |
| Rascunhos inativos | 41 |
| Grupos REVISAR | 26 |
| Grupo SEM SUBSTITUIÇÃO ACEITA | 1 |
| Condicionais sem aprovação automática | 139 |

O SHA-256 da planilha confere com `sourceSha256` do dataset. Nenhuma relação, perfil, prioridade, condição ou rascunho foi alterado. A regressão dos 102 templates × 127 combinações não vazias confirma os números atuais: V3 102/102 sem limitação, 192/714 com uma região e 404/12.954 nas combinações; legado 102/102, 629/714 e 8.932/12.954. A menor cobertura editorial não foi preenchida com fallback genérico. Originais comprovadamente seguros permanecem; uma origem insegura sem substituto aprovado resulta em bloqueio controlado, sem exceção não tratada.

## 6. Validação final executada

Os emuladores foram executados com JDK 21 apenas no ambiente dos comandos, Node 20.20.2 e Firebase CLI 15.26.0. O Java global da máquina não foi alterado. A primeira tentativa do preflight com Java 17 foi corrigida usando o JDK 21 já instalado.

| Verificação | Resultado |
|---|---|
| Typecheck app (`npm run typecheck`) | Limpo |
| Typecheck Functions (`npm run typecheck --prefix functions`, inclui sync) | Limpo |
| ESLint de todos os arquivos TS/TSX/CJS alterados/novos | 0 erros; 50 avisos de estilo/imports registrados |
| App completo (`npm test`, JSON final) | **7.915 aprovados, 44 falhas D, 232 ignorados**; mesmos 44 nomes/16 arquivos da baseline |
| Backend completo (`npm test --prefix functions`) | **2.026 aprovados, 0 falhas, 401 ignorados** |
| V3 específicas: integridade, regressão e padrão global | **42/42** (28 + 6 + 8), incluídos no app completo |
| Paridade preview/backend de todo o dataset | Aprovada no backend completo com V3 global, sem override |
| Rules Firestore completas, após correção | **582/582**, 25 arquivos; inclui as quatro novas rejeições de enum inválido |
| Rules Storage completas | **93/93**, quatro arquivos |
| Execuções de treino com SDK cliente e Rules reais | **87/87**; repetidas após a correção final das Rules |
| Callable completo com Admin SDK e transações reais | **10/10**; repetido no fechamento |
| Geração/evolução do app no emulador | **6 aprovados/5 falhas D**, além dos 87 de execução; os mesmos cinco nomes reproduzidos sob legacy |
| Autoridade de lifecycle/geração/instalação no backend, emulador | **102 aprovados/2 falhas D** (94/2 em authorizeMutation e 8/0 em installActiveWorkoutProgram) |

As cinco falhas de integração do app são quatro testes de `firstProgramGeneration.integration.test.ts` (frequência/template T003 esperados e cenários antigos de canonical authority) e um de promoção de nível em `prescriptionEvolution.integration.test.ts`. A execução de controle com global legacy confirmou exatamente os mesmos nomes e resultados; não são regressões V3.

As duas falhas de integração do backend (`INITIALIZE ... conditioning ... typed interval cycles` e `v2 ADAPT ... unchanged grant`) já constam do JSON histórico `/tmp/ajfit-stage3-emulator-baseline-results.json`. O teste histórico de bloqueio musculoesquelético que também falhava naquela baseline agora passa com V3. Nenhuma falha adicional ficou sem explicação.

Uma execução concorrente do app completo excedeu os 20 segundos da regressão matricial; a reexecução sem concorrência pesada passou, inclusive a matriz, sem aumentar timeout ou mudar expectativas. Os resultados finais acima são da execução concluída, não desse timeout transitório.

## 7. Evidência dos 12 fluxos com V3 global

As evidências abaixo são automatizadas, com domínio real e Firestore Emulator onde indicado. **Não constituem teste físico de interface/iPhone**, que permanece a cargo do proprietário após o build autorizado.

| # | Fluxo | Evidência efetivamente executada |
|---|---|---|
| 1 | Questionário/geração inicial | `substitutionPolicyV3Global.test.ts`: 102 entradas reais via `answersForTemplate` → `generateWorkoutPrescriptionV127`, sem override; geração autoritativa também exercitada no emulador backend |
| 2 | Composição | Matriz global omitida versus V3 explícita em todos os 102 templates; matriz completa com contagens acima; sem limitações preserva todos |
| 3 | Visualização das alternativas | `resolveDisplayCandidates` global para academia/casa, ordem editorial, equipamento indisponível, Goblet autorizado na academia para a âncora correta; paridade backend |
| 4 | Substituição manual | Callable real: aprovação editorial, ausência de autorização, auth/ownership, idempotência; preview e backend alinhados |
| 5 | Limitação física | Teste global percorre relações reais com origem avoid/adapt e comprova autorização e dose preservada; geração insegura não é persistida pelo backend |
| 6 | Múltiplas limitações | Interseção e segurança por todas as regiões na regressão V3; original seguro permanece sem mudança; nenhuma autorização unilateral é ampliada |
| 7 | Preferências permanentes | Meu Plano no padrão global; serviço real cria sessão V3 já materializando Smith; callable grava/remove preferência permanente |
| 8 | Reversão ao original | Resolvedor global e callable real retornam à âncora, removem marcador/preferência sem exigir nova relação editorial |
| 9 | Séries/cargas | 87 cenários SDK/Rules incluem `recordSetExecution`, reps/cargas e proteção de séries concluídas; novo caso Rules com sete exercícios V3 grava 10 reps/40 kg |
| 10 | Conclusão/retomada | Serviço real completa/retoma, preserva cargas/séries e snapshot; sessão antiga sem snapshot não é recarimbada; backend mantém legacy sem consultar global |
| 11 | Evolução de ciclos | `evolveCycle` global real com slotContext, troca editorial entre mecânicas, prioridades/dose/âncora preservadas; no emulador, autoridade/evolução sem novas falhas |
| 12 | Ausência de autorização | Preview retorna lista vazia, preferência cai na prescrição, evolução sem alternativa mantém original seguro, origem insegura é bloqueada com resultado controlado |

Academia/casa, equipamentos presentes/ausentes, dependências draft, perfis ausentes/pending, REVISAR, SEM SUBSTITUIÇÃO ACEITA, condicionais e limites simultâneos também permanecem cobertos pelas 42 regressões V3. As sessões antigas com `legacy` e sem snapshot, e as novas criadas com `v3`, foram exercitadas nos testes de serviço/callable. Nenhuma dessas suítes altera a constante por mock no teste global novo.

## 8. Publicação autorizada e compatibilidade confirmada

A primeira conferência, antes da autorização de compilação, confirmou o artefato antigo em `legacy`. Nenhuma Rules ou Function foi publicada nessa tentativa. Após a autorização explícita para `npm --prefix functions run build`, o backend foi compilado sem erros; nenhum build do aplicativo foi executado.

**Verificação anterior ao deploy:**

- JavaScript compilado com `ACTIVE_SUBSTITUTION_POLICY = 'v3'`.
- Fontes espelhadas dos módulos corrigidos iguais às fontes locais validadas; escopos editoriais do slot e propagação da política presentes no JavaScript emitido.
- Dataset compilado semanticamente idêntico ao dataset editorial local, com a mesma identidade SHA-256. A diferença de formatação JSON causada pelo compilador não altera seu conteúdo.
- Teste direto do JavaScript compilado confirmou a evolução real `hip-thrust → cable-glute-kickback` sob a política global V3.
- Manifesto dos artefatos antes do deploy e depois da recompilação automática do predeploy idêntico.

**Ordem executada:**

1. `firebase deploy --only firestore:rules --project ajfit-2f321 --non-interactive`: `released rules firestore.rules to cloud.firestore` e `Deploy complete!`. O sucesso foi confirmado **antes** de iniciar o deploy das Functions. Apenas dois avisos históricos de função/variável não usadas; compilação sem erros.
2. `firebase deploy --project ajfit-2f321 --only functions:authorizeWorkoutLifecycleMutation,functions:initializeWorkoutProgramV127,functions:installActiveWorkoutProgram --non-interactive`: compilação exclusiva do backend concluída e `Successful update operation` individual para as três Functions; `Deploy complete!`. O aviso de versão antiga de `firebase-functions` não impediu a publicação; nenhuma dependência foi atualizada nesta tarefa.

**Verificação remota após a publicação, sem chamar fluxos que escrevem dados:**

A API de Firebase Rules retornou a release ativa `projects/ajfit-2f321/releases/cloud.firestore`, ruleset `projects/ajfit-2f321/rulesets/128b4ad7-18a0-4f68-a264-d0815f2b748d`, atualizada em `2026-10-20T15:29:56.091234Z`. Seu conteúdo foi comparado byte a byte ao `firestore.rules` local corrigido: **idêntico**, SHA-256 `e09ff77ffca3738edc580e72f5d4606a64a10a0fe69396bd915af66bec9189ce`.

| Function (us-central1 / Node.js 22) | Estado remoto | Revisão publicada | updateTime UTC |
|---|---|---|---|
| `authorizeWorkoutLifecycleMutation` | **ACTIVE** | `authorizeworkoutlifecyclemutation-00019-jut` | 2026-10-20T15:31:45.476325325Z |
| `initializeWorkoutProgramV127` | **ACTIVE** | `initializeworkoutprogramv127-00007-vab` | 2026-10-20T15:31:59.911020513Z |
| `installActiveWorkoutProgram` | **ACTIVE** | `installactiveworkoutprogram-00003-poq` | 2026-10-20T15:32:08.333057322Z |

Para **cada uma** das três Functions, foi consultada a origem do código vinculada à publicação e baixado o arquivo `function-source.zip` na geração exata informada pela API. Comparados **625 arquivos em `lib/` por Function**: todos são byte a byte idênticos aos artefatos locais compilados e conferidos. Os três arquivos ZIP têm o mesmo SHA-256 `31f757881c0ce270542b5c715372e29bd381e346e8557449223307ec4f5ab92a`. Isso confirma o conteúdo publicado, além do status de sucesso do CLI: V3 ativa, correções presentes e dataset correto no backend.

O inventário remoto antes/depois contém **75 Functions**. Somente os hashes de deploy das **três autorizadas** mudaram; as outras **72 permaneceram iguais**, inclusive `applyExerciseSubstitution`, que **não foi republicada**. Nenhuma Function foi criada ou removida. O contrato de substituição manual da Function já publicada permanece compatível: decisão pelo snapshot da sessão, fallback legacy quando ausente; os artefatos atualizados alinham geração/evolução à V3 global do cliente.

Nenhum documento real foi alterado e nenhum callable de escrita foi invocado para homologação em produção. As provas funcionais continuam sendo as suítes locais e de emulador descritas acima; a prova pós-publicação confirma estado, origem e conteúdo efetivamente publicados. Não há nova publicação pendente para este diff. A homologação física no iPhone será feita pelo proprietário após gerar o build normal.

## 9. Arquivos desta continuação

Código de produção: `src/prescriptionEvolution/equivalence.ts`, `src/workoutPrescription/limitationResolver.ts`, `src/workoutPrescription/engine.ts`, `firestore.rules`.

Testes: novo `src/workoutPrescription/__tests__/substitutionPolicyV3Global.test.ts`; `src/screens/__tests__/myPlanPresentation.test.ts`; `src/services/__tests__/workoutExecutions.integration.test.ts`; `src/workoutPrescription/__tests__/limitationResolver.test.ts`; `src/workoutPrescription/__tests__/limitationIntegration.test.ts`; `functions/src/workoutLifecycle/__tests__/exerciseSubstitution.test.ts`; `firestore-tests/workoutExecutions.rules.test.ts`.

Suporte/documentação: anotação ESLint de `__dirname` em `scripts/syncPrescriptionEngineToFunctions.cjs`; este relatório; novo `etapa6c-ativacao-validacao.json` com inventário completo do working tree herdado e atual. Os espelhos ignorados das Functions foram sincronizados pelos scripts existentes. `firestore-debug.log` foi atualizado pelo emulador.

**Constante inicial: `v3`. Constante final: `v3`. Backend publicado: `v3`.** Nenhum trabalho editorial ou local anterior foi descartado. Implementação, validação e publicação autorizada concluídas; nenhum bloqueio técnico novo ou deploy pendente para este diff.

## Veredito

**V3 ATIVA — PRONTO PARA GERAR BUILD**

**PRONTO PARA GERAR O BUILD NORMAL E TESTAR NO IPHONE.** A homologação física ainda não foi executada; será realizada pelo proprietário. As 44 falhas históricas do app e as falhas de integração preexistentes estão discriminadas acima e não foram ocultadas.
