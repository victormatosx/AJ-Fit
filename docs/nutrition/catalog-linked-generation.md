# Geração com vinculação ao catálogo — implementação local

Data: 18/10/2026. Não houve commit, push, deploy, migração, chamada paga de IA ou acesso de escrita ao Firestore real.

## 1. Resumo e estado

Implementado: modo opcional de planejamento livre pela IA seguido de resolução TACO/OFF no backend, recálculo, ajuste limitado, validação, persistência com referência e consumo direto por ID. O modo legado continua sendo o padrão. Não foi reintroduzido o Matcher de consumo por nomes.

A feature depende de `NUTRITION_CATALOG_LINKING_ENABLED=true` exclusivamente no processo backend. Ausente, `false` ou outro valor significa desativado. Nenhuma configuração remota foi criada.

## 2. Arquitetura final

1. O request existente mantém autenticação, App Check, onboarding/Premium existentes, rollout, cooldown e idempotência.
2. Jobs novos recebem `generationMode: catalog` somente quando a flag está ativa; jobs antigos não são convertidos por uma mudança da flag.
3. O provider existente recebe instruções adicionais de intenção alimentar: alimentos simples, gramas, preparo explícito e marca para produtos comerciais. O schema bruto continua sem IDs. Estimativas são temporárias.
4. O backend pesquisa documentos globais com Admin SDK, normaliza termos e compara identidade, marca, modificadores e preparo.
5. Segurança de restrições e qualidade nutricional são verificadas separadamente. Aprovação não é requisito universal.
6. Quantidades são corrigidas usando a composição real; as faixas do engine continuam sendo a autoridade.
7. Todos os itens são novamente lidos, inclusive dentro da transação que ativa o plano. Mudança concorrente não arquiva o plano ativo nem publica um plano parcial.
8. O plano guarda vínculos de schema 1 e `planSchemaVersion: 3.0.0`.
9. Consumo e favorito vinculados recebem apenas referências à opção original; o backend relê os documentos. Não há matching no consumo.

## 3. Arquivos

Novos módulos backend em `functions/src/nutrition/catalogLinking/`:
- `config.ts`: flag e versões.
- `search.ts`: adaptador Admin, páginas, orçamento, timeout, cache da operação e métricas.
- `resolver.ts`: equivalência, qualidade e política contextual de restrições.
- `pipeline.ts`: vinculação, correção, validação e releitura transacional.
- `logMeal.ts`: consumo por referência e recibo de idempotência.
- `favoriteMeal.ts`: favorito de uma opção original, sem aceitar nutrientes do cliente.

Compartilhados/cliente:
- `src/types/nutrition.ts`, `src/nutrition/catalog/binding.ts` e `scripts/syncNutritionToFunctions.cjs`.
- `src/services/nutritionCatalogMeal.ts`, `nutritionFavorites.ts`, `nutritionProfile.ts`.
- `NutritionShell.tsx`, `NutritionFavoritesScreen.tsx`, `MealOptionCard.tsx`, `generationStage.ts` e traduções PT/EN/ES.
- `src/onboarding/nutritionDraft.ts` preserva o campo opcional de ausências críticas.
- `src/nutrition/foodLog/qualityAudit.ts`: retirada de import não usado necessária ao espelho com `noUnusedLocals`.

Integração existente adaptada: provider/prompt, attempts/alternative, request/worker, mealAlternativeRequest, foodNames/context, domain (novo código de falha), operations, exports e inventário de exclusão de conta.

Contrato adicional: `canonical/catalog_linked_meal_plan_schema.json`. O schema legado não foi substituído.

## 4. Busca TACO/OFF

- Consulta `searchPrefixes array-contains` com ordenação por document ID.
- Primeiro prefixo da expressão completa, depois âncora, sinônimos e termos complementares.
- Páginas de até 40 documentos; nenhum top-k descarta documentos depois de avançar o cursor.
- `nutritionFoods`: TACO aprovado ou pendente; bloqueado é recusado.
- `foodLogCatalog`: somente TACO/OFF ativos. Ocultos, depreciados e status ausente são recusados.
- IDs são conferidos contra a identidade determinística da fonte, além da existência documental.
- Mesmo `source.type + sourceId` não é contado como ambiguidade entre coleções; a referência escolhida continua inteira, sem misturar nutrientes.
- Identidades diferentes com correspondência exata ambígua são recusadas.
- Limites por operação: 1.600 leituras estimadas, 100 consultas/lookups contabilizados na busca e timeout de até 10 s por RPC, sempre limitado pelo prazo global.
- Cache apenas na operação; uma falha por orçamento não é apresentada como ausência comprovada.

