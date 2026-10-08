# AJ Fit Nutrition — Integração com Treino

## 1. Princípio

Na V1, Nutrição **não personaliza o plano por dia de treino vs. descanso**.

O plano alimentar recomendado é o mesmo ao longo da semana.

---

## 2. O que Nutrição pode usar do domínio de Treino

O Nutrition Engine pode utilizar a frequência semanal de treino como parte do contexto de gasto energético.

Essa informação deve vir da fonte autoritativa já existente do domínio de treino.

Não perguntar novamente ao usuário algo que o AJ Fit já conhece.

---

## 3. O que Nutrição não usa na V1

Não utilizar para geração:

- treino do dia;
- horário do treino;
- volume da sessão;
- intensidade da sessão;
- exercícios;
- grupos musculares;
- duração real do treino;
- diferenciação pré/pós-treino.

---

## 4. Regra contra double counting

Ao estimar gasto energético, o engine deve evitar contar duas vezes:

- atividade cotidiana fora do treino;
- componente de treino.

A atividade fora do treino vem do Perfil Nutricional.

A frequência de treino vem do domínio de Treino.

A fórmula exata deve ser definida nas regras canônicas do Nutrition Engine.

---

## 5. Acoplamento

Nutrição não deve depender de UI ou estado React do módulo de treino.

A integração deve ocorrer via contrato/domínio compartilhado.

Exemplo conceitual:

```ts
interface WorkoutNutritionContext {
  weeklyTrainingFrequency: number;
}
```

---

## 6. Falta de dado

Se a frequência de treino não estiver disponível:

- não inventar;
- usar fallback determinístico definido pelo engine;
- registrar o motivo quando relevante.

---

## 7. Evolução futura

Fora da V1, poderão ser avaliados:

- calorias diferentes em treino/descanso;
- estratégia pré/pós-treino;
- distribuição variável de carboidratos;
- integração com carga/volume.

Nada disso deve ser antecipado na lógica da V1.
