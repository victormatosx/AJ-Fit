# Fase 1 — resumo do dataset proposto

Estado: `PROPOSED_PENDING_HUMAN_REVIEW`. Este material **não é aprovação clínica**, não está pronto para Firestore e não autoriza runtime. A classificação usa os contratos existentes, a triagem estrutural e metadados do catálogo. Como a entrada informa apenas uma região, sem diagnóstico, gravidade ou sintomas, as decisões de baixa confiança e os candidatos devem ser revisados por profissional habilitado.

Referências externas de enquadramento: o [CDC recomenda orientação individualizada](https://www.cdc.gov/physical-activity-basics/guidelines/chronic-health-conditions-and-disabilities.html) para condições crônicas/deficiências e descreve caminhada e ciclismo como atividades de baixo estresse articular, sem torná-las universais para toda limitação; a [OMS registra mais de 150 condições musculoesqueléticas](https://www.who.int/news-room/fact-sheets/detail/musculoskeletal-conditions), razão pela qual região isolada não equivale a diagnóstico.

## Cobertura validada

- Exercícios: **71**
- Regiões: **7**
- Pares exercício × região: **497**
- Catálogo usado para validar IDs: **116 exercícios**

## Distribuição por status

| Status | Quantidade |
|---|---:|
| `compatible` | 22 |
| `avoid` | 127 |
| `adapt` | 26 |
| `not_applicable` | 197 |
| `unknown` | 125 |
| **Total** | **497** |

## Distribuição por confidence

| Confidence | Quantidade |
|---|---:|
| `high` | 197 |
| `medium` | 154 |
| `low` | 146 |
| **Total** | **497** |

## Todos os unknown (125)

- `bar-lat-pulldown`: `back`
- `barbell-back-squat`: `back`
- `bench-step-up`: `back`
- `bird-dog`: `knee`, `hip`
- `bodyweight-squat`: `back`
- `bulgarian-split-squat`: `back`
- `bulgarian-split-squat-dumbbell`: `back`
- `cable-rear-delt-fly`: `back`
- `cable-triceps-pushdown`: `back`, `shoulder`
- `chair-sit-to-stand`: `back`
- `chair-squat`: `back`
- `controlled-marching`: `back`
- `conventional-deadlift`: `knee`, `shoulder`, `ankle_foot`
- `coordinated-breathing`: `hip`, `back`
- `dead-bug`: `knee`, `hip`, `shoulder`, `elbow`
- `dumbbell-lateral-raise`: `back`, `elbow`
- `dumbbell-overhead-triceps-extension`: `back`
- `dumbbell-shoulder-press`: `back`
- `dumbbell-stiff-leg-deadlift`: `knee`, `shoulder`, `ankle_foot`
- `ez-bar-biceps-curl`: `back`, `shoulder`
- `farmers-walk`: `knee`, `hip`, `elbow`, `ankle_foot`
- `floor-crunch`: `hip`
- `gentle-direction-changes`: `back`
- `glute-bridge`: `knee`, `back`, `ankle_foot`
- `goblet-squat`: `back`, `wrist`
- `hack-squat-machine`: `back`
- `hammer-curl`: `back`, `shoulder`
- `hip-hinge-drill`: `knee`, `ankle_foot`
- `hip-mobility`: `knee`, `hip`, `back`, `shoulder`, `ankle_foot`
- `hip-thrust`: `knee`, `back`, `ankle_foot`
- `incline-dumbbell-bench-press`: `back`
- `iso-lateral-incline-chest-press-machine`: `back`
- `iso-lateral-row-machine`: `back`
- `leg-extension-machine`: `hip`, `back`, `ankle_foot`
- `leg-press-45`: `back`
- `low-cable-row-wide-neutral-grip`: `back`
- `low-step-up`: `back`
- `lying-leg-curl-machine`: `hip`, `back`, `ankle_foot`
- `machine-flat-bench-press`: `back`
- `machine-shoulder-press`: `back`
- `march-in-place`: `back`
- `mini-band-hip-abduction`: `knee`, `back`, `ankle_foot`
- `pallof-press`: `hip`, `shoulder`, `elbow`
- `plank`: `knee`, `hip`
- `push-up`: `back`
- `resistance-band-lat-pulldown`: `knee`, `back`
- `resistance-band-row`: `back`
- `resistance-band-shoulder-press`: `back`
- `seated-dumbbell-curl`: `back`, `shoulder`
- `seated-hip-abductor-machine`: `knee`, `back`, `ankle_foot`
- `seated-leg-curl-machine`: `hip`, `back`, `ankle_foot`
- `seated-resistance-band-shoulder-press`: `back`
- `slider-leg-curl`: `hip`, `back`, `ankle_foot`
- `standing-calf-raise-machine`: `knee`, `hip`, `back`
- `stationary-bike`: `back`
- `stationary-lunge`: `back`
- `supported-balance`: `back`
- `supported-calf-raise`: `knee`, `hip`, `back`
- `supported-hip-abduction`: `knee`, `back`, `ankle_foot`
- `supported-low-step-up`: `back`
- `supported-semi-tandem-stance`: `back`
- `supported-standing-leg-curl`: `hip`, `back`
- `thoracic-mobility`: `knee`, `back`, `shoulder`, `ankle_foot`
- `triceps-rope-pushdown`: `back`, `shoulder`
- `unilateral-iso-lateral-row-machine`: `back`
- `v-bar-pulldown`: `back`
- `walking`: `back`
- `walking-lunges`: `back`
- `wall-push-up`: `back`, `ankle_foot`
- `weight-shift`: `back`

## Todos os adapt (26)

| Exercício | Região | Variante concreta | Justificativa |
|---|---|---|---|
| `barbell-back-squat` | `wrist` | `chair-squat` | Variante catalogada remove a barra e usa a cadeira como referência concreta. |
| `bench-step-up` | `knee` | `supported-low-step-up` | Variante catalogada combina degrau baixo e apoio. |
| `bench-step-up` | `hip` | `supported-low-step-up` | Variante catalogada combina degrau baixo e apoio. |
| `bench-step-up` | `ankle_foot` | `supported-low-step-up` | Variante catalogada combina degrau baixo e apoio. |
| `bird-dog` | `shoulder` | `dead-bug` | Variante em decúbito mantém o trabalho anti-extensão sem apoio nos ombros. |
| `bird-dog` | `elbow` | `dead-bug` | Variante em decúbito mantém o trabalho anti-extensão sem apoio nos cotovelos. |
| `bird-dog` | `wrist` | `dead-bug` | Variante em decúbito mantém o trabalho anti-extensão sem apoio nos punhos. |
| `bulgarian-split-squat-dumbbell` | `wrist` | `bulgarian-split-squat` | Variante catalogada preserva o movimento sem halteres. |
| `cable-triceps-pushdown` | `wrist` | `triceps-rope-pushdown` | Variante catalogada troca o implemento por corda. |
| `conventional-deadlift` | `wrist` | `hip-hinge-drill` | Variante sem implemento manual mantém o padrão de dobradiça. |
| `dumbbell-lateral-raise` | `wrist` | `machine-lateral-raise` | Variante catalogada em máquina elimina a sustentação de halteres. |
| `dumbbell-overhead-triceps-extension` | `shoulder` | `cable-triceps-pushdown` | Variante catalogada de extensão do cotovelo evita a posição acima da cabeça. |
| `dumbbell-shoulder-press` | `wrist` | `machine-shoulder-press` | Variante catalogada em máquina substitui os halteres por trajetória guiada. |
| `dumbbell-stiff-leg-deadlift` | `wrist` | `hip-hinge-drill` | Variante sem implemento manual mantém o padrão de dobradiça. |
| `ez-bar-biceps-curl` | `wrist` | `hammer-curl` | Variante catalogada troca a barra W por pegada neutra com halteres. |
| `incline-dumbbell-bench-press` | `wrist` | `machine-flat-bench-press` | Variante catalogada em máquina elimina a sustentação de halteres. |
| `low-step-up` | `knee` | `supported-low-step-up` | Variante catalogada acrescenta apoio mantendo o degrau baixo. |
| `low-step-up` | `hip` | `supported-low-step-up` | Variante catalogada acrescenta apoio mantendo o degrau baixo. |
| `low-step-up` | `ankle_foot` | `supported-low-step-up` | Variante catalogada acrescenta apoio mantendo o degrau baixo. |
| `plank` | `shoulder` | `dead-bug` | Variante em decúbito mantém o trabalho anti-extensão sem apoio nos ombros. |
| `plank` | `elbow` | `dead-bug` | Variante em decúbito mantém o trabalho anti-extensão sem apoio nos cotovelos. |
| `plank` | `wrist` | `dead-bug` | Variante em decúbito mantém o trabalho anti-extensão sem apoio nos punhos. |
| `push-up` | `shoulder` | `wall-push-up` | Variante catalogada na parede preserva o empurrar horizontal com apoio elevado. |
| `push-up` | `elbow` | `wall-push-up` | Variante catalogada na parede preserva o empurrar horizontal com apoio elevado. |
| `push-up` | `wrist` | `wall-push-up` | Variante catalogada na parede preserva o empurrar horizontal com apoio elevado. |
| `triceps-rope-pushdown` | `wrist` | `cable-triceps-pushdown` | Variante catalogada troca a corda por outra execução de pushdown. |

## Avoid sem substituto (6)

- `farmers-walk`: `back`, `shoulder`, `wrist`
- `leg-extension-machine`: `knee`
- `pallof-press`: `back`, `wrist`

## Decisões low confidence (146)

- `bar-lat-pulldown`: `back`
- `barbell-back-squat`: `back`
- `bench-step-up`: `back`
- `bird-dog`: `knee`, `hip`
- `bodyweight-squat`: `back`
- `bulgarian-split-squat`: `back`
- `bulgarian-split-squat-dumbbell`: `back`
- `cable-rear-delt-fly`: `back`
- `cable-triceps-pushdown`: `back`, `shoulder`
- `chair-sit-to-stand`: `back`
- `chair-squat`: `back`
- `controlled-marching`: `knee`, `hip`, `back`, `ankle_foot`
- `conventional-deadlift`: `knee`, `shoulder`, `ankle_foot`
- `coordinated-breathing`: `hip`, `back`
- `dead-bug`: `knee`, `hip`, `shoulder`, `elbow`
- `dumbbell-lateral-raise`: `back`, `elbow`
- `dumbbell-overhead-triceps-extension`: `back`
- `dumbbell-shoulder-press`: `back`
- `dumbbell-stiff-leg-deadlift`: `knee`, `shoulder`, `ankle_foot`
- `ez-bar-biceps-curl`: `back`, `shoulder`
- `farmers-walk`: `knee`, `hip`, `elbow`, `ankle_foot`
- `floor-crunch`: `hip`
- `gentle-direction-changes`: `back`
- `glute-bridge`: `knee`, `back`, `ankle_foot`
- `goblet-squat`: `back`, `wrist`
- `hack-squat-machine`: `back`
- `hammer-curl`: `back`, `shoulder`
- `hip-hinge-drill`: `knee`, `ankle_foot`
- `hip-mobility`: `knee`, `hip`, `back`, `shoulder`, `ankle_foot`
- `hip-thrust`: `knee`, `back`, `ankle_foot`
- `incline-dumbbell-bench-press`: `back`
- `iso-lateral-incline-chest-press-machine`: `back`
- `iso-lateral-row-machine`: `back`
- `leg-extension-machine`: `hip`, `back`, `ankle_foot`
- `leg-press-45`: `back`
- `low-cable-row-wide-neutral-grip`: `back`
- `low-step-up`: `back`
- `lying-leg-curl-machine`: `hip`, `back`, `ankle_foot`
- `machine-flat-bench-press`: `back`
- `machine-shoulder-press`: `back`
- `march-in-place`: `knee`, `hip`, `back`, `ankle_foot`
- `mini-band-hip-abduction`: `knee`, `back`, `ankle_foot`
- `pallof-press`: `hip`, `shoulder`, `elbow`
- `plank`: `knee`, `hip`
- `push-up`: `back`
- `resistance-band-lat-pulldown`: `knee`, `back`
- `resistance-band-row`: `back`
- `resistance-band-shoulder-press`: `back`
- `seated-dumbbell-curl`: `back`, `shoulder`
- `seated-hip-abductor-machine`: `knee`, `back`, `ankle_foot`
- `seated-leg-curl-machine`: `hip`, `back`, `ankle_foot`
- `seated-resistance-band-shoulder-press`: `back`
- `slider-leg-curl`: `hip`, `back`, `ankle_foot`
- `standing-calf-raise-machine`: `knee`, `hip`, `back`
- `stationary-bike`: `knee`, `hip`, `back`, `ankle_foot`
- `stationary-lunge`: `back`
- `supported-balance`: `knee`, `hip`, `back`, `ankle_foot`
- `supported-calf-raise`: `knee`, `hip`, `back`
- `supported-hip-abduction`: `knee`, `back`, `ankle_foot`
- `supported-low-step-up`: `back`
- `supported-semi-tandem-stance`: `knee`, `hip`, `back`, `ankle_foot`
- `supported-standing-leg-curl`: `hip`, `back`
- `thoracic-mobility`: `knee`, `back`, `shoulder`, `ankle_foot`
- `triceps-rope-pushdown`: `back`, `shoulder`
- `unilateral-iso-lateral-row-machine`: `back`
- `v-bar-pulldown`: `back`
- `walking`: `knee`, `hip`, `back`, `ankle_foot`
- `walking-lunges`: `back`
- `wall-push-up`: `back`, `ankle_foot`
- `weight-shift`: `knee`, `hip`, `back`, `ankle_foot`

## Revisão prioritária

Prioridade máxima: todos os `unknown`, todos os `adapt`, todos os `avoid` sem candidato e todas as decisões `compatible` de baixa confiança. Também exigem perfil integral antes de uso os candidatos/variantes fora dos 71 atuais:

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

Nenhum substituto desta proposta é automaticamente seguro para outra região. A ordem apenas preserva propósito/padrão e privilegia variantes simples do catálogo; o resolver futuro deverá revalidar todas as limitações, equipamento, ambiente, status e availability.

## Validações do artefato

- [x] exatamente 71 exercícios
- [x] exatamente 497 pares
- [x] todos os exerciseIds existem entre os 116
- [x] todos os substituteExerciseIds existem entre os 116
- [x] nenhum `adapt` sem `adaptation.kind=exercise_variant` e variante existente
- [x] nenhum `avoid` referencia exercício inventado
- [x] dataset marcado como proposta pendente, sem aprovação profissional
- [x] nenhuma escrita no Firestore; nenhum runtime ou Rule alterado
