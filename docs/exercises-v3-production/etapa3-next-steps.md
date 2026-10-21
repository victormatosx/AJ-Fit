> Registro histórico: o sistema musculoesquelético e as políticas clínicas V3/legacy descritos aqui foram descontinuados. Não são contratos atuais. Ver [remoção definitiva](../removal-physical-limitations/REPORT.md).

# AJ Fit — Etapa 3: plano da próxima etapa (pendências antes da ativação em produção)

A V3 está tecnicamente pronta para homologação local, mas **nenhum destes itens foi concluído** e todos são pré-requisitos antes de considerar qualquer ativação global.

## 1. Mídia dos 41 exercícios em rascunho

Herdado das Etapas 2/2.1, sem alteração nesta etapa: apenas 3 dos 41 têm vídeo produzido (`dumbbell-flat-bench-press`, `dumbbell-triceps-kickback`, `lying-dumbbell-triceps-extension`), todos em status "PRODUZIDO — AGUARDANDO REVISÃO" (falta tomada vertical nativa, revisão humana do clipe completo e teste em dispositivo real). Os outros 38 não têm nenhuma fonte de vídeo associada. Sem vídeo aprovado, nenhum dos 41 pode sair de `status:'draft'`.

## 2. Perfis musculoesqueléticos dos 41 rascunhos

As 7 regiões de cada um dos 41 permanecem `pending` por desenho — nenhuma foi revisada clinicamente. Isso precisa de revisão profissional explícita (`reviewBasis:'professional_review'`) antes de qualquer promoção ao catálogo operacional. Enquanto pendente, qualquer relação V3 que referencie esses ids continua corretamente bloqueada.

## 3. As 203 relações ainda bloqueadas sem exceção editorial

A reauditoria desta etapa separa exatamente quais das 221 ocorrências originalmente problemáticas (e as demais do dataset) seguem bloqueadas e por qual motivo técnico (`docs/substitutions-v3/integrity-report.json`, campo `relations[].v3Reasons`). Decisão necessária, caso a caso, não em lote:

- **`LIMITATION_PROFILE_MISSING` (50 ocorrências)**: resolver a divergência pré-existente entre `EXERCISES_SEED` (sem perfis) e o catálogo remoto Firestore (com perfis) — já documentada na auditoria original, fora do escopo desta etapa.
- **`LIMITATION_CANDIDATE_PURPOSE_MISMATCH`/`V3_ROLE_MISMATCH` sem exceção (112/76 ocorrências)**: cada uma precisa de uma decisão editorial explícita — aceitar como nova exceção documentada (com o mesmo mecanismo desta etapa), ou manter bloqueada permanentemente.
- **249 ocorrências envolvendo os 41 rascunhos**: resolvidas automaticamente, sem reescrever a planilha, no momento em que cada rascunho for promovido (itens 1 e 2).

## 4. As 139 alternativas condicionais

Nenhuma das 139 tem uma condição estruturada e verificável hoje — todas são texto editorial livre (“Requer regra futura de seleção por objetivo/perfil”). Antes de qualquer uma entrar em uso, é necessário: (a) definir o esquema de dados que tornaria a condição verificável em tempo de execução (ex.: objetivo do usuário, perfil de treino), (b) implementar o check correspondente, (c) mover a condição de `pending_conditions` para `editorial` apenas após ambos existirem e serem testados.

## 5. Compatibilidade de clientes

`validateSubstitutionPolicyActivation` já bloqueia ativação por desenho (`V3_ACTIVATION_BLOCKERS`), mas os 4 itens listados ali ainda não têm plano de implementação:

- `SESSION_AUTHORIZATION_SNAPSHOTS_NOT_MIGRATED`: decidir e implementar como uma sessão iniciada antes de uma futura virada de política continua autorizada a terminar com as regras antigas.
- `AUTHORITATIVE_CLIENT_CONTEXT_NOT_UNIFIED`: unificar as divergências preview/backend já conhecidas e fora do escopo da V3 (`equipmentContextFor` vs. `unrestrictedEquipmentContext` em `prescriptionEvolution.ts`, documentada na auditoria original).
- `MIXED_CLIENT_CAPABILITY_HANDSHAKE_NOT_IMPLEMENTED`: definir como o backend trata um cliente de app desatualizado que não entende a V3 (ou vice-versa).
- `NATIVE_AND_OFFLINE_HOMOLOGATION_PENDING`: testes reais em iPhone/Android, incluindo uso offline e sincronização posterior.

## 6. Testes ainda não executados (exigem dispositivo/ambiente real)

- Reprodução de vídeo com áudio externo (Spotify/Apple Music) nos 3 vídeos pilotos.
- Validação visual das telas de substituição com a V3 ativa (preview manual, modal, miniaturas) — hoje só testado via funções puras, nunca pela UI real.
- Teste de carga/performance do dataset de 1.156 relações + 139 condicionais no app real (o dataset é importado como JSON estático; o impacto no tamanho do bundle não foi medido).

## 7. Publicação coordenada (quando todos os itens acima estiverem prontos)

Sequência recomendada, nenhuma executada nesta etapa:

1. Publicar o dataset identity/hash num documento `v3SubstitutionDatasetState/active` (mesmo padrão de `limitationDatasetState/active`), preparado mas não escrito.
2. Atualizar `validateSubstitutionPolicyActivation` para exigir também esse hash publicado.
3. Remover os 4 itens de `V3_ACTIVATION_BLOCKERS` **um por um**, cada um com sua própria migração/teste — nunca todos de uma vez.
4. Só então mudar `ACTIVE_SUBSTITUTION_POLICY` para `'v3'`, sincronizar para `functions/` e fazer deploy coordenado cliente+backend.
5. Observar métricas de rejeição (`V3_RELATION_NOT_AUTHORIZED`, `NO_SAFE_SUBSTITUTION`) em produção antes de expandir a base de usuários afetados.

Nenhuma dessas ações foi iniciada. A V3 está pronta apenas para revisão humana e homologação local — não para produção.
