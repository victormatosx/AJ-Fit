# C4 — finalização do catálogo de logging

Data da validação: 2026-10-09. Projeto de teste: `ajfit-2f321`.

## Resultado

A C4 encerra o catálogo amplo como feature utilizável sem alterar o papel de `nutritionFoods`. O Firestore continua com 23.606 documentos (`519` TACO + `23.087` OFF); após a política final há 23.562 pesquisáveis, 25 `hidden` e 19 `deprecated`. Nenhum documento foi apagado e nenhum macro foi corrigido silenciosamente.

O benchmark final, executado contra o Firestore real, obteve:

- 151/151 queries com resultado útil (100%);
- zero queries sem resultado;
- 27/27 termos prioritários cobertos;
- 100% em todas as categorias do benchmark.

`multivitamínico` foi resolvido sem alimento sintético. O corpus já continha `MULTIVITAMINS + MINERALS MAN`; o alias PT-BR/EN apenas tornou o registro real encontrável. Também foi adicionada a equivalência flexional `moída`/`moído`, necessária para `carne moída` encontrar as descrições TACO.

## Ranking final

A relevância semântica sempre precede personalização. A ordem é:

1. nome normalizado exato;
2. alias lexical exato;
3. primeiro token inteiro do nome;
4. todos os termos significativos como tokens do nome;
5. marca exata;
6. tokens em nome/aliases;
7. token inteiro;
8. prefixo textual;
9. substring/fallback.

Favorito e recente desempataram apenas dentro do mesmo tier. Assim, um favorito incidental não vence um resultado exato. TACO/TBCA continuam à frente de branded em empate; quando ao menos dois candidatos corroboram uma marca consultada, a intenção de marca vence. Essa corroboração evita que um campo OFF ruim como `brand = "Sopa"` transforme `Vono` no primeiro resultado de `sopa`.

Casos críticos verificados no catálogo real:

- `ovo`: top 5 composto por ovos TACO, sem produtos incidentais;
- `frango`: resultados iniciados por frango TACO antes de empadas/coxinhas;
- `iogurte`: iogurtes genéricos TACO antes de branded;
- `nestlé`: produtos Nestlé antes de candidatos sem intenção de marca;
- `whey`: produtos whey nos primeiros resultados;
- `maçã`: maçã no topo, sem `macarrão` por coincidência de prefixo;
- `sopa`: preparações com nome iniciado por sopa, não o produto `Vono` por alias de marca.

## Personalização, cache e deduplicação

- `recentIds` é derivado dos últimos 20 IDs `flc_` da semana de diário já assinada por `NutritionShell`; não existe leitura do diário no hot path da busca.
- O cache é apenas em memória, TTL de 60 segundos, LRU com no máximo 50 páginas e chave opaca derivada de query normalizada + cursor + pool. Não persiste texto pesquisado.
- Favoritos/recentes são reaplicados depois do cache, portanto mudanças pessoais não tornam o cache incorreto.
- Cada cursor representa uma página independente; cache de primeira página nunca responde por uma página posterior.
- Duplicatas de mesma identidade de fonte, barcode ou `normalizedName + brand` são removidas somente da apresentação. Documentos e macros nunca são fundidos.

## UX e compatibilidade

Foram revisadas semanticamente 55 buscas distribuídas entre carnes, aves, peixes, laticínios, frutas, verduras, pães, suplementos, bebidas, snacks, preparações e marcas. As 15 marcas pedidas (`Nestlé`, `Danone`, `Vigor`, `Piracanjuba`, `Itambé`, `Seara`, `Sadia`, `Perdigão`, `Yoki`, `Camil`, `Tio João`, `Qualy`, `Batavo`, `Parmalat`, `Dux`) retornaram itens ativos com macros completos.

Problemas encontrados e resolvidos: prefixo incidental (`maçã`/`macarrão`), alimento preparado antes do básico (`frango`), alias de marca genérico (`sopa`), duplicatas visuais e boosts pessoais acima da relevância. Gap residual: alguns produtos OFF têm nome curto ou pouco descritivo (`Arroz` com marca Nestlé); a marca continua exibida e não há base confiável para inventar um nome melhor.

`FoodSearchScreen`, `RegisterMealScreen` e `CreateRecipeScreen` mantêm debounce de 350 ms, guarda contra resposta obsoleta, loading/erro/vazio, teclado preservado, paginação, marca, coração e indicação por 100 g. Receitas agora usam o catálogo amplo e resolvem ingredientes `flc_`; o catálogo de geração não foi ampliado.

Favoritos `hidden`, `deprecated` ou ausentes continuam visíveis como indisponíveis para poderem ser removidos, sem mostrar macros suspeitos. Diário mantém snapshot imutável; depreciação do catálogo não altera histórico. Custom foods, recipes e `favoriteMealOptions` preservam namespaces e fluxos existentes.

## Observabilidade e segurança

Busca, zero-result, seleção, fonte, bucket de latência e criação de custom após zero-result permanecem cobertos por eventos de vocabulário fechado. A query e o nome do alimento nunca são propriedades aceitas pelo contrato; o firewall de propriedades sensíveis continua ativo.

Rules não mudaram: leitura autenticada de `foodLogCatalog`, escrita cliente bloqueada, custom foods owner-only e Admin SDK autorizado. O índice existente (`status`, `searchPrefixes`, `searchSourcePriority`, `__name__`) atende à busca; nenhum deploy foi necessário.

## Isolamento

Não houve alteração no Nutrition Engine, targets, validators, prompts, geração, gravidez/lactação ou semântica de `nutritionFoods`. O catálogo amplo continua exclusivo de logging, favoritos e receitas do usuário.

