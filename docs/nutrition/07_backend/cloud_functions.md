# AJ Fit Nutrition — Cloud Functions

## 1. Princípio

Operações que alteram estado autoritativo, chamam IA, validam segurança ou coordenam múltiplos documentos devem passar pelo backend.

Seguir o padrão já usado pelo AJ Fit em fluxos autoritativos.

---

## 2. Callables principais

### requestNutritionPlanGeneration

Responsável por:

1. autenticar usuário;
2. validar conta ativa;
3. impedir geração concorrente;
4. carregar perfil e fontes autoritativas;
5. criar `generationJob`;
6. iniciar orquestração;
7. retornar `generationId`.

Não retorna um plano não validado.

### regenerateNutritionMeal

Responsável por gerar nova opção completa de uma refeição.

### activateNutritionPlan

Ativa/restaura um plano por transação.

### updateNutritionPlanMealOption

Confirma substituição validada de uma opção de refeição.

---

## 3. Serviços internos

Não exportar tudo como endpoint.

Separar internamente:

```text
nutrition/
  engine/
  catalog/
  ai/
  validation/
  generation/
  plans/
  dailyLogs/
  recipes/
  observability/
```

Funções internas:

- buildNutritionEngineInput;
- calculateNutritionTargets;
- selectAllowedFoodCandidates;
- generateMealPlanWithAI;
- validateGeneratedPlan;
- correctGeneratedQuantities;
- persistNutritionPlanTransactionally;
- recordAiOperation.

---

## 4. Geração assíncrona

A geração completa deve usar modelo de job persistido.

Motivos:

- chamadas de IA podem demorar;
- retries não precisam manter request mobile aberta;
- app pode sobreviver a background/restart;
- permite status explícito;
- reduz risco de duplicidade;
- facilita observabilidade.

O callable inicial cria/agenda o trabalho e retorna rapidamente.

---

## 5. Concorrência

Só uma geração completa ativa por usuário.

Usar lock transacional/documento de job autoritativo.

Double tap ou retry de rede deve convergir para a mesma operação quando possuir a mesma chave de idempotência.

---

## 6. Idempotência

Toda operação sensível deve possuir identificador estável:

- `generationId`;
- `operationId`;
- `requestId` quando necessário.

Persistência final deve verificar se a operação já foi concluída antes de criar outro plano.

---

## 7. Transações

Usar transações para:

- arquivar plano anterior + ativar novo;
- restaurar plano antigo;
- garantir single-active-plan;
- adquirir/release lock de geração;
- atualizar job + referência de resultado quando necessário.

---

## 8. Diário alimentar

O registro cotidiano pode ser escrito diretamente pelo cliente sob Rules estritas.

Não transformar cada adição de alimento em Cloud Function sem necessidade.

Isso reduz latência, custo e complexidade.

Qualquer métrica autoritativa derivada usada para decisões futuras pode ser recomputada pelo backend.

---

## 9. Receitas e alimentos próprios

CRUD cotidiano pode ser cliente -> Firestore, protegido por Rules.

Operações que alimentarem cálculos autoritativos devem validar novamente os dados.

---

## 10. Erros

Callables expõem apenas códigos seguros e estáveis.

Nunca retornar:

- prompt;
- stack trace;
- chave;
- resposta bruta do provedor;
- dados internos de outro usuário.
