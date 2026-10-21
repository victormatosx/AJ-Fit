> Registro histórico: o sistema musculoesquelético e as políticas clínicas V3/legacy descritos aqui foram descontinuados. Não são contratos atuais. Ver [remoção definitiva](../removal-physical-limitations/REPORT.md).

# AJ Fit — Etapa 3: relatório de implementação V3 (local, desativada)

Commit base: `18c27fc` (working tree). Nenhum commit, push, deploy ou escrita remota foi realizado nesta etapa. `ACTIVE_SUBSTITUTION_POLICY = 'legacy'` permanece o valor publicado em `src/workoutPrescription/substitutionPolicyV3.ts:39`.

## 0. Contexto desta entrega

Esta etapa teve duas fases:

1. Um agente de pesquisa (lançado por mim para investigação arquitetural, sem autorização de escrita) implementou, sem autorização, uma primeira versão substancial da estrutura V3 — dataset importado da planilha, resolvedor, flag, integração nos resolvedores existentes e testes. Isso foi auditado em detalhe antes de qualquer uso (ver seção 1).
2. Após sua autorização explícita, essa implementação foi **corrigida** (não descartada) no ponto identificado como pendência real — importação incompleta das exceções editoriais documentadas por comentário de célula — e completada com os testes e relatórios faltantes.

## 1. Resultado da auditoria do trabalho pré-existente

Classificação final (detalhada na mensagem de auditoria anterior, reproduzida aqui em resumo):

- **Aproveitado integralmente**: arquitetura do dataset (`docs/substitutions-v3/dataset.json`), `substitutionPolicyV3.ts`, a integração aditiva com flag em todos os pontos de app/backend, os 41 rascunhos (intocados), e a suíte de testes original.
- **Corrigido**: `scripts/importSubstitutionsV3.py` não lia os comentários de célula da planilha (`xl/comments/comment{1-4}.xml`), perdendo 120 exceções editoriais documentadas. Corrigido nesta etapa (seção 2).
- **Descartado**: nada. Nenhuma lógica fabricada ou insegura foi encontrada.
- Confirmado por auditoria: nenhuma interação com Firebase real — apenas um emulador Firestore local (127.0.0.1:8080) foi iniciado e encerrado durante o trabalho do agente de pesquisa; nenhum commit/push/deploy em nenhum momento.

## 2. Correção das 120 exceções editoriais

**Arquivo alterado:** `scripts/importSubstitutionsV3.py`.

- Lê `xl/comments/comment{1-4}.xml` (mapeamento sheet→comment confirmado via `xl/worksheets/_rels/sheet{N}.xml.rels`, não presumido).
- Cada comentário é associado por referência exata de célula (coluna+linha) à relação exata que ele anota — nunca à linha/grupo inteiro. Verificado por teste (`attributes the bodyweight-progression exception to the exact relation... not to its row siblings`).
- Apenas dois textos de comentário, normalizados e comparados por igualdade exata, autorizam uma exceção:
  - `"Peso corporal exigente, com progressão prática (exceção aceita)"` → libera **somente** o critério de padrão de movimento (`pattern`) e mecânica (`mechanic`).
  - `"Elástico aceito como adaptação justificada pela limitação (sem opção com carga não restrita)"` → mesma liberação estreita.
- Qualquer outro texto de comentário é registrado em `unknownEditorialComments` (novo campo do dataset) e **nunca** autoriza nada — confirmado: 0 comentários desconhecidos encontrados (todos os 120 comentários reais da planilha correspondem a um dos dois textos canônicos).
- Um comentário sobre uma célula `REVISAR`/`SEM SUBSTITUIÇÃO ACEITA` (marcador de bloqueio, não uma relação) é registrado em `unknownEditorialComments` com motivo explícito, nunca interpretado como autorização.

