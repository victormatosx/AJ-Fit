# AJ Fit Nutrition — Estratégia de Testes

Matriz consolidada da Fase 31: [`e2e_test_matrix.md`](./e2e_test_matrix.md).

Implementação backend V1: `functions/src/nutrition/__tests__/generation.test.ts` usa provider/fetch fake para schema, candidate selection, macro validator, correção e retries. `jobs.integration.test.ts` executa apenas com `FIRESTORE_EMULATOR_HOST`; verifica double tap, job, snapshots, ativação/arquivamento, falha sem plano, safety gates e exclusão de registros globais. Nenhum teste faz chamada real à OpenAI.

## 1. Objetivo

Garantir que Nutrição seja correta, segura, determinística onde precisa ser, resiliente a falhas de IA e consistente com a arquitetura do AJ Fit.

A estratégia cobre:

- Nutrition Engine;
- Food Catalog;
- geração por IA;
- validação;
- Firestore Rules;
- Cloud Functions;
- frontend;
- fluxos end-to-end.

---

## 2. Princípios

### Determinismo

Toda regra determinística deve ter testes unitários exatos.

Exemplos:
- energia;
- macros;
- fibra;
- distribuição;
- safety gates;
- tolerâncias;
- versionamento.

### IA não é autoridade

Testes nunca devem considerar resposta do modelo válida apenas porque parece plausível.

Toda saída de IA precisa passar pelos mesmos validadores usados em produção.

### Segurança

Casos de safety devem ter regressão dedicada.

### Histórico

Planos e logs antigos não podem mudar devido a:
- alteração de peso;
- alteração de catálogo;
- novo plano;
- restauração de plano.

---

## 3. Pirâmide de testes

### Unitários

Maior volume.

Cobrir:
- cálculos;
- selectors;
- serializers;
- validators;
- transformations;
- classification;
- snapshot logic.

### Integração

Cobrir:
- Firestore Emulator;
- Cloud Functions;
- transações;
- idempotência;
- jobs;
- locks;
- Rules.

### AI evals

Suite própria e reproduzível.

### E2E

Poucos, mas críticos.

Cobrir fluxos reais do usuário.

---

## 4. Ambientes

### Unit

Sem Firebase real.

### Emulator

Usar:
- Firestore Emulator;
- Auth Emulator quando necessário;
- Functions local/emulator.

### AI

Por padrão:
- provider fake/mock para CI determinística.

Suite separada:
- chamadas reais de provider para evals periódicos.

Nunca tornar CI básica dependente de disponibilidade da OpenAI.

---

## 5. Fixtures canônicas

Criar fixtures versionadas para:

- perfis nutricionais;
- pesos;
- objetivos;
- activity levels;
- food catalog;
- restrições;
- meal slots;
- planos válidos;
- planos inválidos.

Não depender de documentos de produção.

---

## 6. Golden cases

Manter casos fixos cujos outputs esperados são conhecidos.

Se regra canônica mudar:
- alterar versão;
- atualizar expectation conscientemente;
- não simplesmente “corrigir o teste”.

---

## 7. Property-based tests

Aplicar quando útil em:

- quantidades positivas;
- limites de macros;
- tolerâncias;
- safety floors;
- soma de nutrientes;
- invariantes de snapshot.

Exemplos:
- proteína nunca negativa;
- calorias nunca abaixo do floor após safety clamp;
- carbs nunca negativos;
- plano validado nunca contém excludedFoodId.

---

## 8. Regressão

Toda correção de bug relevante deve criar teste de regressão.

Especial atenção:
- duplicidade de geração;
- plano ativo duplo;
- diário alterado por regeneração;
- alergênico ignorado;
- alimento inventado pela IA;
- cálculo incorreto de macros.

---

## 9. CI

Pipeline mínimo:

1. typecheck;
2. unit tests;
3. nutrition engine tests;
4. AI validator tests com fixtures;
5. Firestore Rules tests;
6. Functions integration tests;
7. E2E críticos quando aplicável.

---

## 10. Critério para release

Não liberar Nutrição se houver falha em:

- safety;
- engine;
- Rules;
- geração/validação;
- single-active-plan;
- idempotência;
- histórico;
- E2E principal.

---

## Base de catálogo (2026-10-08)

`src/nutrition/catalog/__tests__/catalog.test.ts` cobre escala por gramas,
arredondamento ao fim da soma, fibra desconhecida, validação, normalização,
provenance, ID estável e deduplicação. Os testes de serviço validam alimentos
próprios e receitas sem macros autoritativos do cliente. O Emulator cobre
Rules, isolamento e busca paginada por nome/alias; nenhum teste usa Firestore
de produção.

## Resumo semanal (Fase 26)

`src/nutrition/weekly/__tests__/weeklySummary.test.ts` cobre semana completa e parcial, ausência de dia, zero registrado, múltiplas refeições, edição refletida nos totais, fibra desconhecida, opção recomendada, troca de plano no meio da semana, restauração e peso com zero/uma/várias medições. `src/nutrition/ui/__tests__/localDate.test.ts` fixa segunda/domingo e viradas de mês/ano com construtores de data local, sem depender de parsing UTC do ambiente de CI. O wiring da Home, query bounded, tela e CTA para Evolução tem teste estrutural separado, seguindo o padrão Node-only atual do projeto.

## Fases 27–30

- notificações: contrato/copy, preference, daily/weekly, plan-ready somente
  após plano, dedupe, timezone/janela, diário e account lock;
- analytics: nomes/autoridade, allowlist, rejeição de dado sensível e no-op;
- observabilidade: usage, pricing, custo conhecido/desconhecido,
  retry/fallback/failure e alert codes;
- Rules/Functions: cross-user, campos extras, arrays/IDs/datas/timezone,
  backend-only, replay, rate limit, restore/alternative owner-only;
- account deletion: lista integral parametrizada, isolamento entre usuários e
  testes que iniciam deletion durante plano/alternativa e provam ausência de
  persistência tardia.
