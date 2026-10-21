> Registro histórico: o sistema musculoesquelético e as políticas clínicas V3/legacy descritos aqui foram descontinuados. Não são contratos atuais. Ver [remoção definitiva](../removal-physical-limitations/REPORT.md).

# AJ Fit — Etapa 6B: fechamento definitivo do conteúdo V3

`ACTIVE_SUBSTITUTION_POLICY` permanece `'legacy'`. Nenhuma decisão editorial da planilha foi alterada, nenhum perfil musculoesquelético foi inventado ou inferido por semelhança, nenhum rascunho ativado, nenhuma escrita real, nenhum commit/push/deploy. Esta etapa não alterou nenhum arquivo de código de produção — é consolidação, verificação e documentação sobre o estado já implementado na Etapa 6A.

## 1. Relações operacionais e bloqueadas, por motivo

Classificação final das **1.156 relações principais** (cada uma uma aresta `(âncora, candidato)` dentro de um grupo editorial `listed`):

| Classificação | Quantidade | Motivo exato |
|---|---:|---|
| **OPERACIONAL** | **871** | Aprovada editorialmente, ambiente correto, exercício e equipamento disponíveis, segurança musculoesquelética satisfeita quando aplicável. |
| **BLOQUEADA — PERFIL** | **50** | `LIMITATION_PROFILE_MISSING` — candidato sem perfil musculoesquelético registrado (10 exercícios, ver seção 2). |
| **BLOQUEADA — EQUIPAMENTO** | **4** | `EQUIPMENT_UNAVAILABLE`/`LIMITATION_CANDIDATE_EQUIPMENT_UNAVAILABLE` — um único exercício (`slider-leg-curl`), equipamento `slider` corretamente fora do conjunto doméstico (ver seção 4). |
| **BLOQUEADA — EXERCÍCIO** | **231** | Âncora ou candidato é um dos 41 rascunhos (`SOURCE_DRAFT`/`TARGET_DRAFT`) ou é uma atividade cardio/mobilidade fora do catálogo de resistência (`SOURCE_NOT_IN_RESISTANCE_CATALOG`/`TARGET_NOT_IN_RESISTANCE_CATALOG`). |
| Não classificável nos motivos acima | **0** | Confirmado: toda relação bloqueada tem exatamente uma causa das três acima — nenhum "outro motivo" residual. |

**871 + 50 + 4 + 231 = 1.156.** Nenhuma relação ficou sem causa identificável e reproduzível.

**Fora das 1.156** (nunca chegam a ser candidatas, por desenho — categoria **BLOQUEADA — EDITORIAL**):
- **27 grupos** com estado editorial explícito e zero relações: **26 `REVISAR`** (5 academia + 21 casa) + **1 `SEM SUBSTITUIÇÃO ACEITA`** (`dumbbell-fly` + `shoulder`, casa).
- **139 alternativas condicionais** — nunca entram em `editorialCandidatesV3` (condição textual não verificável).

## 2. Os 10 exercícios e 50 relações sem perfil

Investigação completa, sem inferência: os 10 exercícios responsáveis pelas 50 relações (`bulgarian-split-squat-machine`, `cable-lateral-raise`, `cable-skull-crusher`, `face-pull`, `incline-dumbbell-curl`, `lat-pulldown-supinated-grip`, `leg-press-45-unilateral`, `low-cable-row-close-supinated-grip`, `seated-calf-raise-machine`, `stiff-leg-deadlift-machine`) foram checados contra **todas** as fontes oficiais do projeto: o catálogo local (`exercisesSeedData.ts`), o snapshot remoto do Firestore já extraído na auditoria original (`ajfit_substituicoes_auditoria_completa.json`), e o resumo técnico consolidado (`dataset_tecnico_local.summary`).

**Resultado: o projeto tem exatamente 95 perfis aprovados no total — local e remoto coincidem em 95, nenhum perfil a mais existe em nenhuma fonte.** Os 10 exercícios estão entre os 35 exercícios sem perfil documentados desde a auditoria original (Etapa 1) — não há nenhuma classificação profissional aprovada em nenhuma fonte oficial para reutilizar. Nenhum perfil foi copiado de exercício semelhante, nenhuma classificação foi inventada. **0 de 10 resolvidos; 10 de 10 permanecem bloqueados.**

Ficha objetiva por exercício (para validação profissional futura):

| Exercício | Regiões afetadas | Relações bloqueadas |
|---|---|---:|
| `low-cable-row-close-supinated-grip` | back, shoulder | 11 |
| `stiff-leg-deadlift-machine` | knee, shoulder, ankle_foot | 11 |
| `leg-press-45-unilateral` | hip, wrist | 5 |
| `bulgarian-split-squat-machine` | back, wrist | 5 |
| `incline-dumbbell-curl` | back | 5 |
| `cable-lateral-raise` | elbow | 4 |
| `cable-skull-crusher` | back, shoulder | 3 |
| `lat-pulldown-supinated-grip` | shoulder | 3 |
| `seated-calf-raise-machine` | back, ankle_foot | 2 |
| `face-pull` | shoulder | 1 |

