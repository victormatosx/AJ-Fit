# AJ Fit — Limitation Clinical Decisions v1

> **Escopo:** decisões de política de produto baseadas em evidência para as 176 combinações atualmente inválidas do resolver. O questionário identifica apenas uma região corporal, não um diagnóstico. Estas decisões não são uma declaração de segurança clínica universal nem substituem avaliação profissional.

## Resultado

- Combinações decididas: **176**
- Unidades de decisão originais: **151**
- Mudanças auxiliares de nó terminal: **3**
- Status propostos: **{'adapt': 89, 'compatible': 60, 'not_applicable': 27}**
- Confiança: **{'moderate': 101, 'low': 67, 'high': 8}**

## Princípios usados

1. O sinal `limitation` do AJ Fit é regional e inespecífico; portanto a política evita presumir diagnóstico.
2. Onde a região não é materialmente carregada, a decisão tende a `not_applicable`.
3. Onde exercício é plausível com carga graduada, a decisão tende a `compatible`.
4. Onde existe uma variante claramente menos exigente, a decisão tende a `adapt` para variante apoiada, sentada, com menor carga externa, menor demanda de estabilização ou sem sustentação de peso.
5. O resolver V1 continua não recursivo: todo `adapt` deve terminar diretamente em `compatible` ou `not_applicable`.
6. Decisões de baixa confiança devem ser tratadas como **política conservadora de produto** e não como protocolo diagnóstico.

## Base externa usada

- Kolasinski et al. *2019 ACR/Arthritis Foundation Guideline for Management of Osteoarthritis of the Hand, Hip, and Knee*. DOI: 10.1002/acr.24131 — exercício é fortemente recomendado para OA de joelho/quadril/mão; inclui caminhada, fortalecimento, treino neuromuscular e outras formas.
- George et al. *Interventions for the Management of Acute and Chronic Low Back Pain: Revision 2021*. JOSPT. DOI: 10.2519/jospt.2021.0304 — recomenda intervenções não farmacológicas e exercício; sustenta uso de movimento/controle e exercício graduado em vez de inatividade generalizada.
- Desmeules et al. *Rotator Cuff Tendinopathy Diagnosis, Nonsurgical Medical Care, and Rehabilitation: A Clinical Practice Guideline*. JOSPT 2025. DOI: 10.2519/jospt.2025.13182 — recomenda reabilitação ativa, incluindo controle motor e/ou resistência em cargas variadas.
- *Lateral Elbow Pain and Muscle Function Impairments*. JOSPT 2022. DOI: 10.2519/jospt.2022.0302 — sustenta reabilitação ativa para tendinopatia lateral do cotovelo.
- Martin et al. *Ankle Stability and Movement Coordination Impairments: Lateral Ankle Ligament Sprains Revision 2021*. JOSPT. DOI: 10.2519/jospt.2021.0302 — sustenta exercício, equilíbrio e coordenação na reabilitação do tornozelo.
- Pellicciari et al. *Evidence for exercise therapy in patients with hand and wrist tendinopathy is limited: A systematic review*. J Hand Ther. DOI: 10.1016/j.jht.2023.08.016 — a evidência específica para punho é limitada; por isso as decisões de punho foram marcadas majoritariamente como baixa confiança e favorecem posição neutra/apoio/menor demanda de estabilização.

## Resumo por região

- **knee** — 18 casos; status {'adapt': 7, 'not_applicable': 5, 'compatible': 6}; confiança {'moderate': 13, 'high': 3, 'low': 2}.
- **hip** — 23 casos; status {'adapt': 7, 'compatible': 10, 'not_applicable': 6}; confiança {'moderate': 18, 'low': 5}.
- **back** — 53 casos; status {'adapt': 31, 'compatible': 20, 'not_applicable': 2}; confiança {'moderate': 50, 'low': 3}.
- **shoulder** — 24 casos; status {'adapt': 12, 'compatible': 7, 'not_applicable': 5}; confiança {'moderate': 10, 'low': 13, 'high': 1}.
- **elbow** — 22 casos; status {'adapt': 14, 'compatible': 7, 'not_applicable': 1}; confiança {'low': 21, 'moderate': 1}.
- **wrist** — 18 casos; status {'adapt': 12, 'compatible': 6}; confiança {'moderate': 1, 'low': 17}.
- **ankle_foot** — 18 casos; status {'adapt': 6, 'not_applicable': 8, 'compatible': 4}; confiança {'low': 6, 'moderate': 8, 'high': 4}.

## Mudanças auxiliares necessárias

