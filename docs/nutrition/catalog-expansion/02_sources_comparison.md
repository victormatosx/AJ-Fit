# C1 — Comparação de fontes externas

Pesquisa técnica/legal feita via busca web e, quando possível, teste direto de API (read-only,
sem persistir dados). Nenhuma integração de produção foi feita.

## TACO (já em uso)

- Fonte atual do catálogo (~519 registros, 4ª edição 2011, NEPA/UNICAMP).
- Doado como tabela estática (planilha/PDF), domínio público de fato, sem API.
- Boa para alimentos crus/básicos brasileiros, mas desatualizada (2011), cobertura pequena,
  quase nenhuma preparação ou produto de marca.

## TBCA (Tabela Brasileira de Composição de Alimentos — USP/FoRC/BRASILFOODS)

- **Tamanho**: versão 7.3 (2025) com mais de 5.700 alimentos, incluindo 4.000+ preparações.
  34 componentes nutricionais por item (composição centesimal, vitaminas, minerais).
- **Qualidade para contexto brasileiro**: alta — é a tabela de referência acadêmica nacional,
  com dados analíticos originais e dados sobre alimentos da biodiversidade brasileira. Cobre bem
  cortes/preparos de carnes, aves, pescados, laticínios e pratos preparados regionais.
- **Formato disponível**: consulta via site (`tbca.net.br`, app iOS/Android) e uma planilha de
  cálculo de agregações. **Não há API pública/oficial documentada.** Projetos de terceiros no
  GitHub fazem web scraping do site, o que não é uma via oficial e sinaliza ausência de contrato
  de dados formal.
