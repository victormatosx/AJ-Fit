> Registro histórico: o sistema musculoesquelético e as políticas clínicas V3/legacy descritos aqui foram descontinuados. Não são contratos atuais. Ver [remoção definitiva](../removal-physical-limitations/REPORT.md).

# AJ Fit — Etapa 6A: finalização do motor V3 e integração

`ACTIVE_SUBSTITUTION_POLICY` permanece `'legacy'`. Nenhum rascunho ativado, nenhuma decisão editorial da planilha alterada, nenhum perfil musculoesquelético inventado, nenhuma escrita real, nenhum commit/push/deploy.

## 1. Correções implementadas

**Hierarquia editorial-primeiro** (`src/workoutPrescription/substitutionPolicyV3.ts`, função `editorialExceptionScopeV3`): uma relação listada como aprovada no dataset V3 (`editorialCandidatesV3`) agora dispensa, por si só, as verificações genéricas de equivalência (`purposePreserved` — padrão de movimento/músculo — e o critério de mecânica compound/isolation). Antes, essa dispensa só valia para as 129 relações com um comentário editorial registrado (`exceptionAccepted`); agora vale para **qualquer** relação listada, exatamente como pedido ("uma relação aprovada pode dispensar verificações genéricas de equivalência"). Mudança de uma única função — os três pontos de consumo (`limitationResolver.ts`, `manualSubstitutionResolver.ts`, `prescriptionEvolution/equivalence.ts`) já chamavam essa função e não precisaram de alteração.

**O que permanece intocado, para toda relação, aprovada ou não:**
- Autorização editorial em si (`V3_RELATION_NOT_AUTHORIZED` se a relação não está na lista) — nunca dispensada.
- Ambiente (academia/casa) — separado por desenho, nunca misturado.
- Disponibilidade operacional e equipamento (`CANDIDATE_NOT_FOUND`, `EQUIPMENT_UNAVAILABLE`, draft/rascunho ausente do catálogo).
- Segurança musculoesquelética por região ativa (`validateLimitationProfile` — perfil `avoid`/`pending`/inválido/ausente nunca é tratado como aprovado).
- Ordem de prioridade editorial 1/2/3 entre os elegíveis.
- `REVISAR`, `SEM SUBSTITUIÇÃO ACEITA` e condicionais não verificadas — excluídos antes mesmo de chegar a essa função, porque `editorialCandidatesV3` já filtra por `state === 'listed'` e `conditions.length === 0`.
- Os 41 rascunhos — continuam fora do catálogo operacional (`CANDIDATE_NOT_FOUND`), a aprovação editorial nunca os torna disponíveis.

**Teste de integração real novo** (`functions/src/workoutLifecycle/__tests__/exerciseSubstitution.integration.test.ts`, opt-in `npm run test:integration:exerciseSubstitution`): valida a transação completa do callable `applyExerciseSubstitutionHandler` contra um Firestore Emulator real, via Admin SDK (que não passa pelas Rules de cliente, por desenho — não é um enfraquecimento de regra, é o mesmo caminho que o Cloud Functions real usa em produção).

## 2. Relações recuperadas e ainda bloqueadas

Das **221 ocorrências** originalmente rejeitadas pelos validadores (auditoria pré-V3):

| | Quantidade |
|---|---:|
| Recuperadas pela hierarquia editorial-primeiro | **167** |
| Ainda bloqueadas | **54** |

As 54 ainda bloqueadas têm **exclusivamente** um destes motivos — nenhuma por equivalência genérica:

| Motivo | Quantidade |
|---|---:|
| `LIMITATION_PROFILE_MISSING` (perfil ausente — os 10 exercícios já documentados na Etapa 5) | 50 |
| `EQUIPMENT_UNAVAILABLE` | 3 |
| `LIMITATION_CANDIDATE_EQUIPMENT_UNAVAILABLE` | 1 |

Visão geral do dataset (1.156 relações principais): **871 elegíveis no motor isolado (antes: 727), 285 bloqueadas (antes: 429)**. Cobertura de templates/regiões: sem limitações 102/102 (inalterado); uma limitação **192/714** (antes 117); combinações não vazias **404/12.954** (antes 321). A linha de base legada (629/8.932) permanece distante porque a causa dominante documentada na Etapa 5C — ausência de qualquer relação editorial para ~93,5% dos pares exercício×região em cenários multi-limitação — é uma lacuna de conteúdo da planilha, não algo que uma mudança de arquitetura possa preencher.

