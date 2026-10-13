# AJ Fit Nutrition — Versionamento e Histórico de Planos

## 1. Regra principal

Só pode existir um plano ativo por usuário na V1.

Planos anteriores permanecem arquivados.

---

## 2. Nova geração

Quando um novo plano é confirmado:

1. o plano atual vira `archived`;
2. o novo plano vira `active`;
3. o histórico é preservado;
4. o diário alimentar permanece intacto.

---

## 3. Restauração

O usuário pode restaurar um plano anterior.

Fluxo:

1. selecionar plano arquivado;
2. revisar informações;
3. confirmar restauração;
4. arquivar o plano atual;
5. ativar o plano escolhido.

---

## 4. Snapshot

Cada plano guarda snapshot dos dados usados na geração.

Inclui:

- dados físicos;
- objetivo;
- Perfil Nutricional;
- metas do engine;
- alimentos e macros;
- versões relevantes.

---

## 5. Imutabilidade histórica

Uma alteração posterior em:

- peso;
- perfil;
- questionário;
- catálogo;
- engine;

não deve alterar retroativamente planos arquivados.

---

## 6. Diário independente

Logs alimentares históricos nunca mudam quando:

- plano é regenerado;
- plano é restaurado;
- alimento do catálogo é atualizado;
- recomendação é trocada.

---

## 7. Identidade

Toda geração deve possuir:

- `planId`;
- `generationId`;
- `createdAt`;
- versões do engine, catálogo e schema.

Isso permite auditoria e observabilidade.