Não há nova API, embeddings, banco vetorial ou varredura integral por geração. As consultas usam os índices existentes; não foram alterados índices locais/remotos.

## 5. Correspondência

Nome/aliases, tokens normalizados, sinônimos existentes, fonte, marca, modificadores e preparo participam da decisão. `tipo 1` é normalizado para arroz branco. Cru/cozido/grelhado não são convertidos.

Produtos OFF exigem marca explícita na intenção. Não se escolhe uma formulação comercial arbitrária para um pedido genérico. Qualificadores como integral, desnatado, proteico, natural, sem lactose/glúten e com/sem pele não desaparecem durante o matching.

Intenções com ingredientes implícitos adicionais são recusadas: o planejamento deve listar alimentos separados. Correspondências incompletas podem produzir sugestões reais em feedback em memória para a IA escolher uma intenção mais específica; sugestões não são vínculos nem autorização para relaxar restrições.

## 6. Restrições e evidência

- `excludedAllergens` continua suportado.
- O contrato admite `excludedSubstances: ['lactose', 'gluten']`, opcional, sem inventar respostas nem adicionar uma nova página de questionário.
- No modo vinculado, alergias/ausências críticas exigem `safetyEvidence` do documento global, com referência de evidência e revisão nutricional atual. Lista vazia de alergênicos não basta.
- Nenhum documento real recebeu esse metadado. Portanto, perfis críticos podem falhar por falta de evidência no catálogo atual.
- `safetyEvidence` não é preenchido pela IA. A revisão exata também inclui marca, preparo, alergênicos e flags alimentares quando presentes. A qualidade da evidência depende da governança dos escritores administrativos do catálogo; uma string de referência não substitui a revisão material da fonte.
- Padrões alimentares usam flags existentes quando presentes, contradições independentes e uma taxonomia fechada de ingredientes vegetais simples TACO. Produtos/composições desconhecidos não herdam uma classificação segura.
- Exclusões são conferidas por ID e por termos conservadores entre fontes. Composição desconhecida com exclusões não é liberada por similaridade de nome.
- No modo legado, um novo campo de ausência crítica não suportado causa falha antes de chamar IA. Perfis antigos sem esse campo mantêm o comportamento anterior.
- Heurísticas do gerador livre não são autoridade para alimentos vinculados: por exemplo, `galinha` em `ovo de galinha` não torna o ovo carne. A segurança vinculada é conferida no resolvedor e na releitura do catálogo.

## 7. Nutrição e praticidade

Todos os cinco nutrientes devem ser conhecidos, finitos e não negativos. Fibra ausente nunca vira zero. Os testes existentes de qualidade rejeitam erros severos e incoerência energia/macros; aviso exclusivamente de categoria não altera o nutriente declarado.

OFF volumétrico sem base de massa confiável e bebidas OFF são conservadoramente recusados. Animais crus e ingredientes secos que precisam de preparo/conversão não são servidos como se já estivessem preparados.

Cálculo: `nutritionPer100g * grams / 100`; arredondamento por item, soma de itens por refeição e soma diária. A propriedade histórica `estimatedNutrition` guarda valores calculados no schema 3 para compatibilidade de leitores; a IA nunca fornece o valor final.

Correção: até 40 passagens locais de coordenadas, dentro de 0,5–2 vezes a massa inicial, teto de 600g por alimento, 60g para `fat_source`, 1.200g/refeição e até seis itens. Duplicação da mesma identidade numa opção e repetição excessiva entre refeições são recusadas. O algoritmo é limitado, não um otimizador global completo: planos factíveis podem precisar de reparo pela IA.

## 8. Contrato e diário

Exemplo estrutural (IDs ilustrativos, não registros criados):

