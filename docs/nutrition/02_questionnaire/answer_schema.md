# AJ Fit Nutrition — Schema de Respostas do Perfil Nutricional

## 1. Objetivo

Este documento descreve o modelo conceitual das respostas do Perfil Nutricional.

Ele NÃO define ainda o schema final do Firestore. O modelo persistido definitivo será documentado em `07_backend/firestore_schema.md`.

As convenções de nomes, enums e internacionalização devem seguir o padrão já adotado pelo AJ Fit. Não criar convenções paralelas apenas para nutrição.

---

## 2. Separação entre dados herdados e respostas nutricionais

O sistema deve distinguir:

### Dados herdados

Mantidos pelas fontes autoritativas já existentes no AJ Fit:

- sexo;
- data de nascimento / idade;
- peso atual;
- altura;
- objetivo;
- gestação, quando já disponível.

### Perfil nutricional

Dados específicos da funcionalidade de nutrição:

- refeições habituais;
- velocidade de evolução;
- peso desejado opcional;
- nível de atividade fora dos treinos;
- padrão alimentar;
- alimentos preferidos;
- alimentos habituais;
- alimentos excluídos;
- lactação, quando necessário;
- suplementos;
- preferência por repetição/variedade;
- versão do questionário.

---

## 3. Modelo conceitual

Exemplo ilustrativo, não definitivo:

```ts
interface NutritionProfileAnswers {
  questionnaireVersion: number;

  mealSlots: MealSlot[];
  progressionPace?: ProgressionPace;
  targetWeightKg?: number | null;
  nonTrainingActivityLevel: NonTrainingActivityLevel;

  dietaryPattern: DietaryPattern;

  preferredFoodIds: string[];
  usualFoodIds: string[];
  excludedFoodIds: string[];

  // Estado atual, não resposta herdada — ver §7 e `07_backend/firestore_schema.md` §3.1.
  pregnant: boolean;
  breastfeeding: boolean;

  supplements: NutritionSupplementId[];

  varietyPreference: VarietyPreference;

  // Opcional na estrutura do schema, mas OBRIGATÓRIO quando o objetivo
  // geral do AJ Fit é um dos 5 valores sem mapeamento direto (`strength`,
  // `conditioning`, `perf`, `return_to_training`, `recon` —
  // `canonical/nutrition_rules.json` `goals.normalization.ambiguous.values`).
  // Não cria um objetivo geral independente: resolve apenas a direção
  // energética que o Nutrition Engine precisa quando o objetivo geral, por
  // si só, não é suficiente. Ver `03_nutrition_engine/goals_and_adjustments.md`
  // §1.2/§1.3 e `02_questionnaire/nutrition_questionnaire.md` §3.2.1.
  nutritionGoalCategory?: NutritionGoalCategory;

  completedAt?: TimestampLike;
  updatedAt?: TimestampLike;
}
```

O nome final dos campos deve seguir o padrão real do projeto.

---

## 4. Tipos conceituais

### 4.1 MealSlot

Valores conceituais:

- breakfast;
- morning_snack;
- lunch;
- afternoon_snack;
- dinner;
- supper.

Regras:

- mínimo 2 itens;
- máximo 6 itens;
- sem duplicatas;
- a ordem deve refletir a ordem alimentar natural exibida ao usuário.

---

### 4.2 ProgressionPace

Valores:

- gradual;
- moderate;
- accelerated.

A nomenclatura final armazenada deve obedecer ao padrão do app.

Esse valor é input do Nutrition Engine, não uma instrução direta ao LLM.

---

### 4.3 NonTrainingActivityLevel

Valores conceituais:

- sedentary;
- low_active;
- active;
- very_active.

Esse valor representa a rotina fora das sessões de treino.

O mapeamento para fatores utilizados no cálculo energético pertence ao Nutrition Engine, não ao questionário.

### 4.4 DietaryPattern

Valores:

