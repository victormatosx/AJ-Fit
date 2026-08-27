# Limitation Remediation Queue

Generated: 2026-08-27T14:34:50.293Z

Fila de decisões de conteúdo/clínicas pendentes, agrupada por decisão
compartilhada (corrigir um target de `adapt` resolve todas as linhas do
grupo de uma vez). Nenhuma decisão foi tomada — `clinicalDecision` é sempre
`null` neste artefato. As opções listadas são categorias de resolução, não
uma escolha feita por este script.

Total de unidades de decisão: **151** (vs. 176 linhas individuais —
agrupar por target compartilhado reduz o esforço humano de revisão).

## Top 20 unidades de decisão por impacto

---

### [P0] DECISÃO COMPARTILHADA — target `resistance-band-row`

**RESOLVE 5 OCORRÊNCIAS DE UMA VEZ**

EXERCÍCIOS AFETADOS
Remada Articulada (`iso-lateral-row-machine`), Remada Serrote Unilateral (`one-arm-dumbbell-row`), Remada Baixa Aberta Pegada Neutra (`low-cable-row-wide-neutral-grip`), Posterior de Ombro na Polia (`cable-rear-delt-fly`), Remada Articulada Unilateral (`unilateral-iso-lateral-row-machine`)

REGIÃO
elbow

REGRA ATUAL (comum ao grupo)
`adapt` → `resistance-band-row`

PROBLEMA
`resistance-band-row` está marcado `adapt` para elbow, e o resolver não segue cadeias (V1 não recursivo) — nenhum dos 5 exercícios que adaptam para ele pode ser resolvido enquanto isso não mudar.

IMPACTO
81 templates

DECISÃO NECESSÁRIA
Definir o comportamento clínico de `resistance-band-row` para elbow (ou redirecionar os 5 exercícios para outro target aprovado).

POSSÍVEIS TIPOS DE RESOLUÇÃO
- tornar status terminal (`compatible`/`not_applicable`), se clinicamente correto;
- fornecer outro target de adaptação já aprovado e diretamente terminal;
- confirmar `avoid` com uma lista real de substitutos seguros;
- outra decisão clinicamente revisada.

---

### [P0] DECISÃO COMPARTILHADA — target `resistance-band-row`

**RESOLVE 5 OCORRÊNCIAS DE UMA VEZ**

EXERCÍCIOS AFETADOS
Remada Articulada (`iso-lateral-row-machine`), Remada Serrote Unilateral (`one-arm-dumbbell-row`), Remada Baixa Aberta Pegada Neutra (`low-cable-row-wide-neutral-grip`), Posterior de Ombro na Polia (`cable-rear-delt-fly`), Remada Articulada Unilateral (`unilateral-iso-lateral-row-machine`)

REGIÃO
wrist

REGRA ATUAL (comum ao grupo)
`adapt` → `resistance-band-row`

PROBLEMA
`resistance-band-row` está marcado `adapt` para wrist, e o resolver não segue cadeias (V1 não recursivo) — nenhum dos 5 exercícios que adaptam para ele pode ser resolvido enquanto isso não mudar.

IMPACTO
81 templates

DECISÃO NECESSÁRIA
Definir o comportamento clínico de `resistance-band-row` para wrist (ou redirecionar os 5 exercícios para outro target aprovado).

POSSÍVEIS TIPOS DE RESOLUÇÃO
- tornar status terminal (`compatible`/`not_applicable`), se clinicamente correto;
- fornecer outro target de adaptação já aprovado e diretamente terminal;
- confirmar `avoid` com uma lista real de substitutos seguros;
- outra decisão clinicamente revisada.

---

### [P0] DECISÃO COMPARTILHADA — target `seated-resistance-band-shoulder-press`

**RESOLVE 3 OCORRÊNCIAS DE UMA VEZ**

EXERCÍCIOS AFETADOS
Desenvolvimento com Halteres (`dumbbell-shoulder-press`), Desenvolvimento Máquina (`machine-shoulder-press`), Desenvolvimento com Elástico (`resistance-band-shoulder-press`)

REGIÃO
shoulder