```ts
{
  name: 'Arroz, integral, cozido',
  quantity: 120,
  unit: 'g',
  preparationNote: '',
  estimatedNutrition: { kcal: 148.8, proteinG: 3.12, carbsG: 30.96, fatG: 1.2, fiberG: 3.24 },
  catalogBinding: {
    schemaVersion: 1,
    collection: 'nutritionFoods',
    foodId: '<ID nf_ real resolvido no servidor>',
    grams: 120,
    source: { type: 'taco', sourceId: '1' },
    catalogVersion: '<versão do documento>',
    nutritionRevision: '<tupla canônica exata>',
    nutritionPer100g: { kcal: 124, proteinG: 2.6, carbsG: 25.8, fatG: 1, fiberG: 2.7 },
    preparation: 'cooked'
  }
}
```

Alergênicos permanecem ausentes no item quando a revisão do documento é desconhecida. Marca é preservada no vínculo e exibida nos cards/favoritos.

`logCatalogMeal` recebe `{requestId, origin, documentId, optionId, slot, localDate, timezone}`. Não aceita nomes, nutrientes ou vínculos do cliente. Resolve a opção original do proprietário, relê cada alimento, compara revisão e disponibilidade, verifica restrições atuais e calcula os snapshots.

Grava os mesmos tipos do diário (`catalog_food` ou `food_log_catalog`) e agregados, atomicamente, com recibo backend-only em `nutritionCatalogLogReceipts`. Retry com mesmo request não duplica; outro payload com o mesmo request é recusado. A nova coleção está no inventário de exclusão de conta.

Documento alterado/oculto/removido: registro direto é bloqueado com mensagem de atualização/registro manual. Não há troca de ID, recálculo silencioso contra uma nova revisão ou alteração de histórico.

A concorrência das escritas manuais preexistentes continua seguindo seu protocolo original. Não foi feita uma migração geral da autoridade do diário.

## 9. Planos antigos

Itens sem `catalogBinding` continuam no fluxo manual existente. Itens parcialmente vinculados não recebem sucesso de registro direto. Não existe matcher retroativo nem migração. Histórico e restauração não regravam composição.

## 10. Alternativas, favoritos, restauração e regeneração

Alternativas passam pelo mesmo resolvedor/validador. Para planos schema 3, usam a meta do snapshot do plano; restrições são as atuais. Se a flag for desativada, não geram silenciosamente alternativas livres de um plano vinculado.

Favoritos vinculados são criados por `favoriteCatalogMeal` a partir da opção original. Favoritos legados continuam no serviço cliente. No consumo de favorito, o backend confere seus vínculos contra plano/alternativa original; modificar o bookmark não autoriza nutrientes ou quantidades arbitrárias.

As Rules não foram afrouxadas para aceitar vínculos escritos pelo cliente. Isso também evita exceder o orçamento de 1.000 expressões observado no teste de oito favoritos. Exclusão de favorito continua funcionando.

Regeneração usa a mesma fila. Plano anterior só é arquivado após validação e releitura transacional bem-sucedidas. Restauração mantém snapshots históricos e o diário detecta revisão incompatível no momento do consumo.

## 11. Flag e rollback

Padrão OFF. Não existe botão ou payload cliente que ative o modo. Jobs são fixados no modo quando criados. Desativar a flag interrompe jobs vinculados pendentes com falha controlada; não os converte em geração livre. Consumo/favorito de vínculos já persistidos continuam disponíveis mediante validação, independentemente da flag de geração.

Nenhuma flag, credencial ou coleção foi criada em produção. Os dois endpoints novos precisam ser publicados futuramente para que novos clientes usem vínculos reais.

## 12. Testes executados

Resultados locais (execuções com sobreposição; não somar como casos distintos):

| Verificação | Resultado |
| --- | --- |
| Regressão app/nutrição/tipos/traduções | 1.415 passaram; 3 ignorados |
| Rules completas no emulador | 572 passaram |
| Functions/nutrição + exclusão de conta, Node 22 | 227 passaram; 1 smoke real de IA ignorado |
| Resolvedor + oito perfis, após revisão final | 49 passaram |
| Jornada integrada final + inventário de exclusão | 17 passaram |
| TypeScript app e Functions; espelho compartilhado | Sem erros |
| ESLint dos arquivos afetados | Sem erros; 2 avisos preexistentes em NutritionShell |

