# AJ Fit Nutrition — Firestore Indexes

## 1. Princípio

Não criar índices antecipadamente sem query real.

A maioria dos acessos da V1 é por path direto e não precisa de índice composto.

---

## 2. Queries previstas

### Planos

```text
users/{uid}/nutritionPlans
where status == active
```

Idealmente o backend pode manter referência direta do plano ativo em um pequeno documento de estado, evitando query recorrente.

Se houver listagem histórica:

```text
orderBy createdAt desc
```

Índice simples automático é suficiente na maioria dos casos.

### Jobs

```text
users/{uid}/nutritionGenerationJobs
orderBy requestedAt desc
```

### Receitas

```text
users/{uid}/nutritionRecipes
orderBy updatedAt desc
```

### Catálogo

Busca por texto não deve depender de queries ingênuas de prefixo em Firestore para catálogo grande.

Na V1, usar:

- campos normalizados;
- aliases;
- estratégia de busca própria/local/indexada.

Se o catálogo crescer a ponto de busca virar gargalo, migrar a busca para engine dedicado sem mover a fonte de verdade.

---

## 3. Backend worker

Se jobs forem processados por query global/collection-group, índices compostos podem ser necessários, por exemplo:

```text
status ASC + requestedAt ASC
```

Só adicionar quando o worker final definir a query.

---

## 4. Índices desnecessários

Evitar indexar campos grandes que nunca serão filtrados/ordenados:

- snapshots;
- meals;
- allowedFoods;
- validationTrace;
- prompt context.

Usar field overrides quando fizer sentido para reduzir storage/index write amplification.

---

## 5. TTL

Logs operacionais e locks temporários podem usar TTL.

Candidatos:

- AI operation payloads temporários;
- idempotency receipts;
- rate-limit windows;
- generation locks concluídos.

Não aplicar TTL a:

- planos;
- diário;
- receitas;
- perfil.