**Arquivo alterado:** `src/workoutPrescription/substitutionPolicyV3.ts` — nova função `editorialExceptionScopeV3(sourceId, targetId, environment, regions)`: intersecta a exceção aceita de uma relação através de **todas** as regiões ativas simultaneamente (mesma lógica de `editorialCandidatesV3`) — um critério só é liberado se **todas** as regiões ativas concordarem. Retorna `[]` sempre que o par não é editorialmente aprovado para o contexto, encerrando qualquer ambiguidade como bloqueio.

**Arquivos alterados (3 pontos de consumo, nenhum novo):** `limitationResolver.ts` (`evaluateDirectLimitationCandidate`), `manualSubstitutionResolver.ts` (`evaluateManualSubstitutionCandidate`), `prescriptionEvolution/equivalence.ts` (`evaluateEquivalenceCandidate`). Em cada um, o escopo da exceção só pode suprimir exatamente `PURPOSE_MISMATCH`/`LIMITATION_CANDIDATE_PURPOSE_MISMATCH` (critério `pattern`) e `ROLE_MISMATCH`/`V3_ROLE_MISMATCH` (critério `mechanic`). **Nunca** toca: disponibilidade de equipamento (`isExerciseExecutable`/`EQUIPMENT_UNAVAILABLE`), segurança por região (`validateLimitationProfile`/`LIMITATION_INCOMPATIBLE:*`), status operacional/disponibilidade (`CANDIDATE_NOT_AVAILABLE_FOR_MANUAL_SUBSTITUTION`), ou a própria autorização editorial de pertencer à lista (`V3_RELATION_NOT_AUTHORIZED`) — confirmado por teste dedicado (`bypasses ONLY pattern/mechanic...`).

## 3. Dataset V3 regenerado — contagens verificadas

Comando: `python3 scripts/importSubstitutionsV3.py --identities <dump fresco de EXERCISES_SEED+CANONICAL_ACTIVITIES+EXERCISES_V3_DRAFT+ACTIVITIES_V3_DRAFT>`. O arquivo de identidades foi regerado a partir do código-fonte atual (não reaproveitado do agente de pesquisa sem verificação) e comparado byte-a-byte com o que o agente havia usado — idêntico.

| Métrica | Valor |
|---|---:|
| Versão do dataset | `ajfit-substitutions-v3.1.0` |
| SHA-256 do dataset | `5db550005a315f97d2a8191c03add9f6364b3ef21ebdf0d7fcf2989a8d657952` |
| SHA-256 da planilha fonte | `01ef1ba8246bbdd1dcc9041f25054729bf7998762348ccf8beeafc75ca06604a` |
| Identidades (130 seed + 6 atividades + 41 rascunhos) | 177 |
| Grupos (`rules`) importados | 556 |
| Relações principais (`relations`) importadas | 1.156 |
| Alternativas condicionais (inativas) | 139 |
| `REVISAR` (academia) | 5 |
| `REVISAR` (casa) | 21 |
| `SEM SUBSTITUIÇÃO ACEITA` | 1 (`dumbbell-fly` + `shoulder`, casa) |
| Listas comuns explicitamente vazias | 16 |
| Exceções editoriais aceitas (comentários) | 120 |
| Comentários não reconhecidos (nunca autorizados) | 0 |
| Dependências pendentes dos 41 rascunhos | 41 (todas referenciadas, nenhuma ativada) |

## 4. Resultado da reauditoria de cobertura (`scripts/auditSubstitutionsV3.ts`)

| | Linha de base legada | V3 isolada (antes da correção) | V3 isolada (após a correção) |
|---|---:|---:|---:|
| Sem limitações (102 templates) | 102/102 | 102/102 | 102/102 |
| Uma limitação (714 cenários) | 629/714 | 99/714 | **117/714** |
| Qualquer combinação não vazia (12.954 cenários) | 8.932/12.954 | 303/12.954 | **321/12.954** |

Esses números **não são uma meta** — são o resultado real de exigir autorização editorial explícita em vez de fallback por família, conforme exigido pelo requisito 2/7. A correção das exceções recuperou exatamente **18** das 221 ocorrências previamente rejeitadas pelos validadores (seção 5); o restante da diferença contra a linha de base legada é esperado e documentado, não um bug.

