# AJ Fit Nutrition — Custos e Rate Limits da IA

## 1. Objetivo

Controlar custo por operação e impedir abuso sem degradar a experiência normal.

---

## 2. Modelos iniciais

Configuração inicial recomendada:

- geração completa: `gpt-5.6-terra`;
- operações simples: `gpt-5.6-luna`;
- fallback: modelo forte configurável.

Os modelos devem ser alteráveis por configuração remota/backend.

---

## 3. Preços de referência

Valores de referência consultados em outubro de 2026:

### GPT-5.6 Terra
- input: aproximadamente US$ 2,00 / 1M tokens;
- output: aproximadamente US$ 12,00 / 1M tokens.

### GPT-5.6 Luna
- input: aproximadamente US$ 0,20 / 1M tokens;
- output: aproximadamente US$ 1,20 / 1M tokens.

Preços são externos e podem mudar.

Nunca codificar preço como constante permanente de produto.

---

## 4. Budget por chamada

Cada tipo de operação deve possuir:

- `maxInputTokens`;
- `maxOutputTokens`;
- `maxEstimatedCostUsd`;
- `maxRetries`.

Se a operação exceder o budget previsto, interromper ou degradar de forma explícita.

---

## 5. Evitar contexto excessivo

Nunca enviar:

- catálogo inteiro;
- histórico inteiro;
- diário inteiro.

Isso reduz custo e melhora previsibilidade.

---

## 6. Rate limit por usuário

A V1 deve limitar:

- gerações completas;
- trocas de refeição;
- tentativas repetidas após falha.

Os números exatos devem ser definidos após testes de UX e custo.

---

## 7. Rate limit técnico

Também aplicar:

- limite por UID;
- limite por IP/dispositivo quando apropriado;
- proteção contra chamadas concorrentes duplicadas;
- idempotência;
- cooldown para abuso.

---

## 8. Limite de geração completa

Como a V1 não permite regeneração ilimitada da dieta, a geração completa deve acontecer apenas em fluxos permitidos pelo produto.

O backend é a autoridade.

---

## 9. Alertas de custo

Criar alertas quando:

- custo médio por geração subir;
- retries aumentarem;
- fallback forte for usado acima do esperado;
- consumo diário ultrapassar orçamento operacional.

---

## 10. Métricas mínimas

Acompanhar:

- custo por dieta válida;
- custo por troca válida;
- tokens por operação;
- custo por usuário ativo;
- custo por usuário pagante;
- custo de falhas/retries.
