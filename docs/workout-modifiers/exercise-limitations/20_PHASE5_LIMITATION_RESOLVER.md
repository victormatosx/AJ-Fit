# Fase 5 — Limitation Resolver V1

Status do resolver: `PHASE_5_COMPLETE`.

Status de publicação das Rules: `RULESET_DEPLOY_PENDING`.

Este documento descreve comportamento conservador de produto. Os profiles com
`approved + product_policy` não são aprovação clínica individual nem liberação
clínica universal.

## Arquitetura

O resolver é uma função pura: recebe catálogo, regiões declaradas e o predicado
de executabilidade; não acessa Firestore. Em produção, quando o questionário
declara limitação musculoesquelética, o serviço carrega `exercises` uma única
vez, exige exatamente 116 documentos e entrega esse snapshot ao Prescription
Engine. Não há leitura por exercício.

Usuários sem limitação musculoesquelética não acionam essa leitura e não são
bloqueados pelos 40 exercícios sem profile. Para usuários com limitação, profile
ausente ou inválido falha fechado.

Pipeline efetivo:

```text
Questionnaire
  → Safety Gates
  → seleção Txxx
  → Limitation Resolver
  → equipment/environment
  → Beginner / Duration / Priority
  → validação final
  → snapshot
```

Safety continua soberano. Um resultado `BLOCKED` ou `REQUIRES_CLEARANCE` para
pregnancy, postpartum, frailty, dizziness, lipedema, post-surgical, medical
restriction ou outro gate termina antes da composição. Personalização não
resolve falha de limitação nem reintroduz o exercício rejeitado.

## Entrada e governança aceita

As respostas são mapeadas somente para `knee`, `hip`, `back`, `shoulder`,
`elbow`, `wrist` e `ankle_foot`, na ordem canônica. `none` é removido e
duplicatas são eliminadas. `other`, ou qualquer região não enumerada, retorna
`UNMAPPED_LIMITATION_REGION`.

O profile só é consumido quando possui:

- `schemaVersion = 1`;
- `protocolVersion = musculoskeletal-v1`;
- `reviewStatus = approved`;
- sete regiões explícitas e regras estruturalmente válidas;
- `reviewBasis = product_policy`, ou `professional_review` com campos de
  auditoria reais.

`draft`, profile ausente, versão desconhecida, região ausente ou shape inválido
falham fechado. O resolver não cria defaults e não preenche os 40 profiles
ausentes.

## Resolução por status

- `compatible`: mantém o exercício para a região.
- `not_applicable`: não adiciona restrição para aquela região; as demais ainda
  são avaliadas.
- `adapt`: exige uma única `exercise_variant` concreta. A variante precisa
  existir, estar ativa/habilitada, preservar pattern e músculo primário, possuir
  profile aprovado, ser diretamente `compatible`/`not_applicable` para todas as
  regiões e ser executável no ambiente. Falha retorna
  `LIMITATION_ADAPTATION_INVALID`; não há improviso.
- `avoid`: rejeita o original e percorre os `substituteExerciseIds` na ordem
  persistida. Seleciona o primeiro candidato que passa por todas as regiões,
  purpose, disponibilidade e equipment. Lista vazia é válida; se nenhum
  candidato passar, retorna `NO_SAFE_SUBSTITUTION`.

Com múltiplas limitações, cada candidato precisa ser diretamente aceito pela
interseção de todas as regiões. `avoid` no original tem precedência sobre
`adapt`; adaptações simultâneas só são executadas se convergirem para a mesma
variante concreta.

## Não recursividade e equipment

Substituições por limitação não encadeiam. Para `A → [B, C]`, B é validado
diretamente; se B pedir adaptação/substituição ou falhar, o resolver tenta C da
lista original de A. Nunca consulta os candidatos de B. Um conjunto
`visitedExerciseIds`, iniciado com o exercício original, impede retorno ao
original e protege contra loops.

O mesmo predicado de equipment do Composition Engine é reutilizado. Em `home`
e `both → home`, o candidato precisa usar apenas o inventário declarado; em
`gym` a infraestrutura do ambiente é considerada disponível. Se uma troca
posterior motivada por equipment for necessária, seus candidatos também passam
por validação direta de todas as limitações, de modo que equipment não
reintroduz um exercício incompatível.

## Reason codes

Falhas públicas e determinísticas:

- `LIMITATION_PROFILE_MISSING`;
- `LIMITATION_PROFILE_NOT_APPROVED`;
- `LIMITATION_PROFILE_VERSION_UNSUPPORTED`;
- `LIMITATION_PROFILE_INVALID`;
- `UNMAPPED_LIMITATION_REGION`;
- `LIMITATION_ADAPTATION_INVALID`;
- `NO_SAFE_SUBSTITUTION`.

O trace de candidatos também registra causas internas como indisponibilidade,
equipment, purpose divergente, profile do candidato e proteção de visitados.

## Trace e versionamento

`PRESCRIPTION_VERSIONS` agora inclui `limitationResolver: "1.0.0"`; o trace
inclui `limitationResolverVersion: 1` e uma decisão por slot avaliado. Cada
decisão registra:

- `originalExerciseId`, `finalExerciseId` e `regionsEvaluated`;
- `resolution`: `compatible`, `adapted` ou `substituted`;
- `reasonRegions` e, quando aplicável, candidatos avaliados em ordem;
- `protocolVersion` e `reviewBasis`.

O snapshot guarda a decisão, não copia o `limitationProfile`. O `planId` inclui
as decisões e versões, evitando reinterpretar snapshots antigos.

## Validação executada

- testes unitários do resolver: profiles reais 76/116, todos os statuses,
  múltiplas regiões, profiles inválidos, adaptação, lista ordenada, equipment,
  profile ausente, `professional_review`, região não mapeada e ciclo;
- integração do pipeline: home/gym/both, população especial, Beginner,
  Duration, Priority, adaptação e substituição reais, ausência entre os 40 e
  preservação dos 90 templates;
- suíte direcionada do Prescription Engine;
- TypeScript do app;
- suíte completa do app;
- 13 arquivos e 318 testes de Firestore Rules no emulador;
- `git diff --check` no fechamento.

## Firestore Rules

O ruleset local remove o bloqueio genérico de limitações somente quando o
programa apresenta evidência versionada do resolver e o questionário contém
exclusivamente regiões canônicas. Casos sem evidência, com `other` ou com o
contrato legado continuam negados. Os testes do emulador passam.

O arquivo `firestore.rules` já continha alterações locais de outros fluxos. A
equivalência e prontidão de todas essas mudanças para produção não podem ser
provadas isoladamente nesta fase. Por isso nenhum deploy foi feito e o status
permanece `RULESET_DEPLOY_PENDING`. A publicação exige revisão/deploy conjunto
do ruleset completo; isso não bloqueia a conclusão do resolver, mas bloqueia o
rollout integral em produção.

## Escopo preservado

Não houve escrita em Firestore, alteração dos 76 profiles, preenchimento dos 40
profiles ausentes, alteração dos T001–T090, UI, Progression, Schedule ou Workout
Execution. Não houve commit nem push.