- omnivore;
- vegetarian;
- vegan;
- pescatarian.

Deve existir um único padrão ativo por perfil.

---

### 4.5 VarietyPreference

Fonte final: `canonical/questionnaire.json` (pergunta `varietyPreference`). Valores:

- repeatable;
- variety;
- indifferent.

---

### 4.6 Food IDs

Os arrays de alimentos devem armazenar identificadores canônicos do catálogo nutricional, não nomes traduzidos.

Exemplo conceitual:

```ts
preferredFoodIds: ["banana-prata", "frango-peito"]
```

O label apresentado deve vir do catálogo/i18n.

Não persistir apenas texto livre como representação principal de um alimento selecionado.

---

## 5. Preferências vs. exclusões

### preferredFoodIds

Preferência positiva.

O sistema pode priorizar esses alimentos, mas não é obrigado a utilizá-los.

### usualFoodIds

Alimentos que o usuário já consome habitualmente.

Também são preferências positivas e podem ser priorizados.

### excludedFoodIds

Regra rígida.

Qualquer alimento listado deve ser excluído de toda geração, substituição e regeneração.

Na V1, o schema não precisa armazenar o motivo da exclusão. O perfil agora também aceita `excludedAllergens?: NutritionFoodAllergen[]`, lista estruturada de alergênicos conhecidos a bloquear na geração. Ela é opcional para perfis legados; desconhecimento não equivale a declaração de segurança, e o catálogo com `allergens: null` permanece fora da geração.

O comportamento é o mesmo para:

- não gosto;
- não posso consumir;
- intolerância declarada;
- alergia declarada por meio da experiência disponível.

Se futuramente o produto precisar diferenciar razões clínicas e preferências, o schema deverá evoluir de forma versionada.

---

## 6. Suplementos

Fonte final (decisão, substitui modelo anterior deste documento): `canonical/questionnaire.json` (pergunta `supplements`) e `07_backend/firestore_schema.md` §3 concordam em modelar suplementos como **lista simples de ids selecionados**, não como lista de objetos `{ supplementType, usesOrAccepts }`. Um id presente no array significa "usa ou aceita usar"; não há booleano separado.

```ts
supplements: NutritionSupplementId[];
```

Valores de `NutritionSupplementId`:

- whey_or_protein;
- creatine;
- caffeine_or_preworkout;
- multivitamin;
- omega_3;
- other.

Na V1:

- apenas `whey_or_protein` pode participar diretamente dos alimentos/macros da dieta;
- os demais são dados de perfil;
- o questionário não coleta marca ou sabor.

A lista final de `SupplementType` deve ser definida pelo produto/catálogo antes de implementação.

---

## 7. Dados herdados usados no snapshot de geração

Embora não pertençam às respostas editáveis do perfil nutricional, cada geração de dieta deve materializar um snapshot contendo os dados herdados utilizados.

Modelo conceitual:

```ts
interface NutritionGenerationProfileSnapshot {
  questionnaireVersion: number;

  // Decisão final: NÃO inclui pregnancyStatus. Gravidez/lactação são estado
  // atual de `nutritionAnswers` (NutritionProfile.pregnant/.breastfeeding),
  // nunca um campo herdado de fonte externa — ver §7 e
  // `07_backend/firestore_schema.md` §3.1.
  inherited: {
    sex: unknown;
    birthDateOrAge: unknown;
    currentWeightKg: number;
    heightCm: number;
    goal: unknown;
  };

  nutritionAnswers: NutritionProfileAnswers;

  capturedAt: TimestampLike;
}
```

`unknown` acima significa: reutilizar exatamente o tipo/enumerador já definido pelo domínio existente do AJ Fit, não criar outro apenas para nutrição.

---

## 8. Snapshot imutável

Ao gerar um plano:

1. ler dados atuais das fontes autoritativas;
2. ler o Perfil Nutricional atual;
3. validar elegibilidade;
4. criar snapshot;
5. usar esse snapshot como input da geração;
6. persistir referência/cópia imutável junto ao plano.

