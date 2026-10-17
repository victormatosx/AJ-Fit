# Refatoração do questionário — 2026-10-16

## Resultado

O questionário passa de 13 para 9 páginas (10 para objetivos que exigem categoria nutricional). Variedade é preservada. Inclusão e exclusão são as duas páginas de preferências; padrão alimentar opcional, exclusivo e desmarcável fica junto das exclusões. Componentes e tokens de tema existentes são reutilizados.

Persistência mantém os campos existentes sem migração destrutiva. Alimentos habituais históricos continuam como informação de inclusão para a IA. Por solicitação posterior do produto, foram removidos a confirmação e os bloqueios de gravidez/amamentação no cliente, backend e engine. Flags históricas são preservadas apenas para compatibilidade, sem afetar geração.

A auditoria cobriu tela, sequência/progresso, tipos, serialização, regras Firestore, carregamento do perfil/contexto, edição, geração, regeneração, alternativas e consumidores do treino. O treino não depende das flags do perfil nutricional; suas triagens próprias em Quiz foram preservadas.

Corrigidos também: updatedAt indevidamente propagado nas respostas ao editar; nomes de alimentos existentes no editor; resolução de alimentos manuais na coleção privada do usuário. Exclusões sem nome resolvido bloqueiam antes de chamar IA.

IA de dieta mantém preferências, padrão, exclusões e alergias. Flags de gravidez/amamentação são retiradas do objeto do provedor e dos contextos HTTP. Prompt 3.2.0 e schema 3.1.0 exigem ingredientes/origens. O validador compartilhado entre plano e alternativas verifica alergias, padrão, exclusões e macros. Composição desconhecida é rejeitada sob padrões restritivos. Mudança do perfil durante a chamada impede persistir resultados desatualizados.

## Validação

- Aplicativo: 146 arquivos / 2.112 testes aprovados nas suítes selecionadas de nutrição, telas, traduções, prescrição de treino e compatibilidade.
- Verificação posterior de telas/edição/tipos nutricionais: 27 arquivos / 223 testes aprovados (sobrepostos às suítes anteriores).
- Backend: suítes nutricionais aprovadas; última execução focada em geração, alternativas e alimentos: 3 arquivos / 64 testes aprovados.
- Firestore Emulator com Java 21: 3 arquivos / 6 cenários aprovados, incluindo geração, regeneração, alternativas, restauração, validações do contexto e alteração concorrente do perfil.
- TypeScript do aplicativo e Functions aprovado; ESLint dos arquivos TS/TSX modificados do aplicativo aprovado; diff e sincronização dos contratos compartilhados verificados.
- Cobertos: nenhum padrão, vegetariano, vegano, pescetariano, padrão com exclusões, alergias com preferências, edição de legado, geração/regeneração, treino e sequência/contagem das páginas.

## Ajuste posterior: remoção da confirmação e dos bloqueios

Por solicitação explícita do produto, removidos checkbox, aviso/bloqueio na home, condição de geração inicial, gates no contexto do backend e bloqueios no engine. Nenhum dado histórico foi apagado; os campos permanecem fora dos payloads da IA. As restrições alimentares e triagens do treino permanecem.

Validação deste ajuste: 345 testes do aplicativo e 69 testes unitários do backend aprovados, além de 9 cenários no emulador Firestore (incluindo gravidez, amamentação e ambas com geração bem-sucedida). TypeScript do aplicativo/Functions aprovado; lint sem erros, com quatro avisos preexistentes em NutritionShell.

## Limites e pendências

- Validar visualmente em dispositivo/simulador, nos temas claro e escuro. Os testes automatizados não substituem essa verificação.
- IA real não foi chamada; os testes usam provedor simulado e emulador local.
- A composição e os alergênicos continuam declarados pela IA. A verificação estruturada e por nomes não certifica ausência de ingredientes ocultos ou erros de classificação; não é possível prometer garantia absoluta com geração livre.
- Planos históricos não são reescritos ao editar preferências. As novas validações cobrem geração/regeneração e novas alternativas; restauração mantém o comportamento existente.
- Testar as novas regras de backend em Functions/Firestore locais, pois não houve deploy. Nenhum commit ou push foi realizado.

## Arquivos modificados/adicionados

- `docs/nutrition/02_questionnaire/nutrition_questionnaire.md`
- `docs/nutrition/02_questionnaire/question_dependencies.md`
- `docs/nutrition/09_safety/nutrition_safety_rules.md`
- `docs/nutrition/12_testing/questionnaire_refactor_2026-10-16.md`
- `docs/nutrition/canonical/ai_output_schema.json`
- `docs/nutrition/canonical/nutrition_constraints.json`
- `docs/nutrition/canonical/questionnaire.json`
- `functions/src/nutrition/__tests__/foodNames.test.ts`
- `functions/src/nutrition/__tests__/generation.test.ts`
- `functions/src/nutrition/__tests__/jobs.integration.test.ts`
- `functions/src/nutrition/__tests__/mealAlternative.test.ts`
- `functions/src/nutrition/__tests__/mealAlternativeAndRestore.integration.test.ts`
- `functions/src/nutrition/__tests__/nutritionJourney.e2e.integration.test.ts`
- `functions/src/nutrition/ai/config.ts`
- `functions/src/nutrition/ai/prompt.ts`
- `functions/src/nutrition/ai/provider.ts`
- `functions/src/nutrition/generation/alternative.ts`
- `functions/src/nutrition/generation/attempts.ts`
- `functions/src/nutrition/generation/context.ts`
- `functions/src/nutrition/generation/domain.ts`
- `functions/src/nutrition/generation/foodNames.ts`
- `functions/src/nutrition/generation/mealAlternativeRequest.ts`
- `functions/src/nutrition/generation/restrictions.ts`
- `functions/src/nutrition/generation/worker.ts`
- `src/i18n/resources/en/nutrition.json`
- `src/i18n/resources/es/nutrition.json`
- `src/i18n/resources/pt-BR/nutrition.json`
- `src/nutrition/engine/__tests__/index.test.ts`
- `src/nutrition/engine/errors.ts`
- `src/nutrition/engine/index.ts`
- `src/nutrition/ui/__tests__/profileSteps.test.ts`
- `src/nutrition/ui/profileSteps.ts`
- `src/screens/nutrition/NutritionHomeScreen.tsx`
- `src/screens/nutrition/NutritionProfileScreen.tsx`
- `src/screens/nutrition/NutritionShell.tsx`
- `src/services/__tests__/nutritionProfile.test.ts`
- `src/types/nutrition.ts`