**Consequência explícita a registrar:** isso recupera, por construção, as 51 relações "B" (possível falso bloqueio) na íntegra e as 80 relações "C" (pendentes de revisão profissional) da Etapa 4 — todas elas já tinham perfil musculoesquelético compatível/aprovado para a região ativa (por isso só apareciam bloqueadas por `PURPOSE_MISMATCH`/`ROLE_MISMATCH`/`V3_ROLE_MISMATCH`/`LIMITATION_CANDIDATE_PURPOSE_MISMATCH`, nunca por motivo de perfil). A hierarquia desta etapa trata a aprovação editorial somada à segurança por perfil como suficiente, sem exigir uma segunda aprovação algorítmica de similaridade — exatamente a regra pedida nesta etapa. Nenhum perfil foi alterado ou inventado para viabilizar isso.

## 3. Resultado da integração app/backend

- Teste de paridade preview/backend existente (`functions/.../exerciseSubstitution.test.ts`, compara TODA relação do dataset) continua passando (16/16) após a mudança — preview e backend seguem concordando exatamente.
- Teste de integração real novo (Admin SDK + Emulador Firestore, 10/10 passou): sessão antiga sem `substitutionPolicySnapshot` rejeita um candidato só-aprovado-em-v3; a mesma sessão fixada em `v3` aceita; candidato genuinamente não listado continua rejeitado mesmo fixada em v3; proteção de série concluída; idempotência; reversão ao original; preferência permanente (escrita e remoção); e confirmação de que a decisão segue a política fixada na sessão mesmo com a constante global do processo em `legacy` o tempo todo (rollback-safety).
- Composição v1.27 (`composeTemplateV127`) e resolvedor de limitações, evolução/rotação (`evaluateEquivalenceCandidate`) e preferências permanentes (`resolvePermanentSubstitutionsForSession`) usam a mesma função central (`editorialExceptionScopeV3`), então não há caminho divergente possível por construção.

## 4. Resultado dos testes

- `npx tsc --noEmit` (app e functions): limpo.
- `npx eslint` nos arquivos tocados: 0 erros.
- Suíte completa do app: **44 falhas — exatamente os mesmos 16 arquivos já documentados nas etapas anteriores**, 7.906 passaram, 232 ignorados. Nenhuma falha nova.
- Suíte completa do backend: **0 falhas**, 2.026 passaram, 401 ignorados (+10 do novo arquivo de integração, que fica skip por padrão).
- Suíte de integração do callable via Emulador real (Admin SDK): **10/10 passou.**
- Suíte de integração do app via SDK cliente (sujeita às Rules): continua bloqueada pelo limite de 1.000 expressões do emulador — já investigado e documentado como pré-existente na Etapa 5D/5C; não refeito aqui, não há nada novo a acrescentar além do que já foi registrado, e o teste via Admin SDK acima cobre a mesma lógica de transação sem depender dele.

## 5. Pendências exclusivas da 6B e da 6C

- As 50 relações com perfil musculoesquelético ausente (10 exercícios) — dependem de revisão profissional para ganhar perfil; fora do código.
- As 800 lacunas de cobertura editorial (nenhuma relação declarada para muitos pares exercício×região) — dependem de expansão da planilha pelos editores; priorização já entregue na Etapa 5C.
- A regra de desempate multi-região (ordem estrita entre regiões) — já simulada e recomendada para manter; não houve pedido de alteração nesta etapa.
- Suíte de integração via SDK cliente (sujeita às Rules reais) permanece bloqueada pelo limite do emulador — considerar atualizar a versão do `firebase-tools`/emulador ou revisar a complexidade de `firestore.rules` como item de infraestrutura, fora do escopo desta etapa.
- Ativação da V3, publicação da planilha completa, vídeos/perfis dos 41 rascunhos, homologação em iPhone — inalterado desde as etapas anteriores.

**Critério de conclusão atendido:** o motor agora respeita a autoridade editorial da planilha (relação aprovada não é mais rejeitada só por semelhança algorítmica), todas as proteções de segurança/disponibilidade/ambiente permanecem intactas e testadas, e o comportamento app/backend é consistente (testes de paridade e de integração real passando). V3 permanece desativada. Aguardando autorização para a Etapa 6B.
