# Matriz de relevância musculoesquelética — T001–T090

Status: `STRUCTURAL_TRIAGE_COMPLETE`; nenhuma célula é aprovação clínica.

## Escopo e método

Fonte: JSON canônico v1.3.0, `EXERCISES_SEED` e auditoria read-only da collection
real. Foram confirmados 90 templates, 378 sessões, 2.108 slots, 71 exercícios
usados e zero IDs ausentes no catálogo de 116 documentos. Seed e Firestore
estão alinhados; nenhum documento contém limitation metadata hoje. Cada um dos
497 pares usados×região recebeu uma triagem:

- `M` (`MATERIAL`): a metadata de padrão, alvo, apoio ou posição indica que a
  região deve participar da decisão;
- `N` (`NOT_MATERIAL`): a região não é constraint específica material no
  resolver V1 segundo a metadata disponível;
- `U` (`UNCERTAIN`): a metadata não permite excluir relevância com confiança.

`N` é proposta para futura aprovação como `not_applicable`, não significa
`compatible`. `M` e `U` entram na revisão profissional. A triagem foi deliberadamente
conservadora: padrões diretamente articulares são `M`; regiões adjacentes,
postura, apoio ou metadata insuficiente são `U`; regiões estruturalmente
distantes são `N`. Nenhuma inferência de diagnóstico foi feita.

## Totais

| Região | MATERIAL | NOT_MATERIAL | UNCERTAIN | Revisar M+U |
|---|---:|---:|---:|---:|
| `knee` | 27 | 27 | 17 | 44 |
| `hip` | 31 | 26 | 14 | 45 |
| `back` | 11 | 0 | 60 | 71 |
| `shoulder` | 23 | 37 | 11 | 34 |
| `elbow` | 26 | 41 | 4 | 30 |
| `wrist` | 33 | 36 | 2 | 35 |
| `ankle_foot` | 25 | 30 | 16 | 41 |
| **Total** | **176** | **197** | **124** | **300** |

## Matriz dos 71 exercícios usados

`Ref` = slots; `Ses` = sessões distintas; `Tpl` = templates distintos.

