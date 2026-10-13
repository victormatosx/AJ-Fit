# AJ Fit Nutrition — Integração com Treino

## 1. Princípio

Na V1, Nutrição **não personaliza o plano por dia de treino vs. descanso**.

O plano alimentar recomendado é o mesmo ao longo da semana.

---

## 2. Fonte autoritativa da frequência semanal de treino (decisão final)

Decisão confirmada por microauditoria técnica em 2026-10-08. Não é mais uma pendência.

O Nutrition Engine pode utilizar a frequência semanal de treino como parte do contexto de gasto energético, lendo-a nesta ordem:

```text
users/{uid}/workoutPrograms/{activeProgramId}.prescribedTrainingFrequency
-> prescribedStructuredDays (alias legado do mesmo campo)
-> Quiz.days (fallback, quando não houver programa ativo)
-> fallback determinístico do próprio Nutrition Engine (ver §6)
```

`prescribedTrainingFrequency` representa o número de sessões de treino **estruturadas** por semana que o programa ativo do usuário de fato prescreve. É mantido atualizado: toda mudança real de frequência passa por `adaptWorkoutProgram`, que sela uma nova instância de programa ativo com esse campo recalculado. Mudanças de "quais dias" sem mudar a frequência não tocam este campo.

`Quiz.days` só deve ser usado quando não existir programa ativo — é um snapshot histórico do onboarding, nunca reescrito depois, mas ainda assim o melhor número disponível nesse caso específico.

### 2.1 Campos proibidos como fonte de frequência

Não usar para cálculo energético:

- `requestedDays` — representa apenas o teto de disponibilidade que o usuário informou, não a frequência realmente prescrita pelo programa (pode ser maior que o que o programa de fato executa);
- `scheduleConfig.trainingDays.length` — representa posicionamento dos dias, não frequência; é `[]` no modo flexível e pode não existir se nunca houve programa;
- `Quiz.frequency` — rótulo legado do onboarding, não numérico, não autoritativo;
- `Quiz.trainingDays` — lista de dias do onboarding, histórico, não a frequência atual.

### 2.2 Treino livre (`scheduleMode: 'flexible'`)

Não existe tratamento especial. A frequência continua vindo de `prescribedTrainingFrequency`, independentemente de `trainingDays` estar vazio (o que é esperado e normal no modo flexível).

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

A atividade fora do treino vem do Perfil Nutricional, como `nonTrainingActivityLevel` — representa exclusivamente atividade **fora** do treino (rotina diária, trabalho, deslocamento).

A frequência de treino vem do domínio de Treino, conforme §2.

Esses dois dados entram separadamente no cálculo. O risco de double counting não está na origem dos dados (não há interseção de código entre `nonTrainingActivityLevel` e os campos de Treino), e sim na **fórmula**: os multiplicadores de atividade do Nutrition Engine não podem embutir implicitamente um componente de treino que já seria somado separadamente pela frequência semanal. Essa garantia é responsabilidade de quem definir a fórmula canônica em `canonical/nutrition_rules.json` — permanece pendente até essa definição final, mas a decisão de *fonte* de frequência (este documento) já está encerrada.

---

## 5. Acoplamento

Nutrição não deve depender de UI ou estado React do módulo de treino.

Nutrição **não deve chamar `loadActiveWorkoutProgram` (ou qualquer outra função de serviço de Treino) diretamente** — isso traria todo o grafo de módulos de serviço/lifecycle de Treino como dependência de Nutrição, o que é exatamente o acoplamento que este documento quer evitar.

A implementação futura deve criar um **leitor fino, próprio da Nutrição**, que resolve a fonte do §2 (programa ativo em `users/{uid}/workoutPrograms/{activeProgramId}`, com fallback para `Quiz.days`) e devolve apenas:

```ts
interface WorkoutNutritionContext {
  weeklyTrainingFrequency: number;
}
```

Esse leitor é o único ponto de contato entre Nutrição e o domínio de Treino. Nenhum outro campo do programa, do schedule ou do lifecycle deve atravessar esse contrato.

---

## 6. Falta de dado

Se não houver programa ativo, usar `Quiz.days` (§2). Se nem isso existir:

- não inventar;
- usar fallback determinístico definido pelo engine;
- na base atual, esse fallback é `weeklyTrainingFrequency: 0` (nenhum treino
  presumido quando não há evidência de programa ou `Quiz.days`);
- registrar o motivo quando relevante.

---

## 7. Evolução futura

Fora da V1, poderão ser avaliados:

- calorias diferentes em treino/descanso;
- estratégia pré/pós-treino;
- distribuição variável de carboidratos;
- integração com carga/volume.

Nada disso deve ser antecipado na lógica da V1.
