# AJ Fit Nutrition — Testes de Firestore Rules

## 1. Objetivo

Provar que o cliente só acessa o que deve e nunca escreve estado autoritativo.

Executar no Firestore Emulator.

---

## 2. nutritionProfile

### Permitir
- owner read;
- owner create válido;
- owner update válido.

### Negar
- cross-user read;
- cross-user write;
- conta inativa;
- enum inválido;
- chaves extras;
- mealSlots < 2;
- mealSlots > 6;
- arrays acima do limite.

---

## 3. nutritionPlans

### Permitir
- owner read.

### Negar
- client create;
- client update;
- client delete;
- cross-user read.

Backend Admin SDK não depende das Rules.

---

## 4. nutritionDailyLogs

### Permitir
- owner read;
- owner create válido;
- owner update válido.

### Negar
- cross-user;
- localDate divergente do doc ID;
- quantidade negativa;
- item inválido;
- payload exagerado;
- campo não permitido.

---

## 5. nutritionRecipes

Testar:
- CRUD owner;
- cross-user denial;
- ingrediente vazio;
- gramas <= 0;
- excesso de ingredientes;
- campos extras.

---

## 6. nutritionFoods privados

Testar:
- CRUD owner;
- cross-user denial;
- macros negativos;
- campos inválidos;
- cliente tentando marcar `approved`.

---

## 7. nutritionPreferences

Testar separação entre:
- campos explícitos do usuário;
- campos aprendidos/backend-only.

Cliente não pode falsificar memória autoritativa se essa divisão for aplicada.

---

## 8. generationJobs

### Permitir
- owner read.

### Negar
- client create;
- update;
- delete;
- cross-user read.

---

## 9. Catálogo global

### Permitir
- leitura autenticada/ativa conforme regra final.

### Negar
- qualquer escrita cliente;
- leitura quando política global negar.

---

## 10. AI operations

Negar tudo ao cliente:

```text
nutritionAiOperations/*
nutritionRateLimits/*
```

---

## 11. Account deletion

Para usuário com lock de exclusão:

negar leitura/escrita de todos os dados privados de Nutrição.

---

## 12. Regressão

Toda nova subcoleção de Nutrição deve receber teste explícito.

Não depender apenas de catch-all.