| Exercise | Nome | Ref | Ses | Tpl | Knee | Hip | Back | Shoulder | Elbow | Wrist | Ankle/foot | M | U |
|---|---|---:|---:|---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|---:|---:|
| `dumbbell-stiff-leg-deadlift` | Stiff com Halteres | 136 | 136 | 80 | U | M | M | U | N | M | U | 3 | 3 |
| `walking` | Caminhada | 116 | 92 | 46 | M | M | U | N | N | N | M | 3 | 1 |
| `hip-thrust` | Elevação Pélvica | 81 | 81 | 48 | U | M | U | N | N | N | U | 1 | 3 |
| `plank` | Prancha | 80 | 80 | 60 | U | U | M | M | M | M | N | 4 | 2 |
| `resistance-band-lat-pulldown` | Puxada com Elástico | 70 | 70 | 42 | U | N | U | M | M | M | N | 3 | 2 |
| `bar-lat-pulldown` | Puxada Barra | 68 | 68 | 42 | N | N | U | M | M | M | N | 3 | 1 |
| `machine-flat-bench-press` | Supino Reto Máquina | 66 | 66 | 49 | N | N | U | M | M | M | N | 3 | 1 |
| `seated-hip-abductor-machine` | Cadeira Abdutora | 65 | 65 | 30 | U | M | U | N | N | N | U | 1 | 3 |
| `iso-lateral-row-machine` | Remada Articulada | 64 | 64 | 37 | N | N | U | M | M | M | N | 3 | 1 |
| `goblet-squat` | Agachamento Goblet | 62 | 62 | 48 | M | M | U | N | N | U | M | 3 | 2 |
| `one-arm-dumbbell-row` | Remada Serrote Unilateral | 62 | 62 | 36 | N | N | M | M | M | M | N | 4 | 0 |
| `dumbbell-lateral-raise` | Elevação Lateral Halteres | 60 | 60 | 40 | N | N | U | M | U | M | N | 2 | 2 |
| `dumbbell-shoulder-press` | Desenvolvimento com Halteres | 60 | 60 | 47 | N | N | U | M | M | M | N | 3 | 1 |
| `stationary-bike` | Bicicleta Ergométrica | 56 | 56 | 24 | M | M | U | N | N | N | M | 3 | 1 |
| `push-up` | Flexão de Braço | 52 | 52 | 24 | N | N | U | M | M | M | N | 3 | 1 |
| `leg-press-45` | Leg Press 45 | 50 | 50 | 40 | M | M | U | N | N | N | M | 3 | 1 |
| `ez-bar-biceps-curl` | Rosca Direta Barra W | 46 | 46 | 32 | N | N | U | U | M | M | N | 2 | 2 |
| `iso-lateral-incline-chest-press-machine` | Supino Inclinado Articulado | 44 | 44 | 30 | N | N | U | M | M | M | N | 3 | 1 |
| `machine-shoulder-press` | Desenvolvimento Máquina | 44 | 44 | 35 | N | N | U | M | M | M | N | 3 | 1 |
| `standing-calf-raise-machine` | Panturrilha em Pé | 44 | 44 | 36 | U | U | U | N | N | N | M | 1 | 3 |
| `triceps-rope-pushdown` | Tríceps Corda | 40 | 40 | 32 | N | N | U | U | M | M | N | 2 | 2 |
| `barbell-back-squat` | Agachamento Livre | 39 | 39 | 33 | M | M | U | N | N | M | M | 4 | 1 |
| `bulgarian-split-squat-dumbbell` | Agachamento Búlgaro com Halter | 39 | 39 | 24 | M | M | U | N | N | U | M | 3 | 2 |
| `low-cable-row-wide-neutral-grip` | Remada Baixa Aberta Pegada Neutra | 38 | 38 | 32 | N | N | U | M | M | M | N | 3 | 1 |
| `bench-step-up` | Subida no Banco | 37 | 37 | 29 | M | M | U | N | N | N | M | 3 | 1 |
| `dead-bug` | Dead Bug | 34 | 34 | 30 | U | U | M | U | U | M | N | 2 | 4 |
| `resistance-band-row` | Remada com Elástico | 34 | 34 | 25 | N | N | U | M | M | M | N | 3 | 1 |
| `seated-leg-curl-machine` | Cadeira Flexora | 29 | 29 | 29 | M | U | U | N | N | N | U | 1 | 3 |
| `glute-bridge` | Ponte de Glúteos | 27 | 27 | 16 | U | M | U | N | N | N | U | 1 | 3 |
| `march-in-place` | Marcha Estacionária | 27 | 27 | 27 | M | M | U | N | N | N | M | 3 | 1 |
| `hip-mobility` | Mobilidade de Quadril | 26 | 26 | 22 | U | M | U | U | N | N | U | 1 | 4 |
| `incline-dumbbell-bench-press` | Supino Inclinado com Halteres | 26 | 20 | 12 | N | N | U | M | M | M | N | 3 | 1 |
| `cable-rear-delt-fly` | Posterior de Ombro na Polia | 24 | 24 | 20 | N | N | U | M | M | M | N | 3 | 1 |
| `pallof-press` | Pallof Press | 24 | 24 | 16 | N | U | M | U | U | M | N | 2 | 3 |
| `unilateral-iso-lateral-row-machine` | Remada Articulada Unilateral | 24 | 24 | 20 | N | N | U | M | M | M | N | 3 | 1 |
| `farmers-walk` | Caminhada do Fazendeiro | 23 | 23 | 23 | U | U | M | M | U | M | U | 3 | 4 |
| `dumbbell-overhead-triceps-extension` | Tríceps Francês Halteres | 22 | 22 | 14 | N | N | U | M | M | M | N | 3 | 1 |
| `seated-dumbbell-curl` | Rosca Sentada com Halteres | 22 | 22 | 14 | N | N | U | U | M | M | N | 2 | 2 |
| `bird-dog` | Bird Dog | 18 | 18 | 12 | U | U | M | M | M | M | N | 4 | 2 |
| `chair-sit-to-stand` | Sentar e Levantar da Cadeira | 17 | 17 | 9 | M | M | U | N | N | N | M | 3 | 1 |
| `mini-band-hip-abduction` | Abdução de Quadril com Mini Band | 17 | 17 | 6 | U | M | U | N | N | N | U | 1 | 3 |
| `conventional-deadlift` | Levantamento Terra | 16 | 16 | 12 | U | M | M | U | N | M | U | 3 | 3 |
| `walking-lunges` | Passadas | 15 | 15 | 15 | M | M | U | N | N | N | M | 3 | 1 |
| `leg-extension-machine` | Cadeira Extensora | 14 | 14 | 10 | M | U | U | N | N | N | U | 1 | 3 |
| `lying-leg-curl-machine` | Mesa Flexora | 14 | 14 | 14 | M | U | U | N | N | N | U | 1 | 3 |
| `hack-squat-machine` | Agachamento Hack | 12 | 12 | 12 | M | M | U | N | N | N | M | 3 | 1 |
| `supported-low-step-up` | Subida em Degrau Baixo com Apoio | 12 | 12 | 12 | M | M | U | N | N | N | M | 3 | 1 |
| `cable-triceps-pushdown` | Tríceps Polia | 10 | 10 | 10 | N | N | U | U | M | M | N | 2 | 2 |
| `supported-calf-raise` | Panturrilha com Apoio | 9 | 9 | 6 | U | U | U | N | N | N | M | 1 | 3 |
| `floor-crunch` | Abdômen Supra Chão | 8 | 8 | 8 | N | U | M | N | N | N | N | 1 | 1 |
| `hammer-curl` | Rosca Martelo | 8 | 8 | 8 | N | N | U | U | M | M | N | 2 | 2 |
| `bodyweight-squat` | Agachamento | 6 | 6 | 6 | M | M | U | N | N | N | M | 3 | 1 |
| `bulgarian-split-squat` | Agachamento Búlgaro | 6 | 6 | 6 | M | M | U | N | N | N | M | 3 | 1 |
| `low-step-up` | Subida em Degrau Baixo | 6 | 6 | 6 | M | M | U | N | N | N | M | 3 | 1 |
| `supported-standing-leg-curl` | Flexão de Joelho com Apoio | 6 | 6 | 6 | M | U | U | N | N | N | M | 2 | 2 |
| `wall-push-up` | Flexão na Parede | 6 | 6 | 3 | N | N | U | M | M | M | U | 3 | 2 |
| `controlled-marching` | Marcha Controlada | 4 | 4 | 4 | M | M | U | N | N | N | M | 3 | 1 |
| `coordinated-breathing` | Respiração Coordenada | 4 | 4 | 4 | N | U | U | N | N | N | N | 0 | 2 |
| `gentle-direction-changes` | Mudanças Leves de Direção | 4 | 4 | 4 | M | M | U | N | N | N | M | 3 | 1 |
| `supported-semi-tandem-stance` | Posição Semi-Tandem com Apoio | 4 | 4 | 4 | M | M | U | N | N | N | M | 3 | 1 |
| `thoracic-mobility` | Mobilidade Torácica | 4 | 4 | 4 | U | N | M | U | N | N | U | 1 | 3 |
| `v-bar-pulldown` | Puxada Triângulo | 4 | 4 | 4 | N | N | U | M | M | M | N | 3 | 1 |
| `weight-shift` | Transferência de Peso | 4 | 4 | 4 | M | M | U | N | N | N | M | 3 | 1 |
| `chair-squat` | Agachamento até a Cadeira | 3 | 3 | 3 | M | M | U | N | N | N | M | 3 | 1 |
| `resistance-band-shoulder-press` | Desenvolvimento com Elástico | 3 | 3 | 3 | N | N | U | M | M | M | N | 3 | 1 |
| `seated-resistance-band-shoulder-press` | Desenvolvimento com Elástico Sentado | 3 | 3 | 3 | N | N | U | M | M | M | N | 3 | 1 |
| `supported-hip-abduction` | Abdução de Quadril com Apoio | 3 | 3 | 3 | U | M | U | N | N | N | U | 1 | 3 |
| `hip-hinge-drill` | Dobradiça de Quadril | 2 | 2 | 2 | U | M | M | N | N | N | U | 2 | 2 |
| `slider-leg-curl` | Flexão de Joelho Deslizante | 2 | 2 | 2 | M | U | U | N | N | N | U | 1 | 3 |
| `supported-balance` | Equilíbrio com Apoio | 2 | 2 | 2 | M | M | U | N | N | N | M | 3 | 1 |
| `stationary-lunge` | Afundo | 1 | 1 | 1 | M | M | U | N | N | N | M | 3 | 1 |

