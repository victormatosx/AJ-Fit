# AJ Fit Nutrition — Notificações

## 1. Objetivo

Nutrição terá notificações próprias na V1.

Elas devem usar a infraestrutura de notificações já existente do AJ Fit — concretamente, estender os contratos reais de `functions/src/notifications/schema.ts`:

- `NOTIFICATION_TYPES`: adicionar os novos tipos de Nutrição (plano pronto, lembrete de registro, resumo semanal, recomendação de nova geração) a essa união existente, não criar uma enum paralela;
- `NOTIFICATION_CATEGORIES`: Nutrição precisa de uma categoria própria nessa lista (hoje: `WORKOUTS_AND_REMINDERS`, `EVOLUTION_AND_ACHIEVEMENTS`, `PROGRESS`, `OPERATIONAL`);
- preferências do usuário: estender `NOTIFICATION_PREFERENCE_KEYS` (`src/types/notificationPreferences.ts`) com a chave de Nutrição, mantendo compatibilidade com o contrato existente e com `notificationPreferencesValid` em `firestore.rules`;
- disparo segue o mesmo fluxo de dispatch/delivery já existente (`notificationDispatches`, `deliveries`), não um pipeline de envio próprio.

Não criar sistema paralelo.

---

## 2. Tipos da V1

### Plano pronto

Quando uma geração assíncrona terminar com sucesso.

Exemplo conceitual:

`Sua dieta está pronta.`

A notificação deve abrir o plano gerado.

---

### Lembrete de registrar refeição

Lembrar o usuário de registrar o que consumiu.

Na V1, não haverá horários específicos por refeição configurados pelo usuário.

A estratégia exata de cadência deve ser definida sem inventar horários alimentares.

---

### Resumo semanal

Notificação de resumo semanal com CTA para `WeeklyNutrition`.

Pode destacar:

- consistência de registro;
- médias de macros;
- tendência de peso.

Evitar linguagem punitiva.

---

### Recomendação de novo plano

Pode ser enviada quando ocorrer mudança relevante que torne recomendável gerar nova dieta.

Exemplos:

- mudança importante de peso;
- mudança de Perfil Nutricional;
- nova exclusão que conflita com o plano ativo.

Não gerar plano automaticamente.

---

## 3. Preferências

As notificações de Nutrição devem respeitar o sistema global de preferências do AJ Fit.

Ampliar `NOTIFICATION_PREFERENCE_KEYS` em `src/types/notificationPreferences.ts` com uma chave própria de Nutrição, mantendo compatibilidade com o contrato existente (inclusive o teste de contrato em `src/lib/__tests__/firestoreRulesContract.test.ts`, que verifica paridade entre essa constante e as Rules).

---

## 4. Deep links

Cada notificação deve abrir contexto específico:

- plano pronto -> plano;
- resumo semanal -> WeeklyNutrition;
- recomendação de nova geração -> Perfil Nutricional/fluxo de geração;
- lembrete de registro -> diário/refeição apropriada.

---

## 5. Backend

Notificações dependentes de eventos autoritativos devem ser disparadas pelo backend.

Exemplo:

`generationJob completed -> notification`

---

## 6. Rate limiting

Evitar excesso de notificações.

Aplicar:

- deduplicação;
- cooldown;
- preferência do usuário;
- limite por categoria.

---

## 7. Fora da V1

Não incluir:

- horário personalizado por refeição;
- lembretes baseados em localização;
- alertas inteligentes de treino/refeição;
- notificações clínicas.