## 3. Situação individual das 80 relações C liberadas na 6A

Verificação direcionada confirmou, para cada uma das 80:
- **Autorização editorial explícita**: sim — todas estão em `editorialCandidatesV3`'s output; nenhuma foi adicionada fora da planilha.
- **Perfil existente e com status terminal para a região aplicável**: sim — 53 com `compatible`, 27 com `not_applicable`; **zero** com `avoid`/`pending`/perfil ausente ou inválido.
- **Incompatibilidade objetiva documentada**: nenhuma encontrada.

**Distinção explícita entre aprovação editorial e validação profissional**, conforme pedido: as 80 relações usam perfis com `reviewBasis: 'product_policy'` — **sem exceção**. Isto não é uma lacuna específica destas 80: verificado para o catálogo inteiro, **os 95 perfis aprovados do sistema inteiro (100%) são `product_policy`; nenhum exercício no projeto, em nenhum contexto, tem hoje um perfil com `reviewBasis: 'professional_review'`**. As 80 relações estão, portanto, no mesmo padrão de aprovação que qualquer outra relação ativa do sistema — nem mais, nem menos revisadas. Nenhuma validação clínica foi declarada aqui; o teste automatizado passando comprova apenas que a relação satisfaz o padrão de segurança (perfil terminal) já em vigor para toda a V3, não uma revisão médica.

Nenhuma das 80 foi desfeita ou re-bloqueada — nenhuma evidência de risco objetivo foi encontrada que justificasse isso.

## 4. Os quatro bloqueios de equipamento

As 4 ocorrências (`EQUIPMENT_UNAVAILABLE`×3, `LIMITATION_CANDIDATE_EQUIPMENT_UNAVAILABLE`×1) têm **uma única causa raiz**: todas apontam para o mesmo candidato, `slider-leg-curl`, em ambiente `home`. O exercício exige equipamento `slider`, e `slider` é **deliberadamente** excluído do conjunto de equipamentos domésticos respondíveis pelo questionário (`EQUIPMENT_MAP`/`ALL_HOME_ANSWERABLE_EQUIPMENT` em `src/workoutPrescription/equipment.ts`) — mesma decisão de produto já documentada na auditoria original da Etapa 1 ("Equipamentos como slider/stationary_bike não entram nesse conjunto doméstico"). **Nenhuma inconsistência técnica encontrada — bloqueio correto, preservado.**

## 5. As 800 lacunas de cobertura

Nenhuma lacuna foi preenchida com substituição inventada. Comportamento determinístico confirmado:
- Quando `editorialCandidatesV3` não retorna candidato, `resolveManualSubstitutionCandidates` retorna `NO_ELIGIBLE_CANDIDATES` e `resolveExerciseLimitationsFromCandidates` retorna `FAILED`/`NO_SAFE_SUBSTITUTION` — nunca um fallback por família/similaridade, nunca uma exceção não tratada.
- `resolveDisplayCandidates` (client) já reduz esse resultado a uma lista vazia — **o mesmo contrato de "sem alternativa" que a tela já trata hoje para o sistema legado**, sem nenhum caminho de UI novo ou modificado nesta etapa. Sessão e dados do usuário permanecem intactos nesse caminho (nenhuma escrita ocorre quando não há candidato).
- Regra de desempate multi-região (ordem estrita entre regiões ativas) **mantida sem alteração**, conforme recomendado na Etapa 5C.

Lista priorizada (reaproveitada da Etapa 5C, sem recálculo — nada mudou nas regras declaradas pela planilha):

| Exercício | Ambiente | Região(ões) sem regra | Templates afetados |
|---|---|---|---:|
| `dumbbell-stiff-leg-deadlift` | gym/home | elbow, wrist | 96 |
| `plank` | gym/home | hip, ankle_foot | 84 |
| `dumbbell-lateral-raise` | gym/home | knee, hip, back, elbow, wrist, ankle_foot | 76 |

Região com maior lacuna agregada: `hip`; menor: `back`. 44 exercícios sem nenhuma região declarada; 44 com cobertura parcial. O preenchimento dessas 800 combinações é uma decisão editorial pendente, não uma pendência técnica — a conclusão técnica da V3 não depende de preenchê-las.

## 6. Inventário dos 41 rascunhos

Confirmado, byte a byte, sem alteração: **41/41** com `status: "draft"`, as 3 disponibilidades `false`, as 7 regiões `pending`. Nenhum vídeo novo, nenhum perfil novo. Herdado das Etapas 2/2.1: 3 dos 41 têm vídeo piloto produzido (status "AGUARDANDO REVISÃO", nenhum aprovado); os outros 38 não têm nenhuma fonte de vídeo.

