# C3 — implementação do catálogo massivo de logging

Status: concluída em 2026-10-09 no projeto de teste autorizado `ajfit-2f321`.
Nenhum commit ou push foi feito.

## Isolamento arquitetural

- `nutritionFoods` continua sendo o catálogo curado e a única fonte da geração de dieta.
- `foodLogCatalog` continua dedicado a busca, diário e favoritos.
- A C3 não alterou Nutrition Engine, targets, validators, prompts, pipeline de geração nem regras
  de gravidez/lactação.
- `FoodLogEntry.subCategory` é apenas metadata de logging. Ela não participa da seleção de
  alimentos da geração.

## Busca e ranking

`src/nutrition/foodLog/aliases.ts` mantém um conjunto pequeno e explícito de variantes PT-BR:

- muçarela, mussarela, mussarella, mozarela e muzzarella;
- estrogonofe, strogonoff, stroganoff e estrogonoff;
- contrafilé e contra filé.

Além disso, nomes compostos com hífen geram mecanicamente um alias concatenado durante a
normalização; por exemplo, `contra-filé` também produz `contrafile`. A normalização remove
acentos, portanto as formas acentuadas e não acentuadas usam o mesmo caminho.

A busca cria um plano com até dez `anchorTerms` para `array-contains-any` e refina o pool no
cliente usando os mesmos sinônimos. Input vazio retorna plano e resultado vazios. O pool remoto
é limitado a 60 documentos, ordenado por `searchSourcePriority` para que os itens genéricos
TACO/TBCA não sejam expulsos por IDs OFF no catálogo grande.

O ranking determinístico usa: favorito, recente, nome exato, alias exato, `startsWith`, token,
`contains` e fallback. Dentro de um tier, TACO/TBCA precedem fontes de marca. O boost pessoal só
opera dentro do pool já recuperado pela âncora, portanto um favorito irrelevante não entra no
resultado. Nos dados reais, `ovo` e `frango` colocam itens TACO reais nas cinco primeiras posições.

## UI e provider

`FoodSearchScreen` e `RegisterMealScreen` usam `createLocalFoodLogSearchProvider()` para o
catálogo de logging. Ambas protegem respostas assíncronas contra requisições obsoletas;
paginação continua baseada no cursor remoto e `favoriteFoodIds` é passado ao ranking sem alterar
o cursor. A interface `FoodSearchProvider` é a única abstração adicionada para um futuro provider
externo; não há federação artificial sem um segundo provider contratado.

## Subcategorias e analytics

O classificador de subcategoria usa limites de token para evitar falsos positivos como `aveia`
em `poultry` ou `Ovomaltine` em `eggs`. As categorias são metadata de logging.

Analytics adicionou somente propriedades fechadas: bucket de latência, source enumerada e
`afterZeroResults` booleano. O firewall rejeita query, nome de alimento ou qualquer string livre.

## Diário, favoritos e segurança

- um item `flc_` é resolvido em `foodLogCatalog` e gravado no diário como snapshot imutável;
- favoritos reconhecem IDs `flc_`;
- custom foods, recipes e `favoriteMealOptions` mantêm caminhos próprios;
- cliente autenticado/ativo pode ler `foodLogCatalog` e `foodLogCatalogMeta/current`;
- escrita de catálogo pelo cliente continua proibida; os imports usam Admin SDK;
- custom foods continuam owner-only.

O teste de Rules específico de Nutrição passou com 12/12 casos. A C3 publicou somente o novo
índice; não houve redeploy nem relaxamento das Rules.