Depois da geração, alterações futuras no usuário não podem modificar esse snapshot histórico.

Isso permite responder futuramente:

- qual peso foi usado para essa dieta?;
- qual objetivo estava ativo?;
- quais alimentos estavam excluídos?;
- qual versão do questionário gerou o plano?;
- qual padrão alimentar estava selecionado?.

---

## 9. Validações do schema

Antes de considerar o perfil completo:

### Refeições

- entre 2 e 6;
- somente valores reconhecidos;
- nenhuma duplicata.

### Peso desejado

- opcional;
- valor numérico válido quando informado;
- limites clínicos/operacionais serão responsabilidade do Nutrition Engine/Safety, não deste documento.

### Velocidade

- valor reconhecido quando requerido pelo objetivo.

### Objetivo nutricional complementar (`nutritionGoalCategory`)

- ausente é válido quando o objetivo geral tem mapeamento direto (`canonical/nutrition_rules.json` `goals.normalization.mapping`);
- obrigatório quando o objetivo geral está em `goals.normalization.ambiguous.values` — perfil não pode ser considerado completo sem essa resposta nesse caso;
- quando presente, deve ser exatamente um dos 4 valores de `canonical/nutrition_rules.json` `goals.allowed`;
- nunca inferir/preencher automaticamente — ausência quando exigida bloqueia geração, não é substituída por um padrão.

### Padrão alimentar

- exatamente um valor válido.

### Foods

- IDs devem existir no catálogo canônico ou seguir política de resolução definida pelo `04_food_catalog`;
- `excludedFoodIds` deve prevalecer sobre `preferredFoodIds` e `usualFoodIds` em caso de conflito;
- o mesmo ID não deve produzir comportamento ambíguo.

Regra de precedência:

```text
excluded > preferred/usual
```

Se um alimento estiver simultaneamente em preferência e exclusão, a exclusão vence e o dado inconsistente deve ser normalizado.

### Gestação/lactação

- se o usuário estiver em condição não elegível, bloquear geração antes da chamada de IA.

---

## 10. Estado de completude

O perfil pode possuir estados conceituais como:

- not_started;
- in_progress;
- complete;
- requires_update.

A nomenclatura definitiva será definida no backend/frontend.

`requires_update` deve ser usado quando uma nova versão do questionário introduzir uma resposta essencial ausente para uma nova ação do usuário.

---

## 11. Campos que NÃO devem existir no schema V1

Não incluir sem nova decisão de produto:

- mealTimes;
- trainingTime;
- activityLevel;
- dailySteps;
- foodBudget;
- cookingTime;
- cookingSkill;
- eatsOutFrequency;
- mealPrepBehavior;
- hungerPattern;
- waterIntake;
- alcoholIntake;
- caffeineIntake;
- sugaryDrinkIntake;
- freeTextNotes;
- eatingDisorderHistory;
- detailedMedicalConditions;
- recipePreferences;
- shoppingListPreferences.

---

## 12. Internacionalização

A V1 deve suportar:

- pt-BR;
- en;
- es.

Valores persistidos não devem depender do texto exibido na interface.

Exemplo conceitual correto:

```text
stored: pescatarian
pt-BR: Pescetariano
en: Pescatarian
es: Pescetariano
```

Contudo, a implementação deve reutilizar a estratégia já utilizada pelo AJ Fit para enums e i18n. Caso o projeto atual utilize outra convenção equivalente, ela deve prevalecer.

---

## 13. Versionamento

Campo obrigatório conceitual:

```text
questionnaireVersion
```

Versão inicial:

```text
1
```

Mudanças que alterem significado, obrigatoriedade ou estrutura de respostas devem avaliar incremento de versão.

Snapshots antigos nunca devem ser reinterpretados como se tivessem sido respondidos em uma versão posterior.
