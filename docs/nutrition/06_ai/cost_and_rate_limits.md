# AJ Fit Nutrition — Custos e Rate Limits da IA

## 1. Objetivo

Controlar custo por operação e impedir abuso sem degradar a experiência normal.

---

## 2. Modelos iniciais

Configuração backend atual (`functions/src/nutrition/ai/config.ts`): `gpt-6.1-sol` para plano, `gpt-6-luna` para alternativa, `gpt-6-astra` no último dos três attempts apenas para falha repetida de schema/macros. Ver [modelos oficiais](https://developers.openai.com/api/docs/models). O código limita a saída a 4500 tokens por chamada.

`observability/modelPricing.ts` centraliza a tabela versionada `openai-standard-2026-10-08`, obtida em 2026-10-08 da [documentação oficial de preços](https://developers.openai.com/api/docs/pricing):

- `gpt-6.1-sol`: US$ 2,00 input, US$ 0,10 cached input e US$ 10,00 output por 1M tokens;
- `gpt-6-luna`: US$ 0,10 input, US$ 0,01 cached input e US$ 0,50 output por 1M tokens;
- `gpt-6-astra`: US$ 10,00 input, US$ 1,00 cached input e US$ 50,00 output por 1M tokens.

Modelo desconhecido ou usage parcial produz custo desconhecido. A estimativa não representa cobrança oficial.

Os modelos devem ser alteráveis por configuração remota/backend.

---

## 3. Preços de referência

As referências antigas abaixo permanecem como histórico de planejamento; não descrevem os modelos utilizados pelo backend.

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

V1 implementada: `nutritionRateLimits/{uid}` limita novas solicitações de plano completo a uma a cada 15 minutos. Alternativas têm cooldown de 20 segundos, limite de 12 solicitações por hora, lease de 3 minutos e `requestId` UUID idempotente. Double tap/replay converge ao mesmo documento; retries internos de provider não contam como nova solicitação do usuário. Os campos dos dois limites coexistem no mesmo documento e writes usam merge para que um fluxo não apague o limite do outro.

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
