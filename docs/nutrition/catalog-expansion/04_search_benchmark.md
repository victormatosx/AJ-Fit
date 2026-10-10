# C1 — Benchmark de busca

## Metodologia e limitações

- **TACO**: avaliado por inspeção do dataset já importado (519 registros estáticos no repo) —
  não é uma API, então "busca" aqui significa presença/ausência no dataset atual.
- **TBCA**: sem API oficial; **não fizemos scraping em massa** nesta fase por risco de violar os
  termos de uso (reprodução proibida sem permissão). Avaliação é qualitativa, baseada na
  documentação pública da própria TBCA sobre escopo do dataset (5.700+ itens, 4.000+
  preparações, cortes de carne/aves/pescados/laticínios bem representados).
- **FatSecret**: **sem credenciais de API neste ambiente** (exige conta developer + Premier pago
  para cobertura Brasil). Nenhuma chamada real foi feita. Avaliação é baseada na documentação
  oficial do produto (edições, cobertura declarada por país/idioma).
- **Open Food Facts**: **POC real executada** contra a API pública
  (`https://br.openfoodfacts.org/cgi/search.pl`), sem chave, com `User-Agent` identificado,
  somente leitura, nenhum dado persistido. ~30 termos testados; parte das chamadas foi
  rate-limitada (HTTP vazio) mesmo com 1,5s de intervalo entre requisições — comportamento
  documentado da OFF para tráfego não autenticado em rajada.

## Lista de termos (amostra de 49, cobrindo todas as categorias pedidas)

Proteínas: frango, peito de frango, frango grelhado, coxa de frango, sobrecoxa, patinho, carne
moída, acém, contrafilé, tilápia, salmão, atum, ovo.
Carboidratos: arroz, arroz integral, feijão, macarrão, batata, batata doce, mandioca, pão
francês, tapioca, aveia.
Laticínios: leite, iogurte, queijo minas, muçarela, requeijão.
Frutas: banana, maçã, mamão, manga, morango, abacate.
Marcas/produtos: whey, iogurte de marca BR, refrigerante, barra de cereal, pão de forma, cereal
matinal, snack.
Preparações: frango desfiado, arroz com feijão, estrogonofe, lasanha, omelete, purê, farofa.

## Resultados por fonte

### TACO (dataset atual, 519 itens)
- Cobre bem alimentos crus/cozidos básicos: arroz, feijão, banana, ovo, frango (poucos cortes),
  leite. **Não cobre** sobrecoxa separada de coxa, a maioria das marcas, whey, refrigerantes,
  snacks industrializados, nem preparações compostas (estrogonofe, lasanha) — exatamente a lacuna
  que motivou esta pesquisa.
- Sem duplicação (dataset curado manualmente).
- Nutrição por 100g: sempre disponível, completa. Idioma: PT-BR nativo.

### TBCA (qualitativo, sem teste de API)
- Por desenho, cobre significativamente mais cortes/preparos de carnes/aves/pescados que o TACO
  (mais de 4.000 preparações no total). Esperado cobrir a maior parte da lista de proteínas e
  preparações do benchmark (frango desfiado, estrogonofe, lasanha, farofa) com boa qualidade,
  dado o foco em culinária brasileira.
- **Não cobre produtos de marca** (whey, refrigerante, snack industrializado) — não é esse o
  propósito da tabela.
- Risco: não há como confirmar sem acesso oficial/parceria; tratar como estimativa otimista até
  validação com a própria USP.

### FatSecret (qualitativo, sem teste de API)
- Dataset de 2,3M+ itens globais com Brasil incluído no plano Premier — espera-se cobertura forte
  tanto de genéricos (arroz, feijão, frango) quanto de marcas (whey de marcas BR, refrigerantes,
  cereais, iogurtes de marca) com macros por 100g e servings.
- Maior incerteza prática não é cobertura, é **acesso** (exige contrato Premier pago para Brasil).

### Open Food Facts (teste real)
Resultados representativos (ver `/private/tmp/.../off_benchmark_results.txt` da sessão de
pesquisa para o log completo):

| Termo | Resultado |
|---|---|
| frango | 651 resultados, mas top-3 inclui "Empanado de Frango 100% Vegetal" e "Coração de Frango" antes de peito/corte comum — sem ranking por relevância genérica |
| coxa de frango | 31 resultados, predominantemente pratos prontos de marca (Liv Up) e cortes congelados de marca (Sadia, Copacol) |
| patinho | 17 resultados, só produtos de marca/prontos, nenhum "patinho cru 100g" genérico |
| ovo | 384 resultados, **top-3 é café, maionese e macarrão** — ruído alto, nenhum ovo genérico no topo |
| feijão | 233 resultados, bons matches de marca (Pantera, Kicaldo, Pontarollo) |
| pão francês | 24 resultados, inclui o genérico "pão francês" de uma marca regional |
| tapioca | 189 resultados, só goma/farinha de marca, nenhuma "tapioca pronta, 1 unidade" genérica |
| queijo minas | 203 resultados, mistura queijo minas real com pão de queijo (correlação de nome, não de alimento) |
| banana | 367 resultados, **dominado por barras de cereal com banana**, não a fruta in natura |
| abacate | **apenas 5 resultados**, majoritariamente produtos de whey "sabor abacate", não a fruta |
| whey | 924 resultados, boa cobertura de marcas (Piracanjuba, Parmalat) |
| farofa | 88 resultados, bons matches de marca (Yoki, Da Terrinha) |

**Conclusão do teste real**: OFF é forte para **produtos industrializados/de marca com
embalagem** (exatamente o que falta hoje no catálogo AJ Fit) e fraco/ruidoso para **alimentos
genéricos crus ou in natura** — o oposto do TACO/TBCA. Isso reforça a tese de que as fontes são
**complementares**, não substitutas uma da outra.

- Generic vs. branded: fortemente branded.
- Nível de duplicação: moderado-alto para produtos populares (várias embalagens/tamanhos do
  mesmo produto).
- PT-BR: nomes de produto majoritariamente em português (são produtos brasileiros), mas sem
  normalização/sinônimo para termos genéricos.
- Nutrição por 100g: disponível e completa quando o produto tem rótulo digitalizado.

## Síntese do benchmark

| Categoria de busca | Melhor fonte esperada |
|---|---|
| Alimentos crus/in natura (arroz, feijão, frutas, carnes cruas) | TACO/TBCA |
| Preparações caseiras brasileiras (estrogonofe, farofa, frango desfiado) | TBCA |
| Produtos de marca/industrializados (whey, refrigerante, iogurte de marca) | FatSecret (se contratado) ou Open Food Facts |
| Barcode de produto embalado | Open Food Facts (grátis) ou FatSecret |
