# Limitation Dataset Audit

Generated: 2026-08-27T16:58:37.083Z

Formal, mechanical audit of `15_LIMITATION_PROFILES_TECHNICAL_v2.json` run against the
real, unmodified `resolveExerciseLimitations()`/`validateLimitationProfile()` from
`src/workoutPrescription/limitationResolver.ts` — no resolver logic was reimplemented,
and nothing in the dataset, resolver, or prescription engine was changed by this audit.

## Resumo executivo

- **497** combinações `exerciseId × region` analisadas (71 exercícios realmente alcançáveis pelos 90 templates T001–T090 × 7 regiões).
- **0** combinações não produzem uma decisão válida (**0.0%**).
- Cobertura de profiles: **76/116** exercícios revisados; dos **40** não revisados, **0** aparecem em templates reais.
- Das falhas: **0** vêm de exercícios-fonte sem profile (revisão incompleta); **0** estão DENTRO dos exercícios já supostamente revisados (inconsistência interna, não apenas cobertura incompleta).
- **Quality gate alcançável: 497/497 válidas; dívida conhecida = 0.**

**Esta auditoria não toma decisões clínicas.** Ela verifica mecanicamente o dataset materializado.

## Categorias de falha (root cause)

| Causa raiz | Combinações | Exercícios únicos | Regiões | Templates afetados |
|---|---:|---:|---|---:|
| Nenhuma falha alcançável | 0 | 0 | — | 0 |

> Distinção importante: categorias F/G (`avoid` sem substituto utilizável) são decisões
> **independentes** — cada uma exige revisão própria. Categorias A/B/C/D (alvo de `adapt`
> quebrado) **concentram-se em poucos exercícios "super node"** — corrigir o alvo resolve
> várias falhas de uma vez (ver seção seguinte).

## Super nodes — exercícios/targets que mais propagam falhas

| Target | Região | Falhas causadas | Exercícios que dependem dele |
|---|---|---:|---|

## Impacto por região

| Região | Analisado | Válido | Inválido | % falha | Principais responsáveis |
|---|---:|---:|---:|---:|---|
| knee | 71 | 71 | 0 | 0.0% |  |
| hip | 71 | 71 | 0 | 0.0% |  |
| back | 71 | 71 | 0 | 0.0% |  |
| shoulder | 71 | 71 | 0 | 0.0% |  |
| elbow | 71 | 71 | 0 | 0.0% |  |
| wrist | 71 | 71 | 0 | 0.0% |  |
| ankle_foot | 71 | 71 | 0 | 0.0% |  |

## Impacto por família de templates (blocos de 12)

| Família | Templates | Templates com algum risco | Total de blockers |
|---|---:|---:|---:|
| T001–T012 | 12 | 0 | 0 |
| T013–T024 | 12 | 0 | 0 |
| T025–T036 | 12 | 0 | 0 |
| T037–T048 | 12 | 0 | 0 |
| T049–T060 | 12 | 0 | 0 |
| T061–T072 | 12 | 0 | 0 |
| T073–T084 | 12 | 0 | 0 |
| T085–T090 | 6 | 0 | 0 |

## Top 10 templates com mais blockers

| Template | Regiões em risco | Total de blockers |
|---|---:|---:|
| T001 | 0/7 | 0 |
| T002 | 0/7 | 0 |
| T003 | 0/7 | 0 |
| T004 | 0/7 | 0 |
| T005 | 0/7 | 0 |
| T006 | 0/7 | 0 |
| T007 | 0/7 | 0 |
| T008 | 0/7 | 0 |
| T009 | 0/7 | 0 |
| T010 | 0/7 | 0 |

## Matriz de revisão clínica — Top 20 decisões prioritárias

Cada linha é uma decisão de conteúdo/clínica pendente. As opções listadas são
**categorias de decisão**, não uma escolha feita por esta auditoria.

Nenhuma decisão pendente no escopo alcançável T001–T090 × 7 regiões.

## Cobertura dos 116 exercícios

- 76 exercícios têm `limitationProfile`; 40 não têm.
- Dos 40 não revisados, 0 são efetivamente usados por algum template — esses geram `MISSING_PROFILE` sempre que um usuário com QUALQUER limitação os alcança.
- **0 das 0 falhas ocorrem dentro do conjunto já "revisado"** — ou seja, o problema não é só terminar a revisão dos 40 que faltam; há inconsistência dentro do que já foi considerado pronto.

## Proposta de Quality Gate futuro

O baseline alcançável é **zero**. O gate deve falhar para qualquer nova chave inválida,
target ausente/não terminal, autorreferência ou profile ausente em exercício alcançável.

Proposta de **baseline decrescente** (estratégia adequada para este caso):

1. Persistir o número atual de combinações inválidas como baseline versionado
   (ex.: `docs/workout-modifiers/limitation-dataset-audit-baseline.json`, contendo
   `{ "knownInvalidCount": 0 }` e, idealmente, a lista completa das
   chaves `exerciseId:region` já conhecidas como inválidas).
2. Um teste/script de CI roda a mesma auditoria e compara contra o baseline:
   - **nova combinação inválida que NÃO estava no baseline** → falha (regressão real);
   - **contagem total menor ou igual, e nenhuma chave nova** → passa;
   - **contagem menor** (alguém corrigiu um profile) → passa E deveria abaixar o baseline
     no mesmo PR (evita a dívida voltar a subir silenciosamente).
3. Comparar por CHAVE (`exerciseId:region`), não só por contagem total — evita que uma
   correção e uma regressão não relacionadas se cancelem numericamente sem serem notadas.
4. Regras adicionais de guarda estrutural (sempre ativas, sem baseline, pois nunca devem
   ocorrer mesmo hoje):
   - todo `adaptation.exerciseId` referenciado deve existir no catálogo (categoria C/MISSING_ADAPT_TARGET —
     hoje zero casos, então isso pode já ser um gate rígido sem quebrar nada);
   - todo `substituteExerciseIds`/`adaptation.exerciseId` não pode autorreferenciar o próprio exercício
     (já garantido estruturalmente por `ruleValid` no resolver — apenas confirmar via teste dedicado);
   - todo exercício usado em algum template T001–T090 e alcançável quando o usuário declara
     `musculoskeletal_limitation` deve ter `limitationProfile` OU estar numa lista explícita de
     exceções conhecidas (torna a lista dos "40 não revisados" visível e rastreável em vez de silenciosa).
