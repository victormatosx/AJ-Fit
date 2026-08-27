# Limitation Dataset — Remediation Plan

Generated: 2026-08-27.

This document is the output of the remediation-preparation phase. It makes
**no clinical decisions** and **no dataset edits**. It exists to (1) confirm
the project's own existing contract for `avoid`/`adapt` before touching
anything, (2) separate the 176 known failures into classes that may need
different kinds of resolution, and (3) define the process/tooling that will
let content review actually close them out safely.

## 1. Contrato comprovado de `avoid`

Fonte: `01_LIMITATION_SCHEMA.md` e `03_SUBSTITUTION_STRATEGY.md`.

> "avoid: o exercício original é rejeitado para a região; candidatos ainda
> precisam passar por todas as outras constraints."

> "avoid com substituteExerciseIds=[] e candidateStatus=missing_exercise_candidate
> é uma regra V1 válida. Ela não é gap de integridade do profile: representa
> decisão explícita de rejeitar o original sem alternativa cadastrada e conduz
> a NO_SAFE_SUBSTITUTION."

Ou seja, o contrato já definido é a opção **(D) bloqueio da prescrição**
(via `NO_SAFE_SUBSTITUTION` → `INVALID_CONFIGURATION` no motor), nunca (B)
remoção silenciosa do exercício nem (C) troca de template. Isso está correto
e não deve mudar — é o comportamento fail-closed intencional do produto.

**Consequência prática**: uma regra `avoid` com lista vazia não é, por si só,
um bug de dataset. É uma decisão explícita ainda sem substituto aprovado.
**110 dos 176 casos são exatamente isso** — decisões pendentes, não erros de
integridade.

## 2. Contrato comprovado de `adapt`

Fonte: `01_LIMITATION_SCHEMA.md`, `03_SUBSTITUTION_STRATEGY.md`,
`20_PHASE5_LIMITATION_RESOLVER.md`.

> "Na implementação V1, só é válido quando aponta para uma variante real do
> catálogo." / "adapt: exige uma única exercise_variant concreta. A variante
> precisa existir, estar ativa/habilitada, preservar pattern e músculo
> primário, possuir profile aprovado, ser diretamente compatible/not_applicable
> para todas as regiões e ser executável no ambiente. Falha retorna
> LIMITATION_ADAPTATION_INVALID; não há improviso."

> "A V1 é explicitamente não recursiva... Por isso ciclos como A ↔ B são
> detectados e reportados, mas não bloqueiam a persistência V1."

## 3. Conclusão sobre `adapt → adapt`

**O dataset NÃO foi escrito assumindo adaptação transitiva será seguida em
runtime.** O contrato documentado sempre exigiu terminal direto; a não
recursividade é uma decisão de design deliberada (não um limite acidental),
registrada e justificada: seguir cadeias introduziria ciclos, comportamento
difícil de prever e maior superfície de validação clínica — exatamente os
riscos que o usuário pediu para não reintroduzir.

`16_PHASE3_V2_FINAL_READINESS.md` já auditou e listou **11 ciclos globais**
como "detectados, não bloqueantes para persistência" — ou seja, sabia-se que
esses pares específicos ficariam inválidos em runtime até receberem um
target terminal direto. Isso confirma: os 53 casos da CLASSE 2 não são um
bug de implementação do resolver — são exatamente o tipo de gap que o design
já previa precisar de revisão de conteúdo posterior.

**Não alterei o resolver para seguir cadeias.** Isso contrariaria um design
intencional e documentado.

## 4. As quatro classes (não corrigir todas da mesma forma)

| Classe | Descrição | Qtd | Exige decisão clínica? |
|---|---|---:|---|
| 1 — Dataset contraditório | `adapt` aponta para um target que o próprio profile marca `avoid` na mesma região (ex.: `plank.knee → dead-bug`, `dead-bug.knee = avoid`) | 8 | Sim |
| 2 — Adaptação não terminal | `adapt` aponta para um target cujo próprio status é `adapt` (cadeia/ciclo) | 53 | Sim |
| 3 — Avoid sem estratégia executável | `avoid` com `substituteExerciseIds=[]` (decisão explícita, ainda sem substituto aprovado) | 110 | Sim |
| 4 — Target tecnicamente incompatível | Target rejeitado por propósito/músculo/padrão de movimento, disponibilidade ou equipment | 5 | Sim |

**Nenhuma das 176 pode ser corrigida sem decisão de conteúdo.** Não há casos
de referência quebrada (`adapt`/`avoid` para ID inexistente) nem
autorreferência no conjunto atual — ambos já são impossíveis estruturalmente
(`ruleValid` no resolver rejeita a persistência desses casos, e o quality
gate abaixo confirma isso em todo o catálogo, não só nos 71 usados). Ou
seja: **0 dos 176 são erros técnicos/de digitação puros** — todos dizem
respeito a adequação biomecânica real de um exercício ou substituto.

## 5. Novo modelo de "revisado"

O conceito anterior — "76/116 exercícios têm `limitationProfile`" — mede
apenas *preenchimento*, não *validade*. Prova: **100% das 176 falhas estão
dentro dos 76 já "revisados"**. Proposta (ainda não aplicada a nenhum dado —
isto é uma proposta de processo, não uma migração de schema):

```
ReviewStatus (linha do remediation matrix, por exerciseId:region):
  PENDING                 → identificado pela auditoria, ainda não triado
  NEEDS_CLINICAL_REVIEW   → triado, aguardando decisão de conteúdo/clínica
  APPROVED                → decisão aprovada, ainda não aplicada ao dataset
  REJECTED                → proposta revisada e rejeitada; precisa de nova proposta
  RESOLVED                → aplicada ao dataset E revalidada pelo resolver real (quality gate)
```

Um exercício só deveria ser considerado **production-ready** para uma dada
região quando:

1. tem decisão de conteúdo registrada (`APPROVED`);
2. tem aprovação clínica quando a política do produto exigir
   (`reviewBasis=professional_review`, quando aplicável);
3. **passa pelo resolver real** (`classifyPair` → `VALID_*`), não apenas
   pela validação estrutural do profile;
4. é revalidado especificamente nos templates onde é alcançável (não em
   abstrato) — um exercício pode estar correto para um conjunto de regiões
   mas isso só importa se ele de fato aparece em algum T001–T090.

Isso substitui "76/116 preenchidos" por "quantos das 497 combinações
realmente alcançáveis passam pelo resolver real" — a métrica que já é
produzida por `scripts/auditLimitationDataset.ts` e agora tem baseline
versionado (seção 8 do relatório de auditoria).

## 6. O que muda nesta fase (preparação, não correção)

- `scripts/generateLimitationRemediationMatrix.ts` — gera a matriz de 176
  linhas + fila de decisão agrupada, a partir do audit já aprovado.
- `scripts/generateLimitationDatasetBaseline.ts` — gera o baseline por
  `exerciseId:region`.
- `src/workoutPrescription/__tests__/limitationDatasetQualityGate.test.ts` —
  gate de CI (ver `LIMITATION_DATASET_AUDIT.md` §Quality Gate futuro para a
  estratégia completa).
- Nenhum profile, target, template, resolver ou engine foi alterado.
