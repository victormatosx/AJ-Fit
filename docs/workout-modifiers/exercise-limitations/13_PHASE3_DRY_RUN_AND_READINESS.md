# Fase 3 — limitationProfile, dry-run e readiness

> **Superado em 2026-08-26:** os blockers descritos neste relatório histórico
> foram tratados pelo dataset técnico V2. O estado corrente está em
> `16_PHASE3_V2_FINAL_READINESS.md`; este arquivo permanece para rastreabilidade
> do dry-run V1.

Data: 2026-08-25.

Resultado: `BLOCKED` para write real. O dataset técnico é válido, mas faltam
profiles suficientes para candidatos externos executáveis, a governança de
`approved` não foi resolvida e há ciclos que precisam de decisão explícita.
Nenhuma escrita foi feita no Firestore.

## Fonte normativa e divergências internas

A fonte normativa foi exclusivamente
`11_GENERALIZED_CONSERVATIVE_LIMITATION_DATASET_v3.json`, versão
`3.0.0-generalized-conservative`. As 497 células regionais confirmam:

| Status | Quantidade |
|---|---:|
| `not_applicable` | 197 |
| `compatible` | 63 |
| `adapt` | 127 |
| `avoid` | 110 |
| `unknown` | 0 |
| **Total** | **497** |

O resumo embutido na V3 possui dois valores obsoletos/inconsistentes com suas
próprias células: `adaptCount=72` em vez de 127,
`avoidWithoutSubstituteCount=0` em vez de 110 e `lowConfidenceCount=165` em
vez de zero (as células têm 197 `high` e 300 `medium`). A conversão não corrigiu nem
reinterpretou células; registrou as divergências e usou as decisões regionais.

## Schema técnico utilizado

```ts
interface ExerciseLimitationProfile {
  schemaVersion: 1;
  protocolVersion: 'musculoskeletal-v1';
  reviewStatus: 'draft';
  regions: Record<LimitationRegionId, ExerciseLimitationRule>;
}

interface ExerciseLimitationRule {
  status: 'compatible' | 'adapt' | 'avoid' | 'not_applicable' | 'unknown';
  adaptation?: {
    kind: 'exercise_variant';
    exerciseId: string;
  };
  substituteExerciseIds?: string[];
  candidateStatus?: 'ready' | 'missing_exercise_candidate';
}
```

As 71 instâncias usam `reviewStatus=draft`. `reviewedBy` e `reviewedAt` foram
omitidos porque o contrato atual associa `approved` a revisão profissional
completa, enquanto a V3 declara somente decisão de produto generalizada e
conservadora.

Todos os 127 `adapt` possuem `adaptation.kind=exercise_variant` e ID existente.
Todos os 110 `avoid` não possuem candidato na V3; o artefato preserva
`substituteExerciseIds=[]` e marca
`candidateStatus=missing_exercise_candidate`. Um resolver futuro deve produzir
`NO_SAFE_SUBSTITUTION` nesses casos, sem inventar exercício.

## Candidatos externos aos 71

A V3 referencia 84 IDs distintos entre variantes e listas auxiliares. Desses,
28 pertencem aos 45 exercícios fora dos T001–T090 e todos existem no catálogo:

- `bent-over-dumbbell-row`
- `bent-over-row-smith-machine`
- `bulgarian-split-squat-machine`
- `cable-biceps-curl`
- `cable-glute-kickback`
- `cable-lateral-raise`
- `cable-skull-crusher`
- `face-pull`
- `hack-squat-machine-variation`
- `incline-dumbbell-curl`
- `iso-lateral-pulldown-machine`
- `lat-pulldown`
- `lat-pulldown-supinated-grip`
- `lateral-band-walk`
- `leg-press-90`
- `low-cable-row-close-supinated-grip`
- `lying-leg-raise`
- `machine-lateral-raise`
- `preacher-curl`
- `reverse-hack-squat`
- `seated-calf-raise-machine`
- `standing-single-leg-curl-machine`
- `stiff-leg-deadlift-hack-machine`
- `stiff-leg-deadlift-machine`
- `stiff-leg-deadlift-smith-machine`
- `sumo-deadlift-dumbbell`
- `sumo-deadlift-smith-machine`
- `sumo-squat-machine`

Cinco desses 28 são variantes efetivamente persistidas por `adapt`:
`cable-biceps-curl`, `cable-glute-kickback`,
`iso-lateral-pulldown-machine`, `lying-leg-raise` e
`machine-lateral-raise`. Os outros 23 aparecem somente nas listas auxiliares
de candidatos da V3, que não fazem parte do menor schema de `adapt`.

