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

### Resumo semanal do diário

```text
users/{uid}/nutritionDailyLogs
orderBy documentId
startAt YYYY-MM-DD
endAt YYYY-MM-DD
```

Os IDs já são datas locais canônicas e ordenáveis. A query lê no máximo os sete documentos da semana e não exige índice composto.

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

Implementação da base: `searchPrefixes` contém prefixos normalizados do nome
e de aliases (mínimo 2, máximo 32 caracteres). A query filtra
`generationStatus == approved`, usa `array-contains` para um prefixo,
ordena por ID e pagina com cursor. `firestore.indexes.json` contém o índice
composto correspondente. Isto cobre busca PT-BR por início de nome, alias e
palavras; não oferece ranking, tolerância a erros de digitação nem busca
arbitrária no meio de palavras. O cliente lê no máximo 30 documentos por
página e nunca baixa o catálogo inteiro.

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