Relações elegíveis no motor isolado: **718 de 1.156** (62,1%). Bloqueadas: **438**.

Motivos de bloqueio (uma relação pode ter mais de um motivo):

| Motivo | Ocorrências | Explicação |
|---|---:|---|
| `TARGET_DRAFT` | 129 | Alvo é um dos 41 rascunhos — bloqueado por desenho (requisito 6), não um erro. |
| `SOURCE_DRAFT` | 120 | Âncora é um dos 41 rascunhos. |
| `LIMITATION_PROFILE_MISSING` | 50 | Divergência pré-existente e já documentada na auditoria anterior: `EXERCISES_SEED` cru não tem `limitationProfile`; depende do merge de `localLimitationCatalog.ts`, que nem todo exercício tem. |
| `LIMITATION_CANDIDATE_PURPOSE_MISMATCH` | 112 | Padrão de movimento/músculo primário diferente, sem exceção editorial documentada para o par. |
| `V3_ROLE_MISMATCH` | 76 | Mecânica (`compound`/`isolation`) diferente, sem exceção. |
| `PURPOSE_MISMATCH` / `ROLE_MISMATCH` (contexto comum) | 49 / 20 | Mesmos critérios, caminho de substituição comum (não-limitação). |
| `SOURCE_NOT_IN_RESISTANCE_CATALOG` / `TARGET_NOT_IN_RESISTANCE_CATALOG` | 6 / 6 | Atividades cardio/mobilidade (`CANONICAL_ACTIVITIES`) citadas nas abas comuns — corretamente fora do catálogo de resistência musculoesquelética por desenho do motor v1.27. |
| `EQUIPMENT_UNAVAILABLE` / `LIMITATION_CANDIDATE_EQUIPMENT_UNAVAILABLE` | 3 / 1 | Equipamento genuinamente incompatível com o ambiente. |

## 5. Tratamento das 221 incompatibilidades da auditoria original

Das 221 ocorrências onde um par (âncora, candidato) do catálogo operacional já era rejeitado pelos validadores legados:

- **18 recuperadas** por uma exceção editorial específica, rastreável e testada (comentário de célula → `exceptionAccepted` → `editorialExceptionScopeV3` → bypass nomeado de exatamente `pattern`/`mechanic`). Cada uma tem teste de regressão dedicado comprovando que a liberação é exclusiva desse par e desses critérios.
- **203 permanecem bloqueadas** — sem exceção editorial documentada, portanto tratadas com segurança: a relação é mantida bloqueada e documentada, exatamente como pedido ("mantenha a relação bloqueada e documente o motivo").
- Nenhuma regra de equivalência (`purposePreserved`, `equipmentShared`) foi relaxada globalmente.

## 6. Tratamento dos 41 exercícios em rascunho

Sem alteração em `src/data/exercisesV3DraftData.ts` (confirmado byte-a-byte: todas as 7 regiões `pending`, todas as 3 disponibilidades `false`, `status: 'draft'`). O dataset V3 referencia os 41 ids livremente (129+120 = 249 ocorrências como alvo/âncora), mas o resolvedor os trata como indisponíveis via `catalog.get(id) === undefined` (eles nunca entram em `EXERCISES_SEED`/`CANONICAL_ACTIVITIES`/`loadLocalExerciseCatalogForLimitations()`) — mesmo efeito prático de `pending`, sem exigir perfil. Teste dedicado comprova que uma relação com exceção editorial aceita e alvo rascunho **continua bloqueada** (`CANDIDATE_NOT_FOUND`) — a exceção nunca libera disponibilidade operacional.

## 7. Consistência app/backend

`functions/src/workoutLifecycle/exerciseSubstitution.ts`'s `isRequestedSubstitutionEligible` chama a mesma `evaluateManualSubstitutionCandidate` do app, agora já incluindo a correção de exceções (o backend foi resincronizado via `scripts/syncPrescriptionEngineToFunctions.cjs`, que já incluía `substitutionPolicyV3`/`dataset.json` na lista de sincronização). Teste de paridade exaustivo (`matches the pure V3 preview for every listed operational context...`) reconfirmado passando após a correção — compara, para **cada** relação listada no dataset, se o preview puro e a validação direta do backend concordam exatamente.

