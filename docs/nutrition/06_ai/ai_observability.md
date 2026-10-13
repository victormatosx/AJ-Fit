# AJ Fit Nutrition — Observabilidade da IA

## 0. Implementação técnica inicial

`nutritionAiOperations/{generationId}-{attempt}` registra `ownerUid`, job, operação (`full_plan` ou `meal_alternative`), provider/model, versões de prompt/schema, tentativa/retry, fallback, latência, tokens retornados pela Responses API, resultado e código de falha. Não armazena prompt nem resposta bruta. Quando todos os campos reais de usage e um preço exato existem, também grava `estimatedCostUsd` e `pricingVersion`; campos desconhecidos permanecem ausentes.

`observability/metrics.ts` calcula taxa de sucesso, retry, fallback, latência, tokens, falhas por código e custos totais/médios sem transformar `null` em zero. `monitorNutritionAiOperations` avalia uma janela de uma hora a cada 15 minutos e emite logs estruturados com códigos estáveis para falha, fallback e latência anormais. Esses logs permitem criar alertas do Cloud Logging; esta fase não adiciona PagerDuty, Slack, email nem dashboard administrativo.

## 1. Objetivo

Permitir entender qualidade, falhas, latência e custo sem depender de logs manuais.

---

## 2. Log por geração

Registrar:

- generationId;
- uid ou identificador interno adequado;
- operationType;
- provider;
- model;
- promptVersion;
- schemaVersion;
- inputTokens;
- outputTokens;
- cachedInputTokens quando disponível;
- estimatedCost;
- latencyMs;
- retryCount;
- fallbackUsed;
- validationResult;
- failureReason;
- createdAt.

---

## 3. Privacidade

Não registrar em log operacional:

- prompt completo por padrão;
- respostas completas por padrão;
- dados pessoais desnecessários.

Esta implementação não cria armazenamento de payload detalhado. Investigação usa códigos, versões, attempts, latência e usage; qualquer exceção futura exigiria revisão explícita de privacidade e retenção.

---

## 4. Motivos de falha

Usar códigos estruturados.

Exemplos:

- `AI_TIMEOUT`;
- `AI_RATE_LIMIT`;
- `AI_SCHEMA_INVALID`;
- `AI_UNKNOWN_FOOD`;
- `AI_EXCLUDED_FOOD`;
- `AI_MACRO_VALIDATION_FAILED`;
- `AI_SAFETY_VALIDATION_FAILED`;
- `AI_RETRY_EXHAUSTED`;
- `AI_COST_LIMIT_EXCEEDED`.

---

## 5. Dashboards

Acompanhar pelo menos:

- taxa de sucesso;
- taxa de sucesso após correção;
- retry rate;
- fallback rate;
- latência p50/p95;
- custo médio;
- erro por modelo;
- erro por promptVersion;
- validações que mais falham.

---

## 6. Comparação entre versões

Toda alteração de:

- modelo;
- prompt;
- schema;
- seleção do catálogo;

deve ser comparável com versão anterior.

---

## 7. Qualidade

Métricas de produção não substituem evals.

Antes de mudar modelo/prompt, executar suíte fixa de casos de avaliação nutricional.

---

## 8. Alertas

Alertar sobre:

- aumento brusco de falhas;
- aumento de custo;
- latência anormal;
- uso excessivo de fallback;
- aumento de planos rejeitados pelo validator.