- `machine-lateral-raise × shoulder` → **compatible** (low); motivo: Supporting terminal-node change needed so an affected remediation target is directly resolvable in the non-recursive V1 resolver.
- `machine-flat-bench-press × wrist` → **compatible** (low); motivo: Supporting terminal-node change needed so an affected remediation target is directly resolvable in the non-recursive V1 resolver.
- `dumbbell-stiff-leg-deadlift × wrist` → **compatible** (low); motivo: Supporting terminal-node change needed so an affected remediation target is directly resolvable in the non-recursive V1 resolver.

## Matriz completa

| # | exerciseId | região | atual | decisão | alvo | confiança | rationaleGroup |
|---:|---|---|---|---|---|---|---|
| 1 | `dumbbell-stiff-leg-deadlift` | `knee` | `avoid` | **`adapt`** | `hip-hinge-drill` | moderate | `KNEE_HINGE_DELOAD` |
| 2 | `dumbbell-stiff-leg-deadlift` | `hip` | `adapt` | **`adapt`** | `hip-hinge-drill` | moderate | `HIP_HINGE_DELOAD` |
| 3 | `dumbbell-stiff-leg-deadlift` | `back` | `adapt` | **`adapt`** | `hip-hinge-drill` | moderate | `BACK_HINGE_DELOAD` |
| 4 | `dumbbell-stiff-leg-deadlift` | `shoulder` | `avoid` | **`adapt`** | `hip-hinge-drill` | moderate | `SHOULDER_REMOVE_EXTERNAL_LOAD_HINGE` |
| 5 | `dumbbell-stiff-leg-deadlift` | `ankle_foot` | `avoid` | **`adapt`** | `hip-hinge-drill` | low | `ANKLE_HINGE_DELOAD` |
| 6 | `plank` | `knee` | `adapt` | **`adapt`** | `dead-bug` | moderate | `KNEE_AVOID_KNEELING_CORE` |
| 7 | `plank` | `hip` | `avoid` | **`compatible`** | `` | moderate | `HIP_STATIC_CORE` |
| 8 | `plank` | `shoulder` | `adapt` | **`adapt`** | `dead-bug` | moderate | `SHOULDER_REMOVE_WEIGHT_BEARING_CORE` |
| 9 | `goblet-squat` | `back` | `adapt` | **`adapt`** | `chair-sit-to-stand` | moderate | `BACK_SQUAT_DELOAD` |
| 10 | `goblet-squat` | `wrist` | `avoid` | **`adapt`** | `chair-sit-to-stand` | moderate | `WRIST_REMOVE_FRONT_LOAD` |
| 11 | `hip-thrust` | `knee` | `avoid` | **`adapt`** | `glute-bridge` | moderate | `KNEE_HIP_EXTENSION_DELOAD` |
| 12 | `hip-thrust` | `hip` | `adapt` | **`adapt`** | `glute-bridge` | moderate | `HIP_EXTENSION_DELOAD` |
| 13 | `hip-thrust` | `back` | `avoid` | **`adapt`** | `glute-bridge` | moderate | `BACK_HIP_EXTENSION_DELOAD` |
| 14 | `hip-thrust` | `ankle_foot` | `avoid` | **`adapt`** | `glute-bridge` | moderate | `ANKLE_HIP_EXTENSION_NON_WEIGHT_BEARING` |
| 15 | `dumbbell-shoulder-press` | `back` | `avoid` | **`adapt`** | `machine-shoulder-press` | moderate | `BACK_SEATED_SUPPORTED_PRESS` |
| 16 | `dumbbell-shoulder-press` | `shoulder` | `adapt` | **`adapt`** | `seated-resistance-band-shoulder-press` | low | `SHOULDER_OVERHEAD_DELOAD` |
| 17 | `dumbbell-shoulder-press` | `elbow` | `adapt` | **`adapt`** | `seated-resistance-band-shoulder-press` | low | `ELBOW_PRESS_DELOAD` |
| 18 | `dumbbell-shoulder-press` | `wrist` | `adapt` | **`adapt`** | `machine-shoulder-press` | low | `WRIST_PRESS_STABILIZATION_REDUCTION` |
| 19 | `iso-lateral-row-machine` | `elbow` | `adapt` | **`adapt`** | `resistance-band-row` | low | `ELBOW_ROW_DELOAD` |
| 20 | `iso-lateral-row-machine` | `wrist` | `adapt` | **`adapt`** | `resistance-band-row` | low | `WRIST_ROW_DELOAD` |
| 21 | `one-arm-dumbbell-row` | `elbow` | `adapt` | **`adapt`** | `resistance-band-row` | low | `ELBOW_ROW_DELOAD` |
| 22 | `one-arm-dumbbell-row` | `wrist` | `adapt` | **`adapt`** | `resistance-band-row` | low | `WRIST_ROW_DELOAD` |
| 23 | `machine-shoulder-press` | `shoulder` | `adapt` | **`adapt`** | `seated-resistance-band-shoulder-press` | low | `SHOULDER_OVERHEAD_DELOAD` |
| 24 | `machine-shoulder-press` | `elbow` | `adapt` | **`adapt`** | `seated-resistance-band-shoulder-press` | low | `ELBOW_PRESS_DELOAD` |
| 25 | `low-cable-row-wide-neutral-grip` | `elbow` | `adapt` | **`adapt`** | `resistance-band-row` | low | `ELBOW_ROW_DELOAD` |
| 26 | `low-cable-row-wide-neutral-grip` | `wrist` | `adapt` | **`adapt`** | `resistance-band-row` | low | `WRIST_ROW_DELOAD` |
| 27 | `cable-rear-delt-fly` | `elbow` | `adapt` | **`adapt`** | `resistance-band-row` | low | `ELBOW_ROW_DELOAD` |
| 28 | `cable-rear-delt-fly` | `wrist` | `adapt` | **`adapt`** | `resistance-band-row` | low | `WRIST_ROW_DELOAD` |
| 29 | `unilateral-iso-lateral-row-machine` | `elbow` | `adapt` | **`adapt`** | `resistance-band-row` | low | `ELBOW_ROW_DELOAD` |
| 30 | `unilateral-iso-lateral-row-machine` | `wrist` | `adapt` | **`adapt`** | `resistance-band-row` | low | `WRIST_ROW_DELOAD` |
| 31 | `resistance-band-shoulder-press` | `shoulder` | `adapt` | **`adapt`** | `seated-resistance-band-shoulder-press` | low | `SHOULDER_OVERHEAD_DELOAD` |
| 32 | `resistance-band-shoulder-press` | `elbow` | `adapt` | **`adapt`** | `seated-resistance-band-shoulder-press` | low | `ELBOW_PRESS_DELOAD` |
| 33 | `walking` | `back` | `avoid` | **`compatible`** | `` | moderate | `BACK_GRADED_AEROBIC_BALANCE` |
| 34 | `bar-lat-pulldown` | `shoulder` | `adapt` | **`adapt`** | `resistance-band-lat-pulldown` | low | `SHOULDER_VERTICAL_PULL_DELOAD` |
| 35 | `bar-lat-pulldown` | `elbow` | `adapt` | **`adapt`** | `resistance-band-lat-pulldown` | low | `ELBOW_PULL_DELOAD` |
| 36 | `bar-lat-pulldown` | `wrist` | `adapt` | **`adapt`** | `resistance-band-lat-pulldown` | low | `WRIST_PULL_DELOAD` |
| 37 | `resistance-band-lat-pulldown` | `knee` | `avoid` | **`not_applicable`** | `` | high | `KNEE_UPPER_BODY_PULL` |
| 38 | `resistance-band-lat-pulldown` | `back` | `avoid` | **`adapt`** | `iso-lateral-pulldown-machine` | moderate | `BACK_SUPPORTED_VERTICAL_PULL` |
| 39 | `resistance-band-lat-pulldown` | `shoulder` | `adapt` | **`compatible`** | `` | low | `SHOULDER_GRADED_BAND_PULL` |
| 40 | `resistance-band-lat-pulldown` | `elbow` | `adapt` | **`compatible`** | `` | low | `ELBOW_GRADED_BAND_PULL` |
| 41 | `resistance-band-lat-pulldown` | `wrist` | `adapt` | **`compatible`** | `` | low | `WRIST_GRADED_BAND_PULL` |
| 42 | `dumbbell-lateral-raise` | `back` | `avoid` | **`adapt`** | `machine-lateral-raise` | moderate | `BACK_SEATED_SUPPORTED_RAISE` |
| 43 | `dumbbell-lateral-raise` | `shoulder` | `adapt` | **`adapt`** | `machine-lateral-raise` | low | `SHOULDER_LATERAL_RAISE_CONTROL` |
| 44 | `dumbbell-lateral-raise` | `elbow` | `avoid` | **`not_applicable`** | `` | moderate | `ELBOW_STATIC_NON_PRIMARY` |
| 45 | `leg-press-45` | `back` | `avoid` | **`adapt`** | `chair-sit-to-stand` | moderate | `BACK_SQUAT_DELOAD` |
| 46 | `standing-calf-raise-machine` | `knee` | `avoid` | **`compatible`** | `` | moderate | `KNEE_MINIMAL_FLEXION_CALF` |
| 47 | `standing-calf-raise-machine` | `hip` | `avoid` | **`not_applicable`** | `` | moderate | `HIP_NON_HIP_DOMINANT_ISOLATION` |
| 48 | `standing-calf-raise-machine` | `back` | `avoid` | **`adapt`** | `supported-calf-raise` | moderate | `BACK_SUPPORTED_CALF` |
| 49 | `machine-shoulder-press` | `wrist` | `adapt` | **`compatible`** | `` | low | `WRIST_GRADED_SUPPORTED_PRESS` |
| 50 | `barbell-back-squat` | `back` | `adapt` | **`adapt`** | `chair-sit-to-stand` | moderate | `BACK_SQUAT_DELOAD` |
| 51 | `ez-bar-biceps-curl` | `back` | `avoid` | **`adapt`** | `seated-dumbbell-curl` | moderate | `BACK_SEATED_CURL` |
| 52 | `ez-bar-biceps-curl` | `shoulder` | `avoid` | **`not_applicable`** | `` | moderate | `SHOULDER_ELBOW_FLEXION_PRIMARY` |
| 53 | `ez-bar-biceps-curl` | `elbow` | `adapt` | **`adapt`** | `hammer-curl` | low | `ELBOW_CURL_NEUTRAL_GRIP` |
| 54 | `triceps-rope-pushdown` | `back` | `avoid` | **`adapt`** | `cable-triceps-pushdown` | moderate | `BACK_CABLE_TRICEPS` |
| 55 | `triceps-rope-pushdown` | `shoulder` | `avoid` | **`adapt`** | `cable-triceps-pushdown` | moderate | `SHOULDER_TRICEPS_DELOAD` |
| 56 | `triceps-rope-pushdown` | `elbow` | `adapt` | **`compatible`** | `` | low | `ELBOW_GRADED_ROPE_EXTENSION` |
| 57 | `dead-bug` | `knee` | `avoid` | **`not_applicable`** | `` | high | `KNEE_NON_WEIGHT_BEARING_CORE` |
| 58 | `dead-bug` | `hip` | `avoid` | **`compatible`** | `` | low | `HIP_LOW_LOAD_CORE` |
| 59 | `dead-bug` | `shoulder` | `avoid` | **`compatible`** | `` | low | `SHOULDER_LOW_LOAD_CORE` |
| 60 | `seated-hip-abductor-machine` | `knee` | `avoid` | **`not_applicable`** | `` | high | `KNEE_SEATED_NON_KNEE_PATTERN` |
| 61 | `seated-hip-abductor-machine` | `hip` | `adapt` | **`compatible`** | `` | moderate | `HIP_GRADED_SEATED_ABDUCTION` |
| 62 | `seated-hip-abductor-machine` | `ankle_foot` | `avoid` | **`not_applicable`** | `` | high | `ANKLE_SEATED_LYING_NON_ANKLE_PATTERN` |
| 63 | `bench-step-up` | `back` | `avoid` | **`adapt`** | `supported-low-step-up` | moderate | `BACK_LOWER_LIMB_SUPPORT` |
| 64 | `seated-leg-curl-machine` | `hip` | `avoid` | **`not_applicable`** | `` | moderate | `HIP_NON_HIP_DOMINANT_ISOLATION` |
| 65 | `seated-leg-curl-machine` | `ankle_foot` | `avoid` | **`not_applicable`** | `` | high | `ANKLE_SEATED_LYING_NON_ANKLE_PATTERN` |
| 66 | `march-in-place` | `back` | `avoid` | **`compatible`** | `` | moderate | `BACK_GRADED_AEROBIC_BALANCE` |
| 67 | `resistance-band-row` | `elbow` | `adapt` | **`compatible`** | `` | low | `ELBOW_GRADED_BAND_ROW` |
| 68 | `resistance-band-row` | `wrist` | `adapt` | **`compatible`** | `` | low | `WRIST_GRADED_BAND_ROW` |
| 69 | `bulgarian-split-squat-dumbbell` | `back` | `avoid` | **`adapt`** | `supported-low-step-up` | moderate | `BACK_LOWER_LIMB_SUPPORT` |
| 70 | `push-up` | `back` | `avoid` | **`adapt`** | `wall-push-up` | moderate | `BACK_PUSH_DELOAD` |
| 71 | `stationary-bike` | `back` | `avoid` | **`compatible`** | `` | moderate | `BACK_GRADED_AEROBIC_BALANCE` |
| 72 | `farmers-walk` | `knee` | `avoid` | **`compatible`** | `` | low | `KNEE_GRADED_GAIT_LOAD` |
| 73 | `farmers-walk` | `hip` | `avoid` | **`compatible`** | `` | low | `HIP_GRADED_GAIT_LOAD` |
| 74 | `farmers-walk` | `back` | `avoid` | **`compatible`** | `` | low | `BACK_GRADED_CARRY` |
| 75 | `farmers-walk` | `shoulder` | `avoid` | **`compatible`** | `` | low | `SHOULDER_GRADED_STATIC_CARRY` |
| 76 | `farmers-walk` | `elbow` | `avoid` | **`compatible`** | `` | low | `ELBOW_GRADED_ISOMETRIC_CARRY` |
| 77 | `farmers-walk` | `wrist` | `avoid` | **`compatible`** | `` | low | `WRIST_NEUTRAL_GRIP_GRADED_CARRY` |
| 78 | `farmers-walk` | `ankle_foot` | `avoid` | **`compatible`** | `` | low | `ANKLE_GRADED_LOADED_GAIT` |
| 79 | `hip-mobility` | `knee` | `avoid` | **`not_applicable`** | `` | moderate | `KNEE_MOBILITY_NON_KNEE_DOMINANT` |
| 80 | `hip-mobility` | `hip` | `avoid` | **`compatible`** | `` | moderate | `HIP_GENTLE_MOBILITY` |
| 81 | `hip-mobility` | `back` | `avoid` | **`compatible`** | `` | moderate | `BACK_GENTLE_MOBILITY` |
| 82 | `hip-mobility` | `shoulder` | `avoid` | **`not_applicable`** | `` | high | `SHOULDER_LOWER_BODY_MOBILITY` |
| 83 | `hip-mobility` | `ankle_foot` | `avoid` | **`not_applicable`** | `` | moderate | `ANKLE_NON_ANKLE_DOMINANT` |
| 84 | `cable-rear-delt-fly` | `back` | `avoid` | **`compatible`** | `` | low | `BACK_LOW_LOAD_CABLE_UPPER_BODY` |
| 85 | `cable-rear-delt-fly` | `shoulder` | `adapt` | **`compatible`** | `` | low | `SHOULDER_GRADED_REAR_DELT` |
| 86 | `unilateral-iso-lateral-row-machine` | `back` | `avoid` | **`adapt`** | `resistance-band-row` | moderate | `BACK_ROW_DELOAD` |
| 87 | `glute-bridge` | `knee` | `avoid` | **`compatible`** | `` | moderate | `KNEE_LOW_LOAD_HIP_EXTENSION` |
| 88 | `glute-bridge` | `hip` | `adapt` | **`compatible`** | `` | moderate | `HIP_GRADED_EXTENSION` |
| 89 | `glute-bridge` | `back` | `avoid` | **`compatible`** | `` | moderate | `BACK_GRADED_HIP_EXTENSION` |
| 90 | `glute-bridge` | `ankle_foot` | `avoid` | **`not_applicable`** | `` | moderate | `ANKLE_NON_WEIGHT_BEARING_HIP_EXTENSION` |
| 91 | `pallof-press` | `hip` | `avoid` | **`not_applicable`** | `` | moderate | `HIP_NON_HIP_DOMINANT_CORE` |
| 92 | `pallof-press` | `back` | `avoid` | **`compatible`** | `` | moderate | `BACK_TRUNK_CONTROL_EXERCISE` |
| 93 | `pallof-press` | `shoulder` | `avoid` | **`compatible`** | `` | low | `SHOULDER_LOW_LOAD_ANTI_ROTATION` |
| 94 | `pallof-press` | `elbow` | `avoid` | **`compatible`** | `` | low | `ELBOW_LOW_LOAD_ISOMETRIC_PRESS` |
| 95 | `pallof-press` | `wrist` | `avoid` | **`compatible`** | `` | low | `WRIST_NEUTRAL_GRIP_GRADED_BAND` |
| 96 | `walking-lunges` | `back` | `avoid` | **`adapt`** | `supported-low-step-up` | moderate | `BACK_LOWER_LIMB_SUPPORT` |
| 97 | `dumbbell-overhead-triceps-extension` | `back` | `avoid` | **`adapt`** | `cable-triceps-pushdown` | moderate | `BACK_CABLE_TRICEPS` |
| 98 | `dumbbell-overhead-triceps-extension` | `shoulder` | `adapt` | **`adapt`** | `cable-triceps-pushdown` | moderate | `SHOULDER_TRICEPS_DELOAD` |
| 99 | `dumbbell-overhead-triceps-extension` | `elbow` | `adapt` | **`adapt`** | `triceps-rope-pushdown` | low | `ELBOW_TRICEPS_GRADED` |
| 100 | `lying-leg-curl-machine` | `hip` | `avoid` | **`not_applicable`** | `` | moderate | `HIP_NON_HIP_DOMINANT_ISOLATION` |
| 101 | `lying-leg-curl-machine` | `back` | `avoid` | **`not_applicable`** | `` | moderate | `BACK_SEATED_LYING_DISTAL_ISOLATION` |
| 102 | `lying-leg-curl-machine` | `ankle_foot` | `avoid` | **`not_applicable`** | `` | high | `ANKLE_SEATED_LYING_NON_ANKLE_PATTERN` |
| 103 | `seated-dumbbell-curl` | `shoulder` | `avoid` | **`not_applicable`** | `` | moderate | `SHOULDER_ELBOW_FLEXION_PRIMARY` |
| 104 | `seated-dumbbell-curl` | `elbow` | `adapt` | **`adapt`** | `hammer-curl` | low | `ELBOW_CURL_NEUTRAL_GRIP` |
| 105 | `bird-dog` | `knee` | `adapt` | **`adapt`** | `dead-bug` | moderate | `KNEE_AVOID_KNEELING_CORE` |
| 106 | `bird-dog` | `hip` | `avoid` | **`compatible`** | `` | low | `HIP_LOW_LOAD_CORE` |
| 107 | `bird-dog` | `shoulder` | `adapt` | **`adapt`** | `dead-bug` | moderate | `SHOULDER_REMOVE_WEIGHT_BEARING_CORE` |
| 108 | `conventional-deadlift` | `knee` | `avoid` | **`adapt`** | `hip-hinge-drill` | moderate | `KNEE_HINGE_DELOAD` |
| 109 | `conventional-deadlift` | `hip` | `adapt` | **`adapt`** | `hip-hinge-drill` | moderate | `HIP_HINGE_DELOAD` |
| 110 | `conventional-deadlift` | `back` | `adapt` | **`adapt`** | `hip-hinge-drill` | moderate | `BACK_HINGE_DELOAD` |
| 111 | `conventional-deadlift` | `shoulder` | `avoid` | **`adapt`** | `hip-hinge-drill` | moderate | `SHOULDER_REMOVE_EXTERNAL_LOAD_HINGE` |
| 112 | `conventional-deadlift` | `wrist` | `adapt` | **`adapt`** | `dumbbell-stiff-leg-deadlift` | low | `WRIST_BAR_TO_DUMBBELL_HINGE` |
| 113 | `conventional-deadlift` | `ankle_foot` | `avoid` | **`adapt`** | `hip-hinge-drill` | low | `ANKLE_HINGE_DELOAD` |
| 114 | `hack-squat-machine` | `back` | `avoid` | **`adapt`** | `chair-sit-to-stand` | moderate | `BACK_SQUAT_DELOAD` |
| 115 | `incline-dumbbell-bench-press` | `back` | `avoid` | **`adapt`** | `machine-flat-bench-press` | moderate | `BACK_SUPPORTED_CHEST_PRESS` |
| 116 | `incline-dumbbell-bench-press` | `wrist` | `adapt` | **`adapt`** | `machine-flat-bench-press` | low | `WRIST_CHEST_PRESS_STABILIZATION_REDUCTION` |
| 117 | `supported-low-step-up` | `back` | `avoid` | **`compatible`** | `` | moderate | `BACK_SUPPORTED_STEP` |
| 118 | `cable-triceps-pushdown` | `shoulder` | `avoid` | **`not_applicable`** | `` | moderate | `SHOULDER_ELBOW_EXTENSION_BY_SIDE` |
| 119 | `cable-triceps-pushdown` | `elbow` | `adapt` | **`adapt`** | `triceps-rope-pushdown` | low | `ELBOW_TRICEPS_GRADED` |
| 120 | `leg-extension-machine` | `hip` | `avoid` | **`not_applicable`** | `` | moderate | `HIP_NON_HIP_DOMINANT_ISOLATION` |
| 121 | `leg-extension-machine` | `back` | `avoid` | **`not_applicable`** | `` | moderate | `BACK_SEATED_LYING_DISTAL_ISOLATION` |
| 122 | `leg-extension-machine` | `ankle_foot` | `avoid` | **`not_applicable`** | `` | high | `ANKLE_SEATED_LYING_NON_ANKLE_PATTERN` |
| 123 | `chair-sit-to-stand` | `back` | `avoid` | **`compatible`** | `` | moderate | `BACK_FUNCTIONAL_GRADED_SQUAT` |
| 124 | `floor-crunch` | `hip` | `avoid` | **`compatible`** | `` | low | `HIP_LOW_LOAD_CORE` |
| 125 | `floor-crunch` | `back` | `adapt` | **`compatible`** | `` | low | `BACK_GRADED_TRUNK_EXERCISE` |
| 126 | `hammer-curl` | `back` | `avoid` | **`adapt`** | `seated-dumbbell-curl` | moderate | `BACK_SEATED_CURL` |
| 127 | `hammer-curl` | `shoulder` | `avoid` | **`not_applicable`** | `` | moderate | `SHOULDER_ELBOW_FLEXION_PRIMARY` |
| 128 | `hammer-curl` | `elbow` | `adapt` | **`compatible`** | `` | low | `ELBOW_NEUTRAL_GRIP_GRADED_CURL` |
| 129 | `bodyweight-squat` | `back` | `avoid` | **`adapt`** | `chair-sit-to-stand` | moderate | `BACK_SQUAT_DELOAD` |
| 130 | `bulgarian-split-squat` | `back` | `avoid` | **`adapt`** | `supported-low-step-up` | moderate | `BACK_LOWER_LIMB_SUPPORT` |
| 131 | `low-step-up` | `back` | `avoid` | **`adapt`** | `supported-low-step-up` | moderate | `BACK_LOWER_LIMB_SUPPORT` |
| 132 | `mini-band-hip-abduction` | `knee` | `avoid` | **`adapt`** | `seated-hip-abductor-machine` | moderate | `KNEE_REMOVE_WEIGHT_BEARING_HIP_ABDUCTION` |
| 133 | `mini-band-hip-abduction` | `hip` | `adapt` | **`adapt`** | `seated-hip-abductor-machine` | moderate | `HIP_ABDUCTION_CONTROLLED_SEATED` |
| 134 | `mini-band-hip-abduction` | `back` | `avoid` | **`adapt`** | `seated-hip-abductor-machine` | moderate | `BACK_SEATED_HIP_ABDUCTION` |
| 135 | `mini-band-hip-abduction` | `ankle_foot` | `avoid` | **`adapt`** | `seated-hip-abductor-machine` | moderate | `ANKLE_REMOVE_STANDING_HIP_ABDUCTION` |
| 136 | `supported-calf-raise` | `knee` | `avoid` | **`compatible`** | `` | moderate | `KNEE_MINIMAL_FLEXION_CALF` |
| 137 | `supported-calf-raise` | `hip` | `avoid` | **`not_applicable`** | `` | moderate | `HIP_NON_HIP_DOMINANT_ISOLATION` |
| 138 | `supported-calf-raise` | `back` | `avoid` | **`compatible`** | `` | moderate | `BACK_SUPPORTED_LOW_LOAD` |
| 139 | `supported-standing-leg-curl` | `hip` | `avoid` | **`adapt`** | `seated-leg-curl-machine` | moderate | `HIP_REMOVE_STANDING_OR_BRIDGE_DEMAND` |
| 140 | `supported-standing-leg-curl` | `back` | `avoid` | **`adapt`** | `seated-leg-curl-machine` | moderate | `BACK_SEATED_HAMSTRING_CURL` |
| 141 | `supported-standing-leg-curl` | `ankle_foot` | `adapt` | **`adapt`** | `seated-leg-curl-machine` | moderate | `ANKLE_REMOVE_SINGLE_LEG_STANCE` |
| 142 | `controlled-marching` | `back` | `avoid` | **`compatible`** | `` | moderate | `BACK_GRADED_AEROBIC_BALANCE` |
| 143 | `gentle-direction-changes` | `knee` | `adapt` | **`compatible`** | `` | low | `KNEE_GRADED_GAIT_CONTROL` |
| 144 | `gentle-direction-changes` | `hip` | `adapt` | **`compatible`** | `` | low | `HIP_GRADED_GAIT_CONTROL` |
| 145 | `gentle-direction-changes` | `back` | `avoid` | **`compatible`** | `` | moderate | `BACK_GRADED_AEROBIC_BALANCE` |
| 146 | `gentle-direction-changes` | `ankle_foot` | `adapt` | **`compatible`** | `` | low | `ANKLE_GRADED_DIRECTION_CHANGE` |
| 147 | `supported-semi-tandem-stance` | `back` | `avoid` | **`compatible`** | `` | moderate | `BACK_GRADED_AEROBIC_BALANCE` |
| 148 | `thoracic-mobility` | `knee` | `avoid` | **`not_applicable`** | `` | moderate | `KNEE_MOBILITY_NON_KNEE_DOMINANT` |
| 149 | `thoracic-mobility` | `back` | `avoid` | **`compatible`** | `` | moderate | `BACK_GENTLE_MOBILITY` |
| 150 | `thoracic-mobility` | `shoulder` | `avoid` | **`compatible`** | `` | low | `SHOULDER_GRADED_THORACIC_MOBILITY` |
| 151 | `thoracic-mobility` | `ankle_foot` | `avoid` | **`not_applicable`** | `` | moderate | `ANKLE_NON_ANKLE_DOMINANT` |
| 152 | `v-bar-pulldown` | `shoulder` | `adapt` | **`adapt`** | `resistance-band-lat-pulldown` | low | `SHOULDER_VERTICAL_PULL_DELOAD` |
| 153 | `v-bar-pulldown` | `elbow` | `adapt` | **`adapt`** | `resistance-band-lat-pulldown` | low | `ELBOW_PULL_DELOAD` |
| 154 | `v-bar-pulldown` | `wrist` | `adapt` | **`adapt`** | `resistance-band-lat-pulldown` | low | `WRIST_PULL_DELOAD` |
| 155 | `weight-shift` | `back` | `avoid` | **`compatible`** | `` | moderate | `BACK_GRADED_AEROBIC_BALANCE` |
| 156 | `chair-squat` | `back` | `avoid` | **`adapt`** | `chair-sit-to-stand` | moderate | `BACK_SQUAT_DELOAD` |
| 157 | `resistance-band-shoulder-press` | `back` | `avoid` | **`adapt`** | `machine-shoulder-press` | moderate | `BACK_SEATED_SUPPORTED_PRESS` |
| 158 | `resistance-band-shoulder-press` | `wrist` | `adapt` | **`adapt`** | `seated-resistance-band-shoulder-press` | low | `WRIST_PRESS_STABILIZATION_REDUCTION` |
| 159 | `seated-resistance-band-shoulder-press` | `shoulder` | `adapt` | **`compatible`** | `` | low | `SHOULDER_GRADED_BAND_PRESS` |
| 160 | `seated-resistance-band-shoulder-press` | `elbow` | `adapt` | **`compatible`** | `` | low | `ELBOW_GRADED_BAND_PRESS` |
| 161 | `seated-resistance-band-shoulder-press` | `wrist` | `adapt` | **`compatible`** | `` | low | `WRIST_GRADED_SUPPORTED_PRESS` |
| 162 | `supported-hip-abduction` | `knee` | `avoid` | **`adapt`** | `seated-hip-abductor-machine` | moderate | `KNEE_REMOVE_WEIGHT_BEARING_HIP_ABDUCTION` |
| 163 | `supported-hip-abduction` | `hip` | `adapt` | **`adapt`** | `seated-hip-abductor-machine` | moderate | `HIP_ABDUCTION_CONTROLLED_SEATED` |
| 164 | `supported-hip-abduction` | `back` | `avoid` | **`adapt`** | `seated-hip-abductor-machine` | moderate | `BACK_SEATED_HIP_ABDUCTION` |
| 165 | `supported-hip-abduction` | `ankle_foot` | `avoid` | **`adapt`** | `seated-hip-abductor-machine` | moderate | `ANKLE_REMOVE_STANDING_HIP_ABDUCTION` |
| 166 | `wall-push-up` | `back` | `avoid` | **`compatible`** | `` | moderate | `BACK_UPRIGHT_SUPPORTED_PUSH` |
| 167 | `wall-push-up` | `ankle_foot` | `avoid` | **`not_applicable`** | `` | moderate | `ANKLE_NON_ANKLE_DOMINANT` |
| 168 | `hip-hinge-drill` | `knee` | `avoid` | **`compatible`** | `` | moderate | `KNEE_LOW_FLEXION_HINGE` |
| 169 | `hip-hinge-drill` | `hip` | `adapt` | **`compatible`** | `` | moderate | `HIP_GRADED_HINGE` |
| 170 | `hip-hinge-drill` | `back` | `adapt` | **`compatible`** | `` | moderate | `BACK_GRADED_HINGE_MOTOR_CONTROL` |
| 171 | `hip-hinge-drill` | `ankle_foot` | `avoid` | **`compatible`** | `` | low | `ANKLE_STATIC_LOW_LOAD_HINGE` |
| 172 | `slider-leg-curl` | `hip` | `avoid` | **`adapt`** | `seated-leg-curl-machine` | moderate | `HIP_REMOVE_STANDING_OR_BRIDGE_DEMAND` |
| 173 | `slider-leg-curl` | `back` | `avoid` | **`adapt`** | `seated-leg-curl-machine` | moderate | `BACK_SEATED_HAMSTRING_CURL` |
| 174 | `slider-leg-curl` | `ankle_foot` | `avoid` | **`compatible`** | `` | low | `ANKLE_LOW_LOAD_HEEL_CONTACT` |
| 175 | `supported-balance` | `back` | `avoid` | **`compatible`** | `` | moderate | `BACK_GRADED_AEROBIC_BALANCE` |
| 176 | `stationary-lunge` | `back` | `avoid` | **`adapt`** | `supported-low-step-up` | moderate | `BACK_LOWER_LIMB_SUPPORT` |

## Regra de implementação

O JSON `AJ_Fit_limitation_clinical_decisions_v1.json` é a fonte de verdade para materialização. Nenhum alvo deve ser trocado por conveniência técnica. Se um `adapt` aprovado falhar por uma restrição estrutural do catálogo, deve-se primeiro corrigir **pontualmente** a relação de substituição/metadata que torna esse par tecnicamente elegível e reexecutar o resolver; não relaxar globalmente o resolver.