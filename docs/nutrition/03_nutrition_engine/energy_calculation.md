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

O mapeamento numérico final entre atividade, treino e gasto total deve existir em configuração canônica versionada e ser validado antes da produção.

## 5. TDEE

Fluxo conceitual:

`RMR -> atividade cotidiana -> componente de treino quando aplicável -> TDEE estimado`

O valor final deve ser determinístico e auditável.

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

Os percentuais exatos devem ficar em `canonical/nutrition_rules.json`, não espalhados em frontend, prompt ou Function.

## 8. Limites mínimos

A V1 terá limites mínimos determinísticos de ingestão energética.

Os limites podem diferir por sexo.

Se a meta calculada ficar abaixo do mínimo:

1. aplicar clamp de segurança;
2. registrar o clamp;
3. impedir a IA de contornar o limite.

Os valores numéricos finais devem ser validados por profissional de nutrição antes da produção.

## 9. Versionamento

Persistir:

- `nutritionEngineVersion`;
- `energyCalculationVersion`;
- `calculatedAt`.
