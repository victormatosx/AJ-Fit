# AJ Fit Nutrition — Firestore Security Rules

## 1. Princípio

Seguir a política atual do AJ Fit:

- owner-only em dados privados;
- conta precisa permanecer ativa;
- backend controla dados autoritativos;
- deny-by-default;
- shapes fechados;
- cliente não ganha permissão só porque conhece um ID.

---

## 2. nutritionProfile

Path:

```text
users/{uid}/nutritionProfile/current
```

Permitir ao owner:

- read;
- create;
- update.

Negar delete na V1, salvo decisão futura.

Validar:

- chaves permitidas;
- tipos;
- enum values;
- 2–6 refeições;
- arrays com limites máximos;
- timestamps server-side quando aplicável.

---

## 3. nutritionPlans

Path:

```text
users/{uid}/nutritionPlans/{planId}
```

Cliente:

- read: owner;
- create/update/delete: false.

Somente Admin SDK/backend escreve.

Motivo: plano contém resultado validado, versões, snapshots e status autoritativo.

---

## 4. nutritionDailyLogs

Path:

```text
users/{uid}/nutritionDailyLogs/{localDate}
```

Owner pode:

- read;
- create;
- update.

Delete pode ser permitido se produto exigir correção completa do dia; caso contrário, preferir limpar conteúdo via update validado.

Validar:

- doc ID no formato de data;
- `localDate` coerente com doc ID;
- limites de refeições e itens;
- quantidades positivas e máximos razoáveis;
- shape fechado;
- owner implícito pelo path.

---

## 5. nutritionRecipes

Owner CRUD permitido com validação estrita.

Limitar:

- tamanho do nome;
- descrição;
- número de ingredientes;
- gramas por ingrediente;
- tipos e chaves.

---

## 6. nutritionFoods privados

Owner CRUD permitido para alimentos próprios.

Validar ranges nutricionais e campos permitidos.

Esses dados nunca recebem automaticamente `approved`.

---

## 7. nutritionPreferences

Owner pode ler.

Escrita pode ser:

- cliente, para favoritos explícitos;
- backend, para preferências aprendidas.

Se ambos escreverem, separar campos ou subdocumentos para evitar cliente falsificar memória inferida.

---

## 8. generationJobs

Owner pode ler o próprio job.

Cliente não pode criar, atualizar ou apagar.

Backend cria e atualiza.

---

## 9. catálogo global

```text
nutritionFoods/{foodId}
```

Cliente autenticado e com conta ativa pode ler.

Cliente nunca escreve.

Admin SDK/tooling é o único writer.

---

## 10. AI operations e rate limits

```text
nutritionAiOperations/*
nutritionRateLimits/*
```

Cliente:

`allow read, write: if false`

---

## 11. Account deletion

Todas as novas Rules privadas sob `users/{uid}` devem reutilizar o mesmo gate de conta ativa já existente no AJ Fit.

A feature também deve entrar no workflow de exclusão de conta para purge completo.

---

## 12. Tests

Criar Rules tests para:

- owner access;
- cross-user denial;
- deleted-account denial;
- invalid enum;
- oversized arrays;
- client write em plan;
- client write em generationJob;
- global catalog read;
- global catalog write denial;
- AI telemetry total denial.
