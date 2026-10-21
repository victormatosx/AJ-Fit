> Registro histórico: as seções sobre limitações musculoesqueléticas estão descontinuadas. As demais regras independentes continuam sujeitas ao código atual. Ver [remoção definitiva](../../removal-physical-limitations/REPORT.md).

# AJ Fit — Session Duration Rules V1

Status: `IMPLEMENTED`.

## 1. Sem promessa de cronômetro

A resposta 30/45/60/90 representa preferência aproximada. O Prescription
Engine não estima repetição, set, descanso, setup, transição ou duração total.
DR-025 não bloqueia a V1.

## 2. Regra determinística

```text
30 min: keepCount = ceil(exerciseCount × 0.60)
45 min: keepCount = ceil(exerciseCount × 0.80)
60 min: keepCount = exerciseCount
90 min: keepCount = exerciseCount
```

90 nunca obriga adicionar exercício ou volume. 60/90 podem receber apenas o
+1 set previsto pela regra de muscle priority.

## 3. Como escolher o que permanece

Partir da sessão após safety, limitations e equipment:

1. proteger o primeiro exercício;
2. proteger o primeiro exercício relevante de cada priority que caiba;
3. preencher pelas primeiras posições canônicas;
4. se todos os retidos tiverem o mesmo movement pattern e houver outro,
   substituir o último não protegido pelo primeiro omitido diferente;
5. preservar a ordem relativa e nunca reintroduzir exercício incompatível.

Isso usa a qualidade/ordem dos templates e metadata existente, sem `slotRole`.

## 4. Fallback para sessão curta

Quando `ceil` não remove exercício porque a sessão já é curta, reduzir
exatamente um set do último exercício elegível com sets numéricos >1. Nunca
ficar abaixo de 1. Se não houver candidato, manter a sessão; não cortar
duration/cycles nem inventar outra dose.

O fallback é no máximo uma redução por sessão e não tenta provar quantos minutos
foram economizados.

## 5. Interações

- priority signal é calculado antes da redução;
- 30 usa priority somente para preservar/ordenar e nunca adiciona set;
- 45 só permite +1 priority quando nenhum exercício/fallback foi reduzido;
- beginner e duration calculam sobre a base; aplica-se o menor target;
- Beginner Week 1/2 nunca recebe sets extras;
- safety e populações especiais não são relaxadas para “caber”.

## 6. Auditoria

Nos 378 treinos, `ceil(n×0,60)` retém 67,2% dos 2.108 slots e altera 338
sessões. `ceil(n×0,80)` retém 86,1% e altera 288 sessões. A regra de prefixo não
gerou caso de único movement pattern quando a sessão completa tinha vários.

## 7. Validation e trace

Validar sessão não vazia, exercícios existentes, constraints e sets ≥1.

```yaml
duration:
  preference: 30|45|60|90
  baseExerciseCount: 0
  targetExerciseCount: 0
  removedExerciseIds: []
  fallbackSetReducedExerciseId: null
```

Não registrar `estimatedMinutes`, pois a V1 não os calcula.
