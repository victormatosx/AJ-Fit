# AJ Fit Nutrition — Objetivos e Ajustes

## 1. Fonte do objetivo

A Nutrição V1 herda o objetivo geral do AJ Fit.

Não existe `nutritionGoal` independente nem uma segunda escolha de objetivo no Perfil Nutricional.

O Nutrition Engine trabalha com 4 categorias internas (`canonical/nutrition_rules.json` `goals.allowed`):

- weight_loss;
- muscle_gain;
- maintenance;
- body_recomposition.

### 1.1 Normalização determinística (decisão final)

O objetivo real do usuário vive em `PrimaryGoal | DeprecatedGoal | LegacyGoal` (`src/state/AppState.tsx`), não nessas 4 categorias. A Nutrição deriva a categoria interna a partir desse valor real por uma tabela de normalização determinística e versionada — nunca pedindo ao usuário para escolher de novo.

Mapeamento fechado (baseado no texto real de `src/i18n/resources/pt-BR/quiz.json`, auditado em 2026-10-08 — valores com o mesmo rótulo/intenção em português foram agrupados):

| Valor real (`AppState.tsx`) | Categoria interna |
|---|---|
| `gain_muscle`, `hyper` | `muscle_gain` |
| `lose_fat`, `cut` | `weight_loss` |
| `body_composition`, `def` | `body_recomposition` |
| `health` | `maintenance` |

`body_composition` e `def` têm o mesmo rótulo em português ("Melhorar definição/composição corporal" / "Definição"), por isso compartilham a mesma categoria com confiança.

### 1.2 Valores sem mapeamento direto — resolvidos por pergunta complementar (decisão final)

Cinco valores não têm mapeamento direto (`status: RESOLVED_VIA_NUTRITION_PROFILE_QUESTION` em `canonical/nutrition_rules.json` `goals.normalization.ambiguous`):

- `strength` ("Aumentar minha força");
- `conditioning` ("Melhorar meu condicionamento físico");
- `perf` ("Performance") — o próprio AJ Fit já trata como ambíguo hoje (`LEGACY_PERFORMANCE_GOAL_AMBIGUOUS` em `src/workoutPrescription/input.ts`);
- `return_to_training` ("Voltar a treinar depois de um período parado");
- `recon` ("Recondicionamento") — o próprio `LEGACY_GOAL_MAP` do app normaliza `recon` para `return_to_training`, não para `body_composition`/`def`, apesar do nome parecido.

Nenhum desses rótulos indica direção de peso ou composição corporal — mapear qualquer um deles para uma das 4 categorias seria uma suposição do produto, não uma derivação do dado real. **Nenhum default silencioso** (incluindo `maintenance`) é aceitável para esses 5 valores.

Decisão aprovada: quando o objetivo geral é um desses 5 valores, o Perfil Nutricional exige uma resposta complementar — `nutritionGoalCategory` (`canonical/questionnaire.json`, `single_select` entre os mesmos 4 valores de `goals.allowed`). Essa resposta **não cria um objetivo geral independente**; ela só resolve a direção energética que o Nutrition Engine precisa quando o objetivo geral, por si só, não é suficiente.

### 1.3 Fluxo final de resolução (conceitual — não implementado ainda)

```text
general AJ Fit goal
-> direct mapping if available (goals.normalization.mapping)
-> otherwise: nutritionGoalCategory from NutritionProfile (required in this case)
-> normalized NutritionGoalCategory
```

Em pseudocódigo:

```text
se NUTRITION_GOAL_CATEGORY_MAP[goal] != null:
  usar o valor mapeado
se NUTRITION_GOAL_CATEGORY_MAP[goal] == null:
  exigir nutritionProfile.nutritionGoalCategory
```

A função de resolução está implementada em `src/nutrition/engine/resolveGoalCategory.ts`, seguindo exatamente esta regra conceitual (mapeamento direto primeiro, `nutritionGoalCategory` como fallback obrigatório, erro de domínio explícito — nunca default silencioso — quando ausente).

A tabela completa (mapeamento direto + os 5 valores resolvidos por pergunta) está em `canonical/nutrition_rules.json` `goals.normalization`.

## 2. Déficit e superávit

Perda de peso usa déficit percentual.

Ganho de massa usa superávit percentual.

A magnitude depende da velocidade escolhida:

- gradual;
- moderate;
- accelerated.

Percentuais fechados (fonte completa em `canonical/nutrition_rules.json` `goals.deficitPercentages`/`surplusPercentages`):

| Pace | Déficit | Superávit |
|---|---|---|
| gradual | 10% | 5% |
| moderate | 15% | 10% |
| accelerated | 20% | 15% |

### 2.1 Recomposição corporal (decisão final)

`body_recomposition` não usa a tabela de pace acima. A literatura sobre perda de gordura + ganho de massa simultâneos sustenta apenas um **déficit pequeno e fixo** (déficit maior prejudica a retenção de massa magra sem acelerar proporcionalmente a perda de gordura — Longland et al. 2016; Barakat et al. 2020).

Regra fechada: déficit fixo de **10% do TDEE**, independente do pace selecionado. `progressionPace` continua sendo aceito no questionário por consistência de UX, mas não altera a magnitude para esta categoria — não existe "recomposição acelerada" sustentada pela evidência.

## 3. Peso-alvo

O peso-alvo é opcional.

Na V1 ele funciona como contexto e métrica de produto.

Ele não autoriza estratégias mais agressivas nem altera sozinho as fórmulas do engine.

## 4. Mudança de peso

A dieta ativa não é recalculada automaticamente quando o peso muda.

As metas são recalculadas apenas em uma nova geração.

## 5. Mudança de perfil

Alterações relevantes devem fazer o app recomendar nova geração.

A dieta atual nunca é alterada silenciosamente.
