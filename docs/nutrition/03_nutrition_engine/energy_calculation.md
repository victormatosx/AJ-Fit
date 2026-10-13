# AJ Fit Nutrition — Cálculo Energético

## 1. Objetivo

Definir como a V1 estima gasto energético e transforma os dados do usuário em uma meta calórica diária.

O cálculo é responsabilidade do Nutrition Engine. A IA não escolhe RMR, TDEE, déficit, superávit ou limites de segurança.

## 2. Fórmula de metabolismo de repouso

A V1 utilizará **Mifflin–St Jeor** como equação preditiva padrão para adultos.

### Masculino

`RMR = 10 × pesoKg + 6.25 × alturaCm - 5 × idadeAnos + 5`

### Feminino

`RMR = 10 × pesoKg + 6.25 × alturaCm - 5 × idadeAnos - 161`

A equação produz uma estimativa, não uma medição.

## 3. Inputs

- peso atual: último registro de evolução;
- altura: fonte autoritativa atual;
- idade: derivada da data de nascimento;
- sexo: fonte autoritativa atual;
- objetivo: objetivo geral do AJ Fit;
- atividade fora do treino: Perfil Nutricional;
- contexto de treino: fonte autoritativa de treino, quando necessário.

## 4. Atividade fora do treino

Valores:

- sedentary;
- low_active;
- active;
- very_active.

Esses níveis descrevem somente a rotina fora das sessões de treino.

A implementação deve evitar dupla contagem entre atividade cotidiana e treino.

### Decisão final (fechada, `canonical/nutrition_rules.json` `energy.tdeeStrategy`)

```text
tdeeKcal = rmrKcal × nonTrainingActivityFactor[level] + (weeklyTrainingFrequency × trainingSessionKcal(weightKg) / 7)
```

Multiplicadores de atividade NÃO-treino (deliberadamente mais baixos que a escala PAL convencional, que já embute exercício nos próprios rótulos — ver justificativa completa em `canonical/nutrition_rules.json`):

| Nível | Fator |
|---|---|
| sedentary | 1.2 |
| low_active | 1.3 |
| active | 1.4 |
| very_active | 1.5 |

Contribuição do treino, por sessão, em função do peso:

```text
trainingSessionKcal(weightKg) = 5.0 × 3.5 × weightKg / 200 × 50
```

(fórmula padrão ACSM METs→kcal/min; MET 5.0 = ponto médio de treino resistido no Compendium of Physical Activities; 50 minutos = suposição plana de sessão média da V1.)

Fontes completas em `canonical/nutrition_rules.json` `energy.tdeeStrategy`.

## 5. TDEE

Fluxo conceitual (fechado):

`RMR × fator de atividade fora do treino + contribuição do treino (via weeklyTrainingFrequency) -> TDEE estimado`

O valor final é determinístico e auditável — mesma entrada produz sempre o mesmo TDEE.

## 6. Meta calórica por objetivo

### Perder peso
Aplicar déficit percentual sobre o TDEE.

### Ganhar massa muscular
Aplicar superávit percentual sobre o TDEE.

### Manter peso
Meta próxima ao TDEE estimado.

### Melhorar composição corporal
Usar regra canônica própria. A IA não decide a estratégia energética.

## 7. Velocidade de evolução

Valores:

- gradual;
- moderate;
- accelerated.

A velocidade modifica a magnitude do déficit ou superávit.

Percentuais fechados (`canonical/nutrition_rules.json` `goals.deficitPercentages`/`surplusPercentages`, fontes: Garthe et al. 2011; Helms, Aragon & Fitschen 2014; Aragon & Schoenfeld 2013):

| Pace | Déficit (perda de peso) | Superávit (ganho de massa) |
|---|---|---|
| gradual | 10% | 5% |
| moderate | 15% | 10% |
| accelerated | 20% | 15% |

`body_recomposition` não varia por pace: déficit fixo de 10% do TDEE, independente da velocidade escolhida — a literatura sobre recomposição simultânea não sustenta um "recomp acelerado" mais agressivo (ver `goals_and_adjustments.md` §2.1).

## 8. Limites mínimos

A V1 tem limites mínimos determinísticos de ingestão energética (guardrail de produto, não prescrição clínica):

| Sexo | Piso calórico |
|---|---|
| Masculino | 1500 kcal |
| Feminino | 1200 kcal |

Fonte: piso de segurança amplamente publicado contra dietas muito baixas em calorias sem supervisão médica (ver `canonical/nutrition_rules.json` `safety.minimumCaloriesBySex` para a citação completa).

Se a meta calculada ficar abaixo do mínimo:

1. aplicar clamp de segurança;
2. registrar o clamp;
3. impedir a IA de contornar o limite.

Revisão profissional de nutrição continua recomendada antes de qualquer alegação clínica/de produção — estes valores são um guardrail conservador, não uma prescrição individualizada.

## 9. Versionamento

Persistir:

- `nutritionEngineVersion`;
- `energyCalculationVersion`;
- `calculatedAt`.