## Fora do escopo atual dos templates

Os 45 IDs abaixo existem no catálogo, mas têm zero referência T001–T090. Estado:
`OUT_OF_CURRENT_TEMPLATE_SCOPE`. Eles não entram nos 497 pares acima, embora
possam ser avaliados como candidatos de substituição:

`bench-dips`, `bent-over-dumbbell-row`, `bent-over-row-smith-machine`,
`bulgarian-split-squat-machine`, `cable-biceps-curl`, `cable-crossover-fly`,
`cable-glute-kickback`, `cable-lateral-raise`, `cable-shrug`,
`cable-skull-crusher`, `face-pull`, `front-raise`,
`hack-squat-machine-variation`, `incline-dumbbell-curl`,
`iso-lateral-pulldown-machine`, `lat-pulldown`,
`lat-pulldown-supinated-grip`, `lateral-band-walk`,
`leg-press-45-unilateral`, `leg-press-90`,
`low-cable-row-close-supinated-grip`, `low-cable-row-wide-grip`,
`lying-leg-raise`, `machine-lateral-raise`, `pec-deck-machine-fly`,
`preacher-curl`, `reverse-hack-squat`, `reverse-hack-squat-unilateral`,
`roman-chair-back-extension`, `roman-chair-back-extension-arms-crossed`,
`seated-calf-raise-machine`, `seated-hip-adductor-machine`,
`seated-single-arm-dumbbell-curl`, `single-leg-dumbbell-stiff-leg-deadlift`,
`sissy-squat`, `smith-machine-squat`, `standing-single-leg-curl-machine`,
`stiff-leg-deadlift-hack-machine`, `stiff-leg-deadlift-machine`,
`stiff-leg-deadlift-smith-machine`, `sumo-deadlift-dumbbell`,
`sumo-deadlift-smith-machine`, `sumo-squat-machine`, `supinated-cable-row`,
`unilateral-iso-lateral-pulldown-machine`.

## Próxima aprovação

O reviewer profissional deve validar tanto `M/U` quanto a proposta `N`. Só
depois um perfil completo pode ser marcado `approved`. A fila e os lotes estão
em `04_UNRESOLVED_REVIEWS.md`.
