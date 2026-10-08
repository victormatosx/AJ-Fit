# AJ Fit Nutrition — Métricas de IA

## 0. Status real de infraestrutura

Estas métricas dependem do pipeline de observabilidade de IA descrito em `06_ai/ai_observability.md` §0, que é infraestrutura inteiramente nova (não existe integração de IA nem logging de chamadas de IA no AJ Fit hoje).

## 1. Objetivo

Medir qualidade, confiabilidade, latência e custo da camada de IA.

## 2. Taxa de geração válida

Métrica principal:

`validGenerationRate`

```text
planos aceitos pelo validator
/
tentativas totais de geração
```

Separar:
- válido na primeira tentativa;
- válido após correção determinística;
- válido após retry;
- válido após fallback.

## 3. First-pass success

`firstPassValidationRate`

Percentual de gerações aceitas sem:
- correção;
- retry;
- fallback.

## 4. Correction rate

Percentual de planos que exigiram ajuste determinístico de quantidades.

Separar por tipo:
- kcal;
- proteína;
- carboidrato;
- gordura;
- fibra.

## 5. Retry rate

Acompanhar:
- média de retries por operação;
- percentual com 1 retry;
- percentual com 2 retries;
- retries por modelo;
- retries por promptVersion.

## 6. Fallback rate

Percentual de operações que precisaram modelo mais forte.

Se subir, investigar:
- modelo principal;
- prompt;
- catálogo;
- schema;
- casos impossíveis.

## 7. Failure rate

Códigos:
- schema invalid;
- unknown food;
- excluded food;
- macro validation failed;
- safety validation failed;
- timeout;
- provider rate limit;
- cost limit;
- retry exhausted.

## 8. Latência

Acompanhar:
- p50;
- p90;
- p95;
- p99.

Separar:
- geração completa;
- troca de refeição;
- fallback.

## 9. Tokens

Por operação:
- input tokens;
- output tokens;
- cached tokens quando disponível.

## 10. Custo

Métricas:
- custo médio por dieta válida;
- custo p95 por dieta;
- custo por troca válida;
- custo de retries;
- custo de fallback;
- custo por Nutrition WAU;
- custo por Logging WAU.

## 11. Custo desperdiçado

`wastedAiCost`

Custo de chamadas sem resultado persistível.

## 12. Qualidade de troca

Para nova opção de refeição:
- taxa de geração válida;
- taxa de aceitação;
- taxa de rejeição;
- retries;
- custo;
- latência.

## 13. Métricas por versão

Toda métrica deve ser segmentável por:
- provider;
- model;
- promptVersion;
- schemaVersion;
- engineVersion;
- foodCatalogVersion.

## 14. Alertas

Criar alertas para:
- aumento de failure rate;
- queda de first-pass success;
- aumento de retries;
- aumento de fallback;
- aumento de custo;
- aumento de latência.

## 15. Privacidade

Observabilidade de IA não deve virar repositório irrestrito de dados pessoais.

Preferir:
- IDs técnicos;
- versões;
- contagens;
- códigos de erro;
- métricas agregadas.