Os testes de integração usam o projeto de demonstração `demo-ajfit-catalog`, Firestore Emulator e provider simulado. Não usam credenciais ou alimentos de usuários reais. Exemplos reproduzíveis:

```sh
node scripts/syncNutritionToFunctions.cjs --check
./node_modules/.bin/tsc --noEmit
(cd functions && ./node_modules/.bin/tsc --noEmit)
(cd functions && ./node_modules/.bin/vitest run src/nutrition/__tests__/catalogLinking.test.ts src/nutrition/__tests__/catalogCapacity.test.ts)
# Dentro de emulators:exec com projeto demo e FIRESTORE_EMULATOR_HOST:
(cd functions && ./node_modules/.bin/vitest run src/nutrition/__tests__/catalogLinking.integration.test.ts)
```

Use Java 21 e Node 22 ao iniciar o emulador. Suítes incluem:
- Unitários de resolução, sinônimos, marcas, preparo, ambiguidade, status, qualidade, fibra, orçamento, paginação, timeout e revisão alterada.
- Evidência ausente, alergias, lactose/glúten, vegetarianismo/veganismo, soja e contradições.
- Cálculo fracionário, arredondamento, ajuste, desvio impossível, plano/alternativa e compatibilidade livre.
- Oito cenários de capacidade com alimentos públicos da auditoria e metas sintéticas; falha controlada para glúten não comprovado e composição vegana insuficiente. Isso não prova adequação clínica ou solução global para todos os perfis.
- Jornada no emulador: fila, idempotência, cooldown, geração, alternativa, favorito backend, consumo direto, rejeição de favorito adulterado, mudança de catálogo, preservação de histórico/plano ativo e restauração.
- Rules de perfis, bookmarks, catálogo e recibos; suíte completa de Rules.
- TypeScript app/Functions, regressão de nutrição/tipos/traduções e ESLint afetado.

## 13. Não executado

Não houve chamada real OpenAI, teste em usuário real, validação visual em dispositivo ou medição de latência/custo em produção. Um smoke test real de IA requer autorização posterior. A suíte de Functions e integração também foi executada em Node 22.23.2, compatível com o runtime declarado.

Classificação da entrega: código local implementado e coberto pelas verificações acima; integração com provider real e dispositivo não testada; ativação, publicação e eventual curadoria administrativa de evidências não executadas. Não há aprovação automática em massa nem promessa de atender perfis sem candidatos comprovadamente compatíveis.

## 14. Riscos conhecidos

A busca lexical é conservadora e pode rejeitar intenções que um humano conseguiria esclarecer. A correção pode não encontrar uma solução global existente. Evidência crítica ainda depende de governança administrativa. Novos campos de lactose/glúten são de contrato, sem nova captura na UI. A qualidade clínica, micronutrientes e contaminação cruzada não são inferidos.

## 15. Cobertura

Não exige `approved` universalmente. Pendentes TACO e OFF ativos participam quando identidade, nutrientes, massa e restrições são verificáveis. Produtos de marca precisam ser pedidos explicitamente; muitos OFF não têm fibra ou evidência suficiente. Limite de leitura pode interromper buscas muito amplas com erro explícito. Não se promete habilitar os 23 mil registros.

## 16. Custos e observabilidade

Não depende de catálogo inteiro no prompt. Mantém até três chamadas de IA e os modelos existentes. Prazo global do plano: 430s dentro do worker existente de 540s; alternativa: 110s dentro da callable de 120s. Provider recebe o mínimo entre 90s e tempo restante, reservando margem de validação. Nenhum timeout de servidor foi ampliado.

`nutritionAiOperations` mantém uso/tokens/latência existentes e acrescenta contadores de solicitados, vinculados, rejeitados, candidatos examinados, páginas, cache, leituras, buscas, correções, fontes e motivos fechados. Não persiste intenção, nomes ou alergias em métricas. Feedback de reparo com nomes fica apenas em memória e segue para o provider.

Até 1.600 leituras estimadas do catálogo por operação, mais contexto, transações/recibos e possíveis retries de transação; não é uma previsão de cobrança exata. A verificação transacional respeita o mesmo orçamento de leituras da sessão. Tamanho do catálogo não determina os tokens enviados. Não foram usados preços internos como preços atuais confirmados.