REGRA ATUAL (comum ao grupo)
`adapt` → `seated-resistance-band-shoulder-press`

PROBLEMA
`seated-resistance-band-shoulder-press` está marcado `adapt` para shoulder, e o resolver não segue cadeias (V1 não recursivo) — nenhum dos 3 exercícios que adaptam para ele pode ser resolvido enquanto isso não mudar.

IMPACTO
82 templates

DECISÃO NECESSÁRIA
Definir o comportamento clínico de `seated-resistance-band-shoulder-press` para shoulder (ou redirecionar os 3 exercícios para outro target aprovado).

POSSÍVEIS TIPOS DE RESOLUÇÃO
- tornar status terminal (`compatible`/`not_applicable`), se clinicamente correto;
- fornecer outro target de adaptação já aprovado e diretamente terminal;
- confirmar `avoid` com uma lista real de substitutos seguros;
- outra decisão clinicamente revisada.

---

### [P0] DECISÃO COMPARTILHADA — target `seated-resistance-band-shoulder-press`

**RESOLVE 3 OCORRÊNCIAS DE UMA VEZ**

EXERCÍCIOS AFETADOS
Desenvolvimento com Halteres (`dumbbell-shoulder-press`), Desenvolvimento Máquina (`machine-shoulder-press`), Desenvolvimento com Elástico (`resistance-band-shoulder-press`)

REGIÃO
elbow

REGRA ATUAL (comum ao grupo)
`adapt` → `seated-resistance-band-shoulder-press`

PROBLEMA
`seated-resistance-band-shoulder-press` está marcado `adapt` para elbow, e o resolver não segue cadeias (V1 não recursivo) — nenhum dos 3 exercícios que adaptam para ele pode ser resolvido enquanto isso não mudar.

IMPACTO
82 templates

DECISÃO NECESSÁRIA
Definir o comportamento clínico de `seated-resistance-band-shoulder-press` para elbow (ou redirecionar os 3 exercícios para outro target aprovado).

POSSÍVEIS TIPOS DE RESOLUÇÃO
- tornar status terminal (`compatible`/`not_applicable`), se clinicamente correto;
- fornecer outro target de adaptação já aprovado e diretamente terminal;
- confirmar `avoid` com uma lista real de substitutos seguros;
- outra decisão clinicamente revisada.

---

### [P0] DECISÃO COMPARTILHADA — target `hip-hinge-drill`

**RESOLVE 2 OCORRÊNCIAS DE UMA VEZ**

EXERCÍCIOS AFETADOS
Stiff com Halteres (`dumbbell-stiff-leg-deadlift`), Levantamento Terra (`conventional-deadlift`)

REGIÃO
hip

REGRA ATUAL (comum ao grupo)
`adapt` → `hip-hinge-drill`

PROBLEMA
`hip-hinge-drill` está marcado `adapt` para hip, e o resolver não segue cadeias (V1 não recursivo) — nenhum dos 2 exercícios que adaptam para ele pode ser resolvido enquanto isso não mudar.

IMPACTO
84 templates

DECISÃO NECESSÁRIA
Definir o comportamento clínico de `hip-hinge-drill` para hip (ou redirecionar os 2 exercícios para outro target aprovado).

POSSÍVEIS TIPOS DE RESOLUÇÃO
- tornar status terminal (`compatible`/`not_applicable`), se clinicamente correto;
- fornecer outro target de adaptação já aprovado e diretamente terminal;
- confirmar `avoid` com uma lista real de substitutos seguros;
- outra decisão clinicamente revisada.

---

### [P0] DECISÃO COMPARTILHADA — target `hip-hinge-drill`

**RESOLVE 2 OCORRÊNCIAS DE UMA VEZ**

EXERCÍCIOS AFETADOS
Stiff com Halteres (`dumbbell-stiff-leg-deadlift`), Levantamento Terra (`conventional-deadlift`)

REGIÃO
back

REGRA ATUAL (comum ao grupo)
`adapt` → `hip-hinge-drill`

PROBLEMA
`hip-hinge-drill` está marcado `adapt` para back, e o resolver não segue cadeias (V1 não recursivo) — nenhum dos 2 exercícios que adaptam para ele pode ser resolvido enquanto isso não mudar.

