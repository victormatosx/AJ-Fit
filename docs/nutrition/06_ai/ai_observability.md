# AJ Fit Nutrition — Observabilidade da IA

## 0. Status real de infraestrutura — greenfield

Hoje não existe nenhuma integração com IA generativa (OpenAI ou qualquer outro provider) no AJ Fit, nem pipeline de logging/observabilidade de chamadas de IA. Tudo descrito neste documento — coleta de `generationId`/tokens/custo/latência, dashboards, alertas — é infraestrutura **inteiramente nova**, não uma extensão de algo já existente. Da mesma forma, não há provider de analytics de produto integrado (ver `11_analytics/events.md` §0); as métricas de `11_analytics/ai_metrics.md` derivadas deste log também dependem dessa infraestrutura nova.

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

Quando payload detalhado for necessário para debugging, usar armazenamento controlado, redigido e com retenção definida.

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