## 17. Teste manual futuro

1. Usar projeto de teste isolado ou emuladores; nunca ativar produção para validar.
2. Executar sync nutricional e typechecks, testes e Rules locais.
3. Publicar futuramente, sob autorização, endpoints e Rules compatíveis no ambiente de teste.
4. Configurar a flag backend somente nesse ambiente. Confirmar que jobs antigos permanecem legados.
5. Gerar plano convencional e verificar referências, somas e unidades; testar perfil sem evidência crítica esperando falha e preservação do plano anterior.
6. Registrar opção, repetir após perda de resposta e verificar um único consumo.
7. Testar alternativa, favorito, restauração e plano legado.
8. Alterar apenas um alimento sintético de teste e confirmar bloqueio do registro vinculado; histórico já registrado permanece igual.
9. Desativar a flag e verificar ausência de novos planos vinculados/fallback silencioso.

## 18. Antes de ativar

Revisão do diff e contratos, homologação visual, avaliação de qualidade com provider real autorizada, métricas reais de correspondência/reparos e decisão explícita de escopo para restrições críticas. Publicação das duas novas callables, Functions alteradas e Rules de perfil somente com autorização. Não há migração obrigatória nem necessidade de criar índice remoto ou API paga.

## Anexo — manifesto de arquivos da implementação

Lista local; os arquivos preexistentes sem participação nesta implementação foram excluídos. Em `firestore.rules`, somente a validação opcional de `excludedSubstances` foi acrescentada ao estado inicial.

- `docs/nutrition/canonical/catalog_linked_meal_plan_schema.json`
- `docs/nutrition/catalog-linked-generation.md`
- `firestore-tests/nutrition.rules.test.ts`
- `firestore.rules`
- `functions/src/accountDeletion/firestoreCleanup/resources.ts`
- `functions/src/index.ts`
- `functions/src/nutrition/__tests__/catalogCapacity.test.ts`
- `functions/src/nutrition/__tests__/catalogLinking.integration.test.ts`
- `functions/src/nutrition/__tests__/catalogLinking.test.ts`
- `functions/src/nutrition/__tests__/fixtures/catalogCapacity.json`
- `functions/src/nutrition/ai/prompt.ts`
- `functions/src/nutrition/ai/provider.ts`
- `functions/src/nutrition/catalogLinking/config.ts`
- `functions/src/nutrition/catalogLinking/favoriteMeal.ts`
- `functions/src/nutrition/catalogLinking/logMeal.ts`
- `functions/src/nutrition/catalogLinking/pipeline.ts`
- `functions/src/nutrition/catalogLinking/resolver.ts`
- `functions/src/nutrition/catalogLinking/search.ts`
- `functions/src/nutrition/generation/alternative.ts`
- `functions/src/nutrition/generation/attempts.ts`
- `functions/src/nutrition/generation/context.ts`
- `functions/src/nutrition/generation/domain.ts`
- `functions/src/nutrition/generation/foodNames.ts`
- `functions/src/nutrition/generation/mealAlternativeRequest.ts`
- `functions/src/nutrition/generation/operations.ts`
- `functions/src/nutrition/generation/request.ts`
- `functions/src/nutrition/generation/worker.ts`
- `scripts/syncNutritionToFunctions.cjs`
- `src/components/nutrition/MealOptionCard.tsx`
- `src/i18n/resources/en/nutrition.json`
- `src/i18n/resources/es/nutrition.json`
- `src/i18n/resources/pt-BR/nutrition.json`
- `src/nutrition/catalog/__tests__/binding.test.ts`
- `src/nutrition/catalog/binding.ts`
- `src/nutrition/foodLog/qualityAudit.ts`
- `src/nutrition/ui/generationStage.ts`
- `src/onboarding/nutritionDraft.ts`
- `src/screens/nutrition/NutritionFavoritesScreen.tsx`
- `src/screens/nutrition/NutritionShell.tsx`
- `src/services/__tests__/nutritionCatalogMeal.test.ts`
- `src/services/nutritionCatalogMeal.ts`
- `src/services/nutritionFavorites.ts`
- `src/services/nutritionProfile.ts`
- `src/types/nutrition.ts`
