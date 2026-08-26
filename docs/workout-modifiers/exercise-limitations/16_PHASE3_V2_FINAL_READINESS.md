# Fase 3 V2 — readiness final

Data: 2026-08-26.

Resultado histórico desta etapa: `READY_FOR_FIRESTORE_WRITE`.

Follow-up: a Fase 4 foi concluída em 2026-08-26. Os 76 profiles foram
persistidos e validados por read-back; veja
`18_PHASE4_FIRESTORE_WRITE_REPORT.md`. As seções de dry-run abaixo registram o
estado anterior à escrita.

## Dataset técnico final

Fonte persistível: `15_LIMITATION_PROFILES_TECHNICAL_v2.json`.

| Métrica | Resultado |
|---|---:|
| profiles originais | 71 |
| profiles externos adicionados | 5 |
| profiles totais | 76 |
| regiões por profile | 7 |
| pares | 532 |
| `unknown` | 0 |
| IDs inválidos | 0 |
| autorreferências | 0 |
| IDs duplicados | 0 |
| enums inválidos | 0 |

Distribuição final:

| Status | Quantidade |
|---|---:|
| `not_applicable` | 214 |
| `compatible` | 66 |
| `adapt` | 138 |
| `avoid` | 114 |
| `unknown` | 0 |
| **Total** | **532** |

Os cinco profiles adicionados são:

- `cable-biceps-curl`
- `cable-glute-kickback`
- `iso-lateral-pulldown-machine`
- `lying-leg-raise`
- `machine-lateral-raise`

As decisões foram derivadas das famílias equivalentes já aprovadas pela V3 e
usam somente IDs existentes. Todos os 31 IDs efetivamente referenciados por
`adaptation.exerciseId`/`substituteExerciseIds` agora estão dentro dos 76
profiles. O fechamento executável mínimo tem zero candidato externo restante.

As 23 referências externas restantes nas listas auxiliares históricas da V3
não são persistidas pelo menor schema de `adapt` e não participam da execução;
por isso não expandem o fechamento V2.

## Governança resolvida

Cada profile usa:

```json
{
  "schemaVersion": 1,
  "protocolVersion": "musculoskeletal-v1",
  "reviewStatus": "approved",
  "reviewBasis": "product_policy"
}
```

`approved + product_policy` significa regra aprovada para comportamento
conservador do produto. Não significa avaliação individual, contraindicação
médica ou liberação clínica universal. Não há `reviewedBy` profissional
fictício nem `reviewedAt`.

O contrato também reserva `reviewBasis=professional_review` para uma futura
aprovação profissional real, que exigirá reviewer e timestamp verdadeiros.

## Avoid sem substitute

Os 110 gaps originais e quatro dos profiles externos totalizam 114 regras
`avoid` com:

```json
{
  "status": "avoid",
  "substituteExerciseIds": [],
  "candidateStatus": "missing_exercise_candidate"
}
```

Esse estado é formalmente válido na V1. Se nenhum candidato da lista original
for válido, o resultado futuro será `NO_SAFE_SUBSTITUTION`; o vazio não bloqueia
persistência.

## Não recursão e ciclos

A V1 não encadeia variantes/substitutos. Quando um candidato B de A falhar,
seus próprios candidatos não são consultados: tenta-se o próximo candidato da
lista original de A. `visitedExerciseIds` permanece proteção obrigatória para
qualquer evolução futura.

Foram detectados 11 ciclos globais, todos não bloqueantes sob essa regra:

1. `hammer-curl` → `cable-biceps-curl` → `hammer-curl`
2. `seated-dumbbell-curl` → `hammer-curl` → `cable-biceps-curl` → `seated-dumbbell-curl`
3. `glute-bridge` → `cable-glute-kickback` → `glute-bridge`
4. `triceps-rope-pushdown` → `cable-triceps-pushdown` → `triceps-rope-pushdown`
5. `machine-lateral-raise` → `dumbbell-lateral-raise` → `machine-lateral-raise`
6. `hip-hinge-drill` → `dumbbell-stiff-leg-deadlift` → `hip-hinge-drill`
7. `lying-leg-raise` → `floor-crunch` → `lying-leg-raise`
8. `resistance-band-lat-pulldown` → `iso-lateral-pulldown-machine` → `resistance-band-lat-pulldown`
9. `resistance-band-row` → `iso-lateral-row-machine` → `resistance-band-row`
10. `seated-resistance-band-shoulder-press` → `machine-shoulder-press` → `seated-resistance-band-shoulder-press`
11. `supported-hip-abduction` → `seated-hip-abductor-machine` → `supported-hip-abduction`

## Dry-run Firestore read-only

Projeto: `ajfit-2f321`; collection: `exercises`.

| Item | Resultado |
|---|---:|
| documentos existentes | 116 |
| profiles existentes antes do write | 0 |
| documentos-alvo encontrados | 76/76 |
| documentos fora do alvo | 40 |
| outros campos planejados para alteração | 0 |
| deletes planejados | 0 |

| Ação | Quantidade |
|---|---:|
| `CREATE_PROFILE` | 76 |
| `UPDATE_PROFILE` | 0 |
| `UNCHANGED` | 0 |
| `BLOCKED` | 0 |
| `ERROR` | 0 |

`CREATE_PROFILE` significa criação do campo em documento já existente. Um write
futuro usa `batch.update(ref, { limitationProfile })`, nunca substituição do
documento. O comando foi executado sem `--confirm` e não escreveu no Firestore.

## Escopo preservado

- T001–T090 permanecem com 90 templates, 2.108 referências e 71 exercícios
  utilizados;
- o catálogo permanece com 116 exercícios;
- naquela Fase 3, Firestore Rules, UI, questionário e Limitation Resolver não
  foram alterados; as Rules foram atualizadas localmente na Fase 4;
- nenhum commit ou push foi realizado.

## Veredito

`READY_FOR_FIRESTORE_WRITE` porque o fechamento executável contém todos os
profiles necessários, há zero `unknown`, a governança foi explicitada,
`avoid` vazio é válido, ciclos são não bloqueantes na V1 não recursiva e o
dry-run terminou com zero `BLOCKED`/`ERROR`.
