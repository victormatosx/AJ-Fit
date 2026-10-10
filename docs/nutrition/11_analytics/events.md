# AJ Fit Nutrition — Eventos de produto

## Implementação (Fases 27–30)

O AJ Fit continua sem provider externo de analytics. O contrato puro em
`src/nutrition/analytics/contract.ts` valida nome, autoridade e propriedades;
`src/nutrition/analytics/index.ts` é o adaptador de cliente e
`functions/src/nutrition/analytics.ts` é o adaptador autoritativo do backend.
Ambos operam como no-op validado enquanto nenhum provider for escolhido.

Eventos de cliente:

- `nutrition_opened`;
- `nutrition_profile_started` / `nutrition_profile_completed`;
- `nutrition_generation_requested`;
- `nutrition_plan_viewed` / `nutrition_plan_restored`;
- `nutrition_diary_day_viewed` / `nutrition_diary_item_added`;
- `nutrition_meal_alternative_requested`;
- `nutrition_favorite_added`;
- `nutrition_weekly_summary_viewed`.

Eventos autoritativos do backend:

- `nutrition_generation_completed` / `nutrition_generation_failed`;
- `nutrition_meal_alternative_completed` / `nutrition_meal_alternative_failed`.

Conclusão e falha de IA não são emitidas pelo cliente. O contrato rejeita
eventos backend no adaptador client e vice-versa.

## Propriedades permitidas

Somente enums, booleanos e buckets técnicos curtos: tela de origem, modo da
operação, meal slot, tipo da adição ao diário, categoria estruturada de
feedback, bucket de duração/retry/quantidade, fallback, status/código estável
e presença de tendência de peso.

## Dados proibidos

O contrato não aceita propriedades fora da allowlist. Em particular, nunca
enviar peso, altura, nascimento, gravidez/lactação, alergias, IDs ou nomes de
alimentos, exclusões, conteúdo do diário, calorias/macros, texto de feedback,
prompt, resposta bruta ou conteúdo do plano.

## Provider futuro

A escolha de Firebase Analytics, Amplitude, Mixpanel, PostHog ou outro SaaS é
uma decisão separada. A integração futura deve implementar os dois adapters
existentes sem ampliar a allowlist silenciosamente.