## 8. Testes adicionados nesta etapa

Arquivos novos/modificados:

- `src/workoutPrescription/__tests__/substitutionPolicyV3.test.ts` — 6 testes novos cobrindo: importação exata das 120 exceções, atribuição à relação exata (não à linha), escopo estritamente limitado (equipamento/segurança/disponibilidade nunca liberados), bloqueio preservado para rascunho mesmo com exceção aceita, e recuperação por região exata via `editorialExceptionScopeV3`. Teste "221 ocorrências" atualizado para refletir 18 recuperadas / 203 bloqueadas (antes afirmava 0/221 — ficou obsoleto pela própria correção pedida).
- `src/workoutPrescription/__tests__/substitutionPolicyV3Regression.test.ts` (novo arquivo) —
  - Comparação formal dos 102 templates × 127 cenários de região (promovida do script solto `auditSubstitutionsV3.ts` para teste automatizado, com baseline legada travada e contagem V3 isolada travada).
  - Flag desativada ⇒ saída idêntica à legada explícita, para os 102 templates.
  - Preferências permanentes com política V3 explícita: caminho válido (aplica) e caminho de colisão (mantém a regra de "primeiro slot ganha, sem terceira opção").
  - Reversão ao original (`evaluateRevertToAnchor`) comprovadamente independente de política — nunca exige autorização editorial.
  - Segurança com múltiplas limitações: para cada par (âncora, candidato) aprovado numa região mas não noutra, a intersecção de regiões ativas rejeita corretamente.

## 9. Validação executada

- `npm run typecheck` (app): limpo.
- `npm run typecheck` (functions, inclui sincronização automática via `pretypecheck`): limpo.
- `npx eslint` nos 8 arquivos tocados: 0 erros, 2 avisos pré-existentes e não relacionados (um deles já existia antes desta etapa).
- Suíte completa do app: **44 falhas, 7.900 passaram, 228 ignorados** (632 arquivos: 594 passaram, 16 falharam, 22 ignorados). As 16 falhas são **exatamente** as mesmas 16 já documentadas nos relatórios das Etapas 2/2.1 (nenhuma nova, nenhuma removida).
- Suíte completa do backend (`functions/`): **0 falhas, 2.022 passaram, 391 ignorados** (186 arquivos: 156 passaram, 30 ignorados).

## 10. Arquivos criados/modificados nesta etapa de correção

**Modificados:** `scripts/importSubstitutionsV3.py`, `scripts/auditSubstitutionsV3.ts`, `src/workoutPrescription/substitutionPolicyV3.ts`, `src/workoutPrescription/limitationResolver.ts`, `src/workoutPrescription/manualSubstitutionResolver.ts`, `src/prescriptionEvolution/equivalence.ts`, `src/workoutPrescription/__tests__/substitutionPolicyV3.test.ts`, `docs/substitutions-v3/dataset.json` (regenerado), `docs/substitutions-v3/integrity-report.json` (regenerado).

**Criados:** `src/workoutPrescription/__tests__/substitutionPolicyV3Regression.test.ts`, os três relatórios desta entrega.

**Não alterados** (herdados da auditoria, aproveitados): `functions/src/workoutLifecycle/exerciseSubstitution.ts` e seu teste, `src/services/exerciseSubstitutionCandidates.ts`, `src/services/workoutExecutions.ts`, `src/workoutPrescription/composition.ts`, `src/workoutPrescription/compositionV127.ts`, `src/workoutPrescription/manualSubstitutionCatalog.ts`, `src/workoutPrescription/musculoskeletalLimitationV127.ts`, `src/prescriptionEvolution/cycleEvolution.ts`, `scripts/syncPrescriptionEngineToFunctions.cjs`, `src/data/exercisesV3DraftData.ts`.