**Todos os 41 são referenciados por relações da planilha** (231 ocorrências como âncora ou candidato bloqueado — ver seção 1). Dependência por exercício (nº de relações que dependem dele), do maior para o menor: `dumbbell-flat-bench-press` (16), `cable-rope-hammer-curl` (13), `dumbbell-sumo-squat` (13), `dumbbell-stationary-lunge` (13), `arnold-dumbbell-press` (12), `straight-arm-cable-pulldown` (11)... (lista completa com os 41 nos dados desta etapa). Nenhum rascunho foi apresentado como disponível em nenhum teste ou caminho de código — `CANDIDATE_NOT_FOUND` continua a resposta para qualquer um deles.

## 7. Decisões editoriais especiais — confirmação

Reverificado nesta etapa (via suíte de testes já existente, sem recriar auditoria): os **26 `REVISAR`**, o **1 `SEM SUBSTITUIÇÃO ACEITA`**, as **139 condicionais**, as **129 exceções editoriais** (120 da planilha + 9 do addendum da Etapa 5B), a ordem de prioridade 1/2/3, e a exigência de compatibilidade em **todas** as limitações ativas simultaneamente continuam exatamente como documentado — nenhum desses estados foi convertido em aprovação automática. Testes dedicados a cada um desses pontos passaram (`substitutionPolicyV3.test.ts`, 28/28; `substitutionPolicyV3Regression.test.ts`, 6/6, incluindo o teste específico de segurança multi-região).

## 8. Cobertura final e testes

| | Etapa 6A | Etapa 6B |
|---|---:|---:|
| Relações elegíveis (de 1.156) | 871 | **871 (inalterado — nenhuma relação nova foi liberada ou bloqueada nesta etapa)** |
| Sem limitações | 102/102 | 102/102 |
| Uma limitação | 192/714 | 192/714 |
| Combinações não vazias | 404/12.954 | 404/12.954 |

A Etapa 6B não alterou nenhuma relação, perfil ou regra — apenas verificou, classificou e documentou o que a 6A já havia implementado. Os números de cobertura são, portanto, idênticos por desenho.

**Testes:** `npx tsc --noEmit` (app e functions) limpo; suíte direcionada (`substitutionPolicyV3.test.ts` + `substitutionPolicyV3Regression.test.ts`, 34/34) passou sem alteração. Nenhum arquivo de produção foi tocado nesta etapa, então a suíte completa (app: 44 falhas pré-existentes/16 arquivos; backend: 0 falhas) não foi reexecutada por não haver alteração que a justificasse — já confirmada integralmente ao final da Etapa 6A.

## 9. Pendências externas (exigem decisão editorial ou aprovação profissional fora do código)

- **10 exercícios sem perfil** (50 relações) — aguardam avaliação profissional; fichas entregues na seção 2.
- **80 relações C** — aprovadas editorialmente e seguras pelo padrão `product_policy` já em vigor em todo o sistema; **nenhuma tem revisão clínica individual (`professional_review`) — e nenhuma outra relação do sistema tem, hoje, esse nível mais alto de revisão**. Decisão de produto (fora do código) se esse padrão uniforme é suficiente ou se alguma merece revisão clínica dedicada.
- **800 combinações exercício×ambiente×região sem regra declarada** — pendente de expansão editorial da planilha; lista priorizada entregue na Etapa 5C e reconfirmada na seção 5.
- **41 rascunhos** — vídeo e perfil pendentes (herdado, inalterado).
- **26 `REVISAR`, 1 `SEM SUBSTITUIÇÃO ACEITA`** — decisão editorial explícita de que não há alternativa adequada hoje; nada a resolver tecnicamente.

Nenhuma dessas pendências foi tratada como resolvida. Todas permanecem bloqueadas no código até que a decisão externa correspondente exista.

## Veredito

### **CONTEÚDO TECNICAMENTE FINALIZADO**

Toda relação tem classificação final rastreável e reproduzível (seção 1, soma exata 1.156). Nenhuma relação aprovada é rejeitada por equivalência genérica (confirmado — 0 relações bloqueadas por `PURPOSE_MISMATCH`/`ROLE_MISMATCH`/`V3_ROLE_MISMATCH`/`LIMITATION_CANDIDATE_PURPOSE_MISMATCH` em todo o dataset). Nenhuma relação sem autorização editorial foi liberada (verificado exaustivamente nos testes). Nenhum perfil ausente/pendente foi tratado como aprovado (0 de 10 exercícios "resolvidos" por inferência — todos permanecem bloqueados, corretamente). Nenhum rascunho foi disponibilizado. Casos sem substituição têm comportamento determinístico e seguro, idêntico ao já usado pelo sistema legado. Não há regressão nova no legado (suíte íntegra ao final da 6A, não alterada nesta etapa).

As pendências remanescentes (perfis de 10 exercícios, revisão opcional das 80 relações C, expansão editorial das 800 lacunas, vídeos/perfis dos 41 rascunhos) são **exclusivamente externas** — decisão editorial ou aprovação profissional que o código não pode e não deve resolver por conta própria. Tecnicamente, a implementação da V3 está completa dentro do que é possível resolver em código.

V3 permanece desativada. Aguardando autorização para a Etapa 6C.