- **Licença/termos de uso**: requer atribuição com citação específica ("Tabela Brasileira de
  Composição de Alimentos (TBCA)... Versão 7.3. São Paulo, 2025"). O site declara explicitamente
  que **reprodução total ou parcial, alteração ou comercialização são proibidas**, e que uso
  comercial exige contato direto com os coordenadores (`tbca.contato@usp.br`).
- **Risco jurídico**: alto se importado em massa sem autorização explícita, especialmente para um
  produto comercial (AJ Fit). **Requer revisão jurídica e contato formal com a USP/FoRC** antes
  de qualquer importação além de uso pontual/educacional.
- **Conclusão da C1**: TBCA é a fonte de **melhor qualidade para o contexto brasileiro**, mas o
  caminho técnico de acesso (sem API, só scraping) e o caminho legal (permissão comercial
  pendente) tornam qualquer importação em escala uma dependência externa de aprovação humana —
  não uma tarefa de engenharia pura. Não fizemos scraping nesta fase por ser uma reprodução
  potencialmente vedada pelos termos.

## FatSecret Platform API

- **Cobertura**: mais de 2,3 milhões de alimentos verificados em 58+ países e 26 idiomas,
  incluindo português do Brasil (dataset por país/região, parâmetro `region=BR`,
  `language=pt`). Inclui alimentos genéricos (generic foods) **e** produtos de marca
  (branded), barcode (`food.find_id_for_barcode`), servings padronizados, busca com
  autocomplete.
- **Edições e preço**:
  - **Basic**: grátis, self-service, 5.000 chamadas/dia, **só dataset dos EUA**.
  - **Premier Free**: grátis após verificação (startups/sem fins lucrativos/receita baixa),
    chamadas ilimitadas, **ainda só EUA**.
  - **Premier**: preço sob consulta, baseado nos mercados desejados; chamadas ilimitadas;
    acesso a 58+ países incluindo Brasil.
  - **Conclusão prática**: para ter Brasil/PT-BR de fato, é necessário o plano **Premier pago**,
    com contrato comercial — não é algo acessível no ambiente de pesquisa atual sem credenciais.
    Não inventamos credenciais; nenhuma POC de chamada real foi feita contra a FatSecret nesta
    fase.
- **Cache/armazenamento**: Basic/Premier Free e Premier (com atribuição) permitem cache conforme
  política de atribuição da FatSecret; o plano Premier sem atribuição permite uso white-label.
  Os termos exatos de retenção/cache precisam ser confirmados no contrato antes de produção.
- **Autenticação**: OAuth 2.0 (client credentials), chave/segredo emitidos por conta
  desenvolvedor.
- **Risco**: baixo tecnicamente (API madura, documentada, usada por grandes apps de dieta), mas
  com **custo recorrente e dependência de contrato comercial** para cobertura Brasil.

## Open Food Facts (OFF)

- **Cobertura Brasil**: é hoje a melhor fonte aberta de produtos vendidos no Brasil por
  EAN/marca/rótulo, mas é colaborativa — qualidade varia e micronutrientes frequentemente
  faltam.
- **POC real feita nesta fase** (ver `04_search_benchmark.md` para detalhes): consultas diretas
  à API pública (`br.openfoodfacts.org/cgi/search.pl`, sem chave, com `User-Agent`
  identificado) confirmaram:
  - Excelente cobertura de **produtos de marca industrializados** brasileiros (ex.: "Filé De
    Peito De Frango Congelado Sadia", "Requeijão Vigor", macros completos por 100g).
  - Cobertura **fraca e ruidosa para alimentos genéricos/crus/frescos** (ex.: busca por "ovo"
    retornou café, maionese e macarrão antes de qualquer ovo; busca por "abacate" retornou
    majoritariamente produtos de whey com "abacate" no nome, não a fruta).
  - Sem ranking por relevância aparente — resultados não priorizam o alimento genérico mais
    óbvio.
  - **Rate limiting agressivo** em chamadas sequenciais rápidas sem chave (múltiplos `429`/corpo
    vazio mesmo com 1.5s de intervalo) — uso em produção exigiria mirror local via exports
    JSONL, não chamadas diretas à API de busca.
- **API**: leitura aberta, sem chave, só exige `User-Agent` identificando o app. Chamadas de
  escrita (contribuição) exigem conta.
- **Licença**: **ODbL** (Open Database License) para os dados, **DbCL** para conteúdo individual,
  **CC-BY-SA** para imagens. Exige:
  - **Atribuição** visível e com link para Open Food Facts/licença.
  - **Share-alike**: se os dados da OFF forem combinados com outra base, a base resultante
    **deve ser liberada como dado aberto também** — isto é incompatível por padrão com misturar
    diretamente no banco proprietário do AJ Fit sem isolamento.
- **Mitigação de risco de licença**: manter dados OFF em uma coleção/tabela própria, com
  proveniência clara e isolada do catálogo proprietário (TACO/TBCA/manual), evitando fusão que
  acionaria a obrigação de share-alike sobre a base combinada.

## USDA FoodData Central (comparação/fallback)

- Gratuito, domínio público, ~250 mil alimentos (genéricos + marca, só EUA).
- Útil como fallback técnico/comparação de arquitetura, mas sem dados brasileiros/PT-BR —
  não resolve o problema de cobertura nacional.

## Edamam (comparação/fallback)

- Pago (ex.: Nutrition Analysis API a partir de ~US$49/mês escalando; Food & Grocery Database até
  ~US$799/mês), 615 mil+ UPCs + 10 mil alimentos genéricos.
- Sem foco regional Brasil/PT-BR confirmado na pesquisa; tratado apenas como referência de
  arquitetura/preço, não como candidato forte.

## Resumo comparativo

| Fonte | Tamanho/cobertura BR | Genérico vs marca | PT-BR nativo | API oficial | Licença | Custo |
|---|---|---|---|---|---|---|
| TACO | ~519 itens, defasado | genérico | sim | não (estático) | domínio público de fato | zero |
| TBCA | 5.700+ itens, atual | genérico + preparações | sim | não (scraping apenas) | atribuição obrigatória, comercial proibido sem permissão | zero (uso) / requer acordo p/ comercial |
| FatSecret | 2,3M+ itens globais, BR via Premier | ambos | sim (region=BR) | sim, REST/OAuth2 | proprietária, contrato | grátis só EUA; BR exige Premier pago |
| Open Food Facts | Forte em marca BR, fraco em genérico | majoritariamente marca | parcial (nomes de produto em PT, mas ranking fraco p/ genérico) | sim, aberta, sem chave | ODbL + share-alike | zero |
| USDA (fallback) | EUA apenas | ambos | não | sim | domínio público | zero |
| Edamam (fallback) | Global, sem foco BR confirmado | ambos | não confirmado | sim | proprietária | pago, caro |