A auditoria live confirmou que nenhum dos 28 possui `limitationProfile`
estruturalmente suficiente. Nenhum recebeu classificação inventada nesta fase.

## Ciclos detectados

Foram encontrados cinco ciclos bidirecionais globais de variante:

1. `triceps-rope-pushdown` ↔ `cable-triceps-pushdown`
2. `hip-hinge-drill` ↔ `dumbbell-stiff-leg-deadlift`
3. `resistance-band-row` ↔ `iso-lateral-row-machine`
4. `seated-resistance-band-shoulder-press` ↔ `machine-shoulder-press`
5. `supported-hip-abduction` ↔ `seated-hip-abductor-machine`

Eles aparecem em nove combinações regionais (`hip`: 2, `back`: 1,
`shoulder`: 1, `elbow`: 3, `wrist`: 2). O contrato V1 documentado não deve
encadear substituições, mas os ciclos ainda precisam de decisão antes de uma
evolução recursiva e devem ser rejeitados por validação futura quando aplicável.

## Auditoria Firestore read-only e dry-run

Projeto auditado: `ajfit-2f321`; collection: `exercises`.

| Item | Resultado |
|---|---:|
| documentos existentes | 116 |
| documentos com `limitationProfile` | 0 |
| exercícios-base encontrados | 71/71 |
| documentos fora do alvo | 45 |
| outros campos planejados para alteração | 0 |
| deletes planejados | 0 |

A ferramenta classifica campo ausente como `CREATE_PROFILE`, ainda que o write
futuro seja tecnicamente um `update` pontual no documento existente:

| Ação | Quantidade |
|---|---:|
| `CREATE_PROFILE` | 71 |
| `UPDATE_PROFILE` | 0 |
| `UNCHANGED` | 0 |
| `BLOCKED` | 0 |
| `ERROR` | 0 |

O comando foi executado sem `--confirm`. O script é dry-run por padrão,
idempotente, não contém delete e, em uma fase autorizada, usa somente
`batch.update(ref, { limitationProfile })`, sem sobrescrever o documento.

## Firestore Rules — impacto futuro

Nenhuma Rule foi alterada ou publicada. Hoje `exerciseWriteValid` valida
identidade, status, difficulty, nomes e `metadata.updatedAt`, mas não valida
`limitationProfile` nem fecha as chaves top-level do exercício.

Antes de permitir edição pelo portal cliente, a próxima fase deve adicionar:

- validação fechada de `schemaVersion`, `protocolVersion` e `reviewStatus`;
- exatamente sete regiões e somente IDs regionais canônicos;
- enum dos cinco status;
- `adapt` somente com variante existente/concreta;
- `avoid` com IDs únicos e `candidateStatus` coerente;
- proibição de campos condicionais nos outros status;
- política explícita para `reviewedAt`/`reviewedBy` e promoção a `approved`.

O Admin SDK ignora Rules; portanto o script também precisa manter sua validação
local integral, mesmo depois de uma futura alteração nas Rules.

## Validações e testes

- 71 profiles, sete regiões cada e 497 pares;
- zero `unknown` e zero status/região fora do enum;
- 116 IDs de catálogo e 71 IDs-base confirmados local e live;
- todas as variantes e referências candidatas existem;
- zero autorreferências, IDs duplicados ou IDs inválidos;
- 110 gaps `avoid` preservados sem exercício inventado;
- 90 templates, 2.108 referências e 71 exercícios usados revalidados;
- T001–T090 e seed do catálogo não foram alterados;
- teste direcionado do conversor/validador/ciclos aprovado;
- typecheck aprovado;
- `git diff --check` executado separadamente no fechamento.

## Veredito

`BLOCKED` para a Fase 4 pelos seguintes motivos concretos:

1. os cinco candidatos externos efetivamente usados como variantes — e os 28
   candidatos externos auditados — não possuem profile suficiente;
2. `reviewStatus=approved` continua reservado a aprovação profissional, mas a
   V3 é decisão de produto; a política de persistir/consumir `draft` precisa ser
   decidida explicitamente;
3. os cinco ciclos precisam de aceitação formal ou quebra antes de qualquer
   resolução encadeada;
4. 110 regras `avoid` resultarão em `NO_SAFE_SUBSTITUTION`, comportamento que
   precisa ser aceito como decisão de produto antes do write real.
