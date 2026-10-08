# AJ Fit Nutrition — Arquitetura de IA

## 0. Status real de infraestrutura — greenfield

Hoje não existe nenhuma integração com OpenAI (ou qualquer outro provider de IA generativa) no código do AJ Fit: não há dependência, client, secret configurado via `defineSecret`, nem camada de abstração de provider reutilizável. Tudo neste capítulo — `NutritionAIProvider`, orquestração, configuração de modelo versionada — é infraestrutura **inteiramente nova** a ser construída para Nutrição, não uma extensão de algo existente.

Isso não muda a decisão já tomada: **OpenAI continua sendo o provider inicial** para a V1 (ADR-001 §5). A ressalva é apenas sobre o que já existe no código vs. o que precisa ser construído do zero — incluindo o secret da API key, que deve seguir o padrão real do projeto (`defineSecret`, como em `functions/src/billing/revenuecat.ts`), não uma env var solta.

## 1. Objetivo

Definir como a IA entra na arquitetura de Nutrição do AJ Fit sem se tornar autoridade sobre cálculos, segurança ou dados nutricionais.

A IA é uma camada de geração e personalização. As regras nutricionais permanecem no Nutrition Engine e no Food Catalog.

---

## 2. Provedor

A V1 utilizará **OpenAI** como provedor principal.

A integração deve ser feita atrás de uma interface abstrata para permitir troca futura de provedor sem reescrever o domínio de nutrição.

Exemplo conceitual:

```ts
interface NutritionAIProvider {
  generateMealPlan(input: GenerateMealPlanInput): Promise<GeneratedMealPlan>;
  generateMealAlternative(input: GenerateMealAlternativeInput): Promise<GeneratedMealAlternative>;
}
```

O domínio não deve importar SDK da OpenAI diretamente.

---

## 3. Modelos

Estratégia inicial:

- geração completa da dieta: modelo intermediário com bom equilíbrio entre qualidade e custo;
- tarefas simples, como nova opção de refeição: modelo econômico;
- fallback: modelo mais forte em falhas específicas.

Configuração inicial recomendada, sujeita a benchmark interno:

- geração completa: `gpt-5.6-terra`;
- alternativas simples: `gpt-5.6-luna`;
- fallback: modelo mais forte configurado por backend.

Os nomes dos modelos não devem ficar espalhados no código. Devem vir de configuração versionada.

---

## 4. API

Usar a OpenAI API pelo backend.

Nunca expor chave de API no app mobile.

Fluxo:

`Mobile -> AJ Fit Backend -> Nutrition AI Orchestrator -> OpenAI API`

---

## 5. Resposta estruturada

Toda geração deve usar Structured Outputs / JSON Schema.

O backend deve validar a resposta contra schema tipado antes de continuar.

Texto livre não é contrato válido para geração de dieta.

---

## 6. Pipeline principal

`Nutrition Profile`
`-> Nutrition Engine`
`-> seleção de subconjunto do Food Catalog`
`-> AI Orchestrator`
`-> modelo`
`-> schema validation`
`-> deterministic nutrition validation`
`-> corrections`
`-> persistence`

---

## 7. Seleção de catálogo

Nunca enviar o catálogo inteiro para a IA.

A V1 seleciona um subconjunto com base em:

- categorias necessárias;
- padrão alimentar;
- exclusões;
- preferências;
- alimentos habituais;
- status `approved`.

A seleção inicial será determinística, sem busca semântica obrigatória.

---

## 8. Falhas

Máximo de 2 retries por operação de geração.

Se falhar após retries e fallback permitido:

- não persistir plano inválido;
- retornar erro tratável ao app;
- permitir nova tentativa pelo usuário.

Não utilizar plano genérico pré-montado silenciosamente.

---

## 9. Invisibilidade do modelo

A IA fica nos bastidores.

A UX usa ações como:

- Criar minha dieta;
- Gerar nova opção;
- Trocar refeição.

O usuário não escolhe modelo nem precisa conhecer o provedor.
