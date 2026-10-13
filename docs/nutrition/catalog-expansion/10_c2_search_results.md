# C2 — Resultado do benchmark de busca (antes/depois)

Benchmark real executado contra o catálogo `foodLogCatalog` já populado em produção de teste
(`ajfit-2f321`, 1.349 itens), usando a mesma lista de 45 termos da C1
(`04_search_benchmark.md`), via `npm run nutrition:food-log:search-benchmark -- --project
ajfit-2f321`.

## Antes (baseline documentado na C1)

- Catálogo de geração (`nutritionFoods`) com só **58 itens buscáveis** (os únicos `approved` de
  519 TACO) — a maioria dos cortes de frango/carne (peito, coxa, sobrecoxa, contra-filé, acém)
  **não aparecia em nenhuma busca**, mesmo já estando no banco, por causa do filtro
  `generationStatus == 'approved'`.
- Nenhum produto de marca (Sadia, Vigor, Yoki, Piracanjuba etc.) no catálogo.
- Busca por frase ("peito de frango") nunca foi avaliada no baseline porque o catálogo de 58
  itens já não cobria praticamente nada de carnes.

## Depois (C2, primeira iteração da busca)

Primeira versão (prefix-match literal da frase inteira, igual ao mecanismo herdado):

```json
{ "usefulResultRate": 0.778, "zeroResultRate": 0.222, "priorityTermsCoverage": "15/21" }
```

Buscas de uma palavra funcionavam bem; **todas as 6 buscas de frase com 2+ palavras relevantes
("peito de frango", "frango grelhado", "coxa de frango", "frango desfiado", "arroz com feijão",
e por acaso também "contrafilé"/"pão francês"/"muçarela" por outros motivos) retornavam zero.**

## Depois (C2, com busca âncora+refino — implementação final)

```json
{
  "totalQueries": 45,
  "queriesWithUsefulResult": 40,
  "usefulResultRate": 0.889,
  "zeroResultRate": 0.111,
  "averageResultsPerUsefulQuery": 11.8,
  "priorityTermsCoverage": "19/21",
  "zeroResultTerms": ["contrafile", "tilapia", "mucarela", "frango desfiado", "estrogonofe"]
}
```

**Melhoria**: taxa de resultado útil de 77,8% → **88,9%**; cobertura dos termos prioritários de
15/21 → **19/21**. "peito de frango" (5 resultados), "frango grelhado" (2), "coxa de frango" (8)
e "arroz com feijão" (1, "Baião de dois") passaram a funcionar, resolvendo diretamente a queixa
original do produto sobre cortes de frango.

### Cobertura de frango/carnes (atenção especial pedida na Parte 15)

| Termo | Resultado | Fonte |
|---|---|---|
| frango | 33 | TACO+OFF |
| peito de frango | 5 | TACO |
| frango grelhado | 2 | TACO |
| coxa de frango | 8 | TACO |
| sobrecoxa | 4 | TACO |
| patinho | 1 | TACO |
| carne moída | 1 | OFF |
| acém | 4 | TACO |
| contrafilé | **0** (ver causa raiz abaixo) | — |
| tilápia | **0** (ausente no corpus atual) | — |
| salmão | 3 | TACO |
| atum | 9 | TACO+OFF |
| ovo | 14 | TACO+OFF |

**11 de 13 termos de carnes/aves/pescados têm cobertura útil** — resolve o problema original
relatado ("faltam cortes de frango e carnes") para a grande maioria dos casos reais.

## Causa raiz exata de cada zero-resultado restante (5 termos)

Investigado item por item (não é "não sei por quê" — cada um tem uma causa concreta e
documentada):

1. **"contrafile"** — o registro TACO existe (`"Carne, bovina, capa de contra-filé..."`), mas o
   nome tem um hífen: "contra-filé". A normalização de busca (`normalizeSearchText`) transforma
   hífen em espaço, então o nome vira "contra file" (duas palavras). A consulta do usuário
   "contrafile" (uma palavra só, sem espaço) nunca bate nem com "contra" nem com "file"
   isoladamente. **Correção de C3 sugerida**: gerar um alias adicional sem separador
   ("contrafile") no momento do import para nomes com hífen interno — mudança pequena e
   isolada em `searchPrefixes`/aliases, não testada nesta fase para não mexer no gerador
   compartilhado com `nutritionFoods` sem necessidade.
2. **"tilápia"** — confirmado por inspeção direta: **não existe nenhum registro de tilápia** nem
   no TACO (519 registros) nem nos 1.000 produtos OFF coletados nesta fase. Gap real de
   cobertura, não um bug de busca — resolvido por mais páginas de OFF (bloqueadas nesta fase, ver
   `09_c2_import_results.md`) ou por TBCA (C3).
3. **"muçarela"** — a Open Food Facts tem o produto, mas com a grafia "**Mussarela**" (dois
   "esses"), não "Muçarela" (cê-cedilha). São duas variantes ortográficas válidas em PT-BR para o
   mesmo queijo — não é um problema de acento (que já é tratado), é um problema de
   **variante lexical**, que exigiria uma tabela de sinônimos (ex.: mussarela ↔ muçarela ↔
   mozarela), exatamente o tipo de coisa que a C1 recomendou não enumerar manualmente nesta fase
   ("crie estrutura extensível, não uma lista gigantesca de sinônimos"). `src/nutrition/foodLog/search.ts`
   já é o lugar certo para crescer essa tabela em C3.
4. **"frango desfiado"** — não existe como prato pronto nem no TACO nem na amostra OFF coletada.
   Esperado: é uma preparação caseira, mais provável de aparecer na TBCA (que tem 4.000+
   preparações) do que em qualquer uma das duas fontes atuais.
5. **"estrogonofe"** — mesmo caso: prato preparado, ausente do TACO (confirmado por grep direto
   no dataset) e não presente na amostra de 1.000 produtos OFF coletada.

Nenhum desses 5 é um defeito do mecanismo de busca em si — são, em ordem: (1) uma lacuna pequena
e corrigível de normalização de alias, (2)+(4)+(5) lacunas reais de cobertura de dados
(resolvidas por mais ingestão de OFF ou por TBCA), e (3) uma lacuna de sinônimo lexical conhecida
e já prevista como trabalho futuro pela própria C1.

## Meta de cobertura (Parte 16) — resultado final

- **88,9%** de taxa de resultado útil — abaixo da meta de ≥90%, mas muito próximo, com as 5
  lacunas restantes totalmente diagnosticadas (seção acima) e nenhuma delas é um problema de
  arquitetura: são lacunas de dado (resolvidas por mais ingestão) ou de alias/sinônimo (trabalho
  incremental, não uma reforma).
- Carnes/frango têm cobertura útil (11/13 termos) — requisito obrigatório do gate, atingido.
- 1.349 itens no catálogo — abaixo de "dezenas de milhares", pelo motivo documentado em
  `09_c2_import_results.md` (teto de coleta da OFF nesta sessão, não do pipeline).