IMPACTO
84 templates

DECISÃO NECESSÁRIA
Definir o comportamento clínico de `hip-hinge-drill` para back (ou redirecionar os 2 exercícios para outro target aprovado).

POSSÍVEIS TIPOS DE RESOLUÇÃO
- tornar status terminal (`compatible`/`not_applicable`), se clinicamente correto;
- fornecer outro target de adaptação já aprovado e diretamente terminal;
- confirmar `avoid` com uma lista real de substitutos seguros;
- outra decisão clinicamente revisada.

---

### [P0] DECISÃO COMPARTILHADA — target `chair-squat`

**RESOLVE 2 OCORRÊNCIAS DE UMA VEZ**

EXERCÍCIOS AFETADOS
Agachamento Goblet (`goblet-squat`), Agachamento Livre (`barbell-back-squat`)

REGIÃO
back

REGRA ATUAL (comum ao grupo)
`adapt` → `chair-squat`

PROBLEMA
`chair-squat` está marcado `avoid` para back, e o resolver não segue cadeias (V1 não recursivo) — nenhum dos 2 exercícios que adaptam para ele pode ser resolvido enquanto isso não mudar.

IMPACTO
81 templates

DECISÃO NECESSÁRIA
Definir o comportamento clínico de `chair-squat` para back (ou redirecionar os 2 exercícios para outro target aprovado).

POSSÍVEIS TIPOS DE RESOLUÇÃO
- tornar status terminal (`compatible`/`not_applicable`), se clinicamente correto;
- fornecer outro target de adaptação já aprovado e diretamente terminal;
- confirmar `avoid` com uma lista real de substitutos seguros;
- outra decisão clinicamente revisada.

---

### [P0] DECISÃO COMPARTILHADA — target `dead-bug`

**RESOLVE 2 OCORRÊNCIAS DE UMA VEZ**

EXERCÍCIOS AFETADOS
Prancha (`plank`), Bird Dog (`bird-dog`)

REGIÃO
knee

REGRA ATUAL (comum ao grupo)
`adapt` → `dead-bug`

PROBLEMA
`dead-bug` está marcado `avoid` para knee, e o resolver não segue cadeias (V1 não recursivo) — nenhum dos 2 exercícios que adaptam para ele pode ser resolvido enquanto isso não mudar.

IMPACTO
72 templates

DECISÃO NECESSÁRIA
Definir o comportamento clínico de `dead-bug` para knee (ou redirecionar os 2 exercícios para outro target aprovado).

POSSÍVEIS TIPOS DE RESOLUÇÃO
- tornar status terminal (`compatible`/`not_applicable`), se clinicamente correto;
- fornecer outro target de adaptação já aprovado e diretamente terminal;
- confirmar `avoid` com uma lista real de substitutos seguros;
- outra decisão clinicamente revisada.

---

### [P0] DECISÃO COMPARTILHADA — target `dead-bug`

**RESOLVE 2 OCORRÊNCIAS DE UMA VEZ**

EXERCÍCIOS AFETADOS
Prancha (`plank`), Bird Dog (`bird-dog`)

REGIÃO
shoulder

REGRA ATUAL (comum ao grupo)
`adapt` → `dead-bug`

PROBLEMA
`dead-bug` está marcado `avoid` para shoulder, e o resolver não segue cadeias (V1 não recursivo) — nenhum dos 2 exercícios que adaptam para ele pode ser resolvido enquanto isso não mudar.

IMPACTO
72 templates

DECISÃO NECESSÁRIA
Definir o comportamento clínico de `dead-bug` para shoulder (ou redirecionar os 2 exercícios para outro target aprovado).

POSSÍVEIS TIPOS DE RESOLUÇÃO
- tornar status terminal (`compatible`/`not_applicable`), se clinicamente correto;
- fornecer outro target de adaptação já aprovado e diretamente terminal;
- confirmar `avoid` com uma lista real de substitutos seguros;
- outra decisão clinicamente revisada.

---

### [P0] DECISÃO COMPARTILHADA — target `machine-shoulder-press`

**RESOLVE 2 OCORRÊNCIAS DE UMA VEZ**

