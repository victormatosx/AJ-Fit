# Persistência e versionamento

## Estado atual

Status: `IMPLEMENTED_V1`.

O catálogo 1.3.0 e as Rules deste contrato foram publicados no projeto
`ajfit-2f321` em 2026-08-25; o hash do ruleset publicado foi verificado contra
o arquivo local após o deploy.

```text
Questionnaire snapshot
  → seleção Txxx (índice local 1.3.0)
  → workoutTemplates/Txxx (conteúdo runtime Firestore)
  → Safety + Modifiers + Composition + Validation
  → users/{uid}/workoutPrograms/{programId}
  → users/{uid}/workoutProgramState/active
  → app carrega o snapshot; não recalcula ao abrir
```

O AsyncStorage anterior deixa de ser fonte do programa runtime. O JSON
`AJ_Fit_T001_T090_workouts_canonical_v1_3.json` é bootstrap versionado e índice
de seleção; o conteúdo usado pela composição em produção vem obrigatoriamente
do Firestore. Não existe fallback silencioso para o JSON se a leitura falhar ou
se a versão/hash divergir.

## Templates globais

Path: `workoutTemplates/{T001..T090}`. Document ID e `id` preservam o Txxx.

Campos: `version`, `sourceVersion`, `libraryId`, `contentHash` SHA-256,
`status`, profile normalizado, `split`, `rationale`, `assumptions`, `safety`,
sessões e slots. Cada slot guarda `exerciseId` string e somente a prescrição do
slot (`sets`, `reps`, `duration`, `cycles`, `intensity`, `notes`). Ordem é a
ordem dos arrays. Nome, tradução, mídia, instruções e metadata continuam em
`exercises/{exerciseId}`.

O seed `npm run seed:workout-templates` é dry-run por padrão. `--confirm` é a
única escrita; compara versão/hash, informa `CREATE/UPDATE/UNCHANGED/BLOCKED/
ERROR`, não deleta e preserva `createdAt`. Depois da escrita exige read-back de
90 templates, 378 sessões, 2.108 slots, nenhum extra e nenhum hash divergente.

## Programa personalizado

Path: `users/{uid}/workoutPrograms/{programId}`. O payload não contém `userId`:
ownership vem exclusivamente do path autenticado.

O snapshot guarda identidade própria, `prescriptionId`, template id/versão/
sourceVersion/hash, questionário id/versão, `source`, `active|superseded`,
adaptação Beginner quando aplicável, sessões finais, doses, substituições,
decisões, Safety, trace e todas as versões do motor. Não copia respostas do
questionário, perfil, traduções, vídeo nem documentos completos de exercícios.

`programId = wpg_<hash determinístico>` deriva do questionário/versionamento,
prescrição, template/hash e stage. Retry/double tap resolve ao mesmo documento.
Ativação, reativação e superseding ocorrem na mesma transaction do pointer.
Conteúdo de prescrição é imutável; apenas `status`, `activatedAt` e `updatedAt`
podem mudar.

## Ponte ativa

Path fixo: `users/{uid}/workoutProgramState/active`, com `programId` e
`updatedAt`. Foi escolhido em vez de mutar `users/{uid}.metadata.activeWorkoutId`
porque o contrato histórico desse documento já está próximo do limite de
expressões das Firestore Rules. O documento fixo mantém lookup O(1), não exige
índice/query e permite consistência transacional sem enfraquecer as regras do
perfil. `metadata.activeWorkoutId` permanece apenas como campo legado.

## Segurança e lifecycle

Templates: leitura autenticada; escrita somente admin/backend; delete negado.
Programas/state: leitura e escrita somente do dono; cross-user negado; delete
cliente negado. Timestamps são `serverTimestamp`. Rules prendem o snapshot ao
template/hash e ao questionário imutável, aceitam somente Safety `CLEAR` ou
`ADAPTED` e zero modifiers não resolvidos.

Limitação musculoesquelética canônica passa pelo Limitation Resolver antes da
persistência. O orquestrador carrega os 116 exercícios em uma query, e profiles
ausentes/inválidos, região `other`, adaptação inválida ou ausência de substituto
seguro falham fechado. As Rules locais só aceitam esse caso quando versões e
trace comprovam o resolver V1; sem essa evidência, continuam negando. Esse
ruleset local está testado, mas ainda não foi publicado
(`RULESET_DEPLOY_PENDING`) porque inclui alterações pendentes de outros fluxos.

Na criação de conta e na conclusão explícita do questionário, uma prescrição
válida é gerada. Usuário legado sem programa vê uma ação explícita de geração.
Montar o app/hook apenas lê o pointer e snapshot. Falha de rede não cria um
snapshot local fingindo persistência.

O stage Beginner utilizado (1/2/3 = 50%/70%/100%) é congelado. Uma futura
transição gera novo snapshot; nunca muta o anterior. Schedule, Progression,
execução e histórico de séries continuam fora de escopo.

## Versionadores

- template document `version=1`, `sourceVersion=1.3.0`, `contentHash`;
- selection `1.0.0`, safety `1.0.0`, limitation resolver `1.0.0`/trace `1`;
- modifier rules `2.0.0`, composition `2.0.0`;
- questionnaire `questionnaireVersion` do snapshot de origem.

Não há índice composto novo: templates e pointer usam get por document ID.
Exclusão de conta remove `workoutPrograms` e `workoutProgramState` antes do
documento pai.