EXERCÍCIOS AFETADOS
Desenvolvimento com Halteres (`dumbbell-shoulder-press`), Desenvolvimento com Elástico Sentado (`seated-resistance-band-shoulder-press`)

REGIÃO
wrist

REGRA ATUAL (comum ao grupo)
`adapt` → `machine-shoulder-press`

PROBLEMA
`machine-shoulder-press` está marcado `adapt` para wrist, e o resolver não segue cadeias (V1 não recursivo) — nenhum dos 2 exercícios que adaptam para ele pode ser resolvido enquanto isso não mudar.

IMPACTO
47 templates

DECISÃO NECESSÁRIA
Definir o comportamento clínico de `machine-shoulder-press` para wrist (ou redirecionar os 2 exercícios para outro target aprovado).

POSSÍVEIS TIPOS DE RESOLUÇÃO
- tornar status terminal (`compatible`/`not_applicable`), se clinicamente correto;
- fornecer outro target de adaptação já aprovado e diretamente terminal;
- confirmar `avoid` com uma lista real de substitutos seguros;
- outra decisão clinicamente revisada.

---

### [P0] Stiff com Halteres (`dumbbell-stiff-leg-deadlift`)

REGIÃO
knee

REGRA ATUAL
`avoid`

PROBLEMA
regra `avoid` sem candidato de substituição persistido (`missing_exercise_candidate`)

IMPACTO
80 templates

DECISÃO NECESSÁRIA
Definir o comportamento clínico de Stiff com Halteres para knee.

POSSÍVEIS TIPOS DE RESOLUÇÃO
- tornar status terminal (`compatible`/`not_applicable`), se clinicamente correto;
- fornecer outro target de adaptação já aprovado e diretamente terminal;
- confirmar `avoid` com uma lista real de substitutos seguros;
- outra decisão clinicamente revisada.

---

### [P0] Stiff com Halteres (`dumbbell-stiff-leg-deadlift`)

REGIÃO
shoulder

REGRA ATUAL
`avoid`

PROBLEMA
regra `avoid` sem candidato de substituição persistido (`missing_exercise_candidate`)

IMPACTO
80 templates

DECISÃO NECESSÁRIA
Definir o comportamento clínico de Stiff com Halteres para shoulder.

POSSÍVEIS TIPOS DE RESOLUÇÃO
- tornar status terminal (`compatible`/`not_applicable`), se clinicamente correto;
- fornecer outro target de adaptação já aprovado e diretamente terminal;
- confirmar `avoid` com uma lista real de substitutos seguros;
- outra decisão clinicamente revisada.

---

### [P0] Stiff com Halteres (`dumbbell-stiff-leg-deadlift`)

REGIÃO
ankle_foot

REGRA ATUAL
`avoid`

PROBLEMA
regra `avoid` sem candidato de substituição persistido (`missing_exercise_candidate`)

IMPACTO
80 templates

DECISÃO NECESSÁRIA
Definir o comportamento clínico de Stiff com Halteres para ankle_foot.

POSSÍVEIS TIPOS DE RESOLUÇÃO
- tornar status terminal (`compatible`/`not_applicable`), se clinicamente correto;
- fornecer outro target de adaptação já aprovado e diretamente terminal;
- confirmar `avoid` com uma lista real de substitutos seguros;
- outra decisão clinicamente revisada.

---

### [P0] Prancha (`plank`)

REGIÃO
hip

REGRA ATUAL
`avoid`

PROBLEMA
regra `avoid` sem candidato de substituição persistido (`missing_exercise_candidate`)

IMPACTO
60 templates

DECISÃO NECESSÁRIA
Definir o comportamento clínico de Prancha para hip.

POSSÍVEIS TIPOS DE RESOLUÇÃO
- tornar status terminal (`compatible`/`not_applicable`), se clinicamente correto;
- fornecer outro target de adaptação já aprovado e diretamente terminal;
- confirmar `avoid` com uma lista real de substitutos seguros;
- outra decisão clinicamente revisada.

---

### [P0] Agachamento Goblet (`goblet-squat`)

REGIÃO
wrist

REGRA ATUAL
`avoid`

PROBLEMA
regra `avoid` sem candidato de substituição persistido (`missing_exercise_candidate`)

IMPACTO
48 templates

DECISÃO NECESSÁRIA
Definir o comportamento clínico de Agachamento Goblet para wrist.

POSSÍVEIS TIPOS DE RESOLUÇÃO
- tornar status terminal (`compatible`/`not_applicable`), se clinicamente correto;
- fornecer outro target de adaptação já aprovado e diretamente terminal;
- confirmar `avoid` com uma lista real de substitutos seguros;
- outra decisão clinicamente revisada.

---

### [P0] Elevação Pélvica (`hip-thrust`)

REGIÃO
knee

REGRA ATUAL
`avoid`

PROBLEMA
regra `avoid` sem candidato de substituição persistido (`missing_exercise_candidate`)

IMPACTO
48 templates

DECISÃO NECESSÁRIA
Definir o comportamento clínico de Elevação Pélvica para knee.

POSSÍVEIS TIPOS DE RESOLUÇÃO
- tornar status terminal (`compatible`/`not_applicable`), se clinicamente correto;
- fornecer outro target de adaptação já aprovado e diretamente terminal;
- confirmar `avoid` com uma lista real de substitutos seguros;
- outra decisão clinicamente revisada.

---

### [P0] Elevação Pélvica (`hip-thrust`)

REGIÃO
hip

REGRA ATUAL
`adapt` → `glute-bridge`

PROBLEMA
target `glute-bridge` está `adapt` para hip

IMPACTO
48 templates

DECISÃO NECESSÁRIA
Definir o comportamento clínico de Elevação Pélvica para hip.

POSSÍVEIS TIPOS DE RESOLUÇÃO
- tornar status terminal (`compatible`/`not_applicable`), se clinicamente correto;
- fornecer outro target de adaptação já aprovado e diretamente terminal;
- confirmar `avoid` com uma lista real de substitutos seguros;
- outra decisão clinicamente revisada.

---

### [P0] Elevação Pélvica (`hip-thrust`)

REGIÃO
back

REGRA ATUAL
`avoid`

PROBLEMA
regra `avoid` sem candidato de substituição persistido (`missing_exercise_candidate`)

IMPACTO
48 templates

DECISÃO NECESSÁRIA
Definir o comportamento clínico de Elevação Pélvica para back.

POSSÍVEIS TIPOS DE RESOLUÇÃO
- tornar status terminal (`compatible`/`not_applicable`), se clinicamente correto;
- fornecer outro target de adaptação já aprovado e diretamente terminal;
- confirmar `avoid` com uma lista real de substitutos seguros;
- outra decisão clinicamente revisada.

---

### [P0] Elevação Pélvica (`hip-thrust`)

REGIÃO
ankle_foot

REGRA ATUAL
`avoid`

PROBLEMA
regra `avoid` sem candidato de substituição persistido (`missing_exercise_candidate`)

IMPACTO
48 templates

DECISÃO NECESSÁRIA
Definir o comportamento clínico de Elevação Pélvica para ankle_foot.

POSSÍVEIS TIPOS DE RESOLUÇÃO
- tornar status terminal (`compatible`/`not_applicable`), se clinicamente correto;
- fornecer outro target de adaptação já aprovado e diretamente terminal;
- confirmar `avoid` com uma lista real de substitutos seguros;
- outra decisão clinicamente revisada.

---

### [P0] Desenvolvimento com Halteres (`dumbbell-shoulder-press`)

REGIÃO
back

REGRA ATUAL
`avoid`

PROBLEMA
regra `avoid` sem candidato de substituição persistido (`missing_exercise_candidate`)

IMPACTO
47 templates

DECISÃO NECESSÁRIA
Definir o comportamento clínico de Desenvolvimento com Halteres para back.

POSSÍVEIS TIPOS DE RESOLUÇÃO
- tornar status terminal (`compatible`/`not_applicable`), se clinicamente correto;
- fornecer outro target de adaptação já aprovado e diretamente terminal;
- confirmar `avoid` com uma lista real de substitutos seguros;
- outra decisão clinicamente revisada.
