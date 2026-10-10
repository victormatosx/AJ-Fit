# C1 — Recomendação final

## Estratégias avaliadas

- **A) TACO + TBCA local** — cobertura boa de genéricos/preparações BR, zero custo recorrente,
  mas **bloqueada por risco jurídico da TBCA** (reprodução/comercialização proibidas sem acordo)
  e **sem produtos de marca** — não resolve a dor original (frango industrializado, whey,
  produtos de marca).
- **B) TACO + TBCA + FatSecret BR** — cobertura mais completa (genérico + marca), mas depende de
  **contrato comercial pago** com a FatSecret e **ainda carrega o risco jurídico da TBCA**.
- **C) TACO + TBCA + Open Food Facts** — zero custo adicional de API, mas **carrega risco
  jurídico da TBCA** e **risco de licença share-alike da OFF** se não isolada corretamente; OFF
  sozinha é fraca em genéricos (confirmado no benchmark).
- **D) TACO + TBCA + FatSecret BR + Open Food Facts** — cobertura máxima, mas acumula os dois
  riscos (jurídico TBCA + comercial FatSecret) e a maior complexidade de manutenção.

## Recomendação

**Para a Fase C2 (produção), recomendo a estratégia C, com um ajuste de sequenciamento:**

**C2 fase 1 — TACO + Open Food Facts**, sem TBCA ainda:
- Resolve a parte de maior dor relatada (produtos de marca, industrializados, frango/carnes de
  marca) com **custo zero** e **sem bloqueio jurídico** (basta isolamento arquitetural + atribuição
  corretos, conforme `05_licensing_and_storage.md`).
- TACO continua cobrindo genéricos/crus com qualidade conhecida e já em produção.

**C2 fase 2 (condicional) — adicionar TBCA**, **somente após** contato formal com
`tbca.contato@usp.br` e autorização explícita de uso comercial. Se a permissão vier, TBCA deve
substituir/complementar TACO tanto no catálogo de geração quanto no de registro, pois é
estritamente superior em cobertura e atualidade.

**FatSecret fica como avaliação separada de C3+**, condicionada a uma decisão de negócio sobre
custo recorrente — tecnicamente é a peça que fecharia a lacuna de genéricos+marca numa única
fonte com SLA, mas exige orçamento e contrato que não cabem nesta fase de arquitetura.

### Por que não D agora
Acumular FatSecret + OFF + TBCA simultaneamente na primeira iteração maximiza a superfície de
risco (jurídico + comercial + manutenção de 3 pipelines de sync) antes de validar se
TACO+OFF já resolve a maior parte da demanda real de busca dos usuários. Prefiro habilitar menos
fontes primeiro, medir gaps reais de busca em produção, e só então justificar o custo/risco de
TBCA/FatSecret.

### Considerações de peso na decisão
- **Cobertura**: OFF cobre bem marca, TACO cobre bem genérico — a combinação já cobre a maior
  parte dos ~49 termos do benchmark.
- **Qualidade**: TACO é mais confiável que OFF para itens genéricos (curado vs. colaborativo).
- **Custo**: C2-fase-1 é zero custo recorrente.
- **Latência**: OFF é uma API externa; mitigar com cache local pós-primeiro-uso (ver
  `06_federated_search_architecture.md`).
- **Dependência externa**: só OFF nesta primeira fase — risco de rate limit/indisponibilidade
  mitigado pelo cache local e fallback silencioso para resultados locais.
- **Licença**: TACO é zero risco; OFF é gerenciável com isolamento; TBCA é a única com risco
  jurídico real pendente.
- **Manutenção**: um pipeline de sync (OFF) é mais simples de operar que dois ou três.
- **Contexto brasileiro**: TACO+OFF juntos cobrem tanto a cultura alimentar brasileira (TACO)
  quanto o mercado de produtos de marca local (OFF tem boa cobertura de marcas brasileiras, como
  visto no benchmark: Sadia, Vigor, Yoki, Piracanjuba).

---

# Respostas diretas

## A. Estado atual do catálogo
Catálogo único (`nutritionFoods`), ~519 itens TACO, usado tanto para geração de dieta quanto para
busca/registro do usuário, sem separação arquitetural entre os dois usos. Busca é Firestore
prefix-array-contains, sem ranking de relevância. Sem barcode, sem produtos de marca.

## B. Principais limitações
Conflação de `generationStatus` (segurança de IA) com visibilidade de busca; ausência de campo
`barcode`; busca não escala para catálogo grande/rico em marca; `catalogVersion` com filtro
exato só na geração, criando divergência latente busca-vs-geração; taxonomia de categoria
pensada para geração, não para consumo; ausência de metadado de licença/proveniência detalhado.
Detalhe completo em `01_current_state.md` §9.

## C. Cobertura estimada de cada fonte
TACO: ~519 itens, genéricos BR, defasado (2011). TBCA: 5.700+ itens incluindo 4.000+
preparações, melhor fonte para contexto BR, mas sem API e com restrição de uso comercial.
FatSecret: 2,3M+ itens globais, BR incluído só no plano Premier pago. Open Food Facts: forte em
produtos de marca BR (confirmado em teste real), fraco/ruidoso em genéricos.

## D. Resultado do benchmark
Testado ao vivo apenas Open Food Facts (sem credenciais para FatSecret, sem scraping de TBCA por
risco legal). OFF confirma o padrão esperado: ótimo para produtos industrializados de marca
(Sadia, Vigor, Yoki, Piracanjuba), ruim para alimentos genéricos/crus (ex.: "ovo" retorna café e
maionese antes de ovo; "abacate" retorna majoritariamente produtos de whey). Ver
`04_search_benchmark.md` para a tabela completa.

## E. Licença/storage de cada fonte
Matriz completa em `05_licensing_and_storage.md`. Resumo: TACO e USDA sem restrição relevante;
Open Food Facts exige atribuição + isolamento para evitar share-alike sobre o banco todo; TBCA
proíbe reprodução/comercialização sem acordo formal (risco alto, pendente de contato jurídico);
FatSecret exige contrato pago para cobertura Brasil.

## F. Modelo canônico recomendado
Duas coleções: `nutritionFoods` (geração, inalterado) e `foodLogCatalog` (registro, novo),
reaproveitando o esquema de ID por hash e o tipo de valores nutricionais já existentes, mas sem
`generationStatus` — substituído por `qualityFlags` não bloqueantes e `provenance.license`
explícito. Detalhes em `03_canonical_model.md`.

## G. Arquitetura de busca recomendada
Busca federada em camadas (favoritos → custom foods → catálogo local amplo → fonte externa
paga opcional → Open Food Facts/barcode → criar alimento), com dedup por barcode (não por nome),
cache local de itens externos usados, timeout curto por fonte e fallback silencioso para
resultados locais. Detalhes em `06_federated_search_architecture.md`.

## H. Fonte principal recomendada
**Open Food Facts**, para cobrir a lacuna de produtos de marca/industrializados com custo zero e
risco de licença gerenciável via isolamento arquitetural.

## I. Fonte complementar recomendada
**TACO, mantido como está** para genéricos/crus, com **TBCA como upgrade condicional** assim que
houver autorização comercial formal da USP/FoRC. FatSecret fica como opção futura condicionada a
orçamento.

## J. O que exatamente deve ser feito na Fase C2
1. Enviar contato formal a `tbca.contato@usp.br` perguntando sobre uso comercial/licenciamento
   (ação de produto/jurídico, não de engenharia).
2. Implementar a coleção `foodLogCatalog` e o pipeline de import/sync a partir do Open Food
   Facts (exports JSONL, não polling de API de busca), com isolamento de proveniência e
   atribuição na UI.
3. Trocar o mecanismo de busca de Firestore prefix-match para um índice dedicado (Algolia ou
   Typesense) alimentado por Cloud Function on-write, mantendo Firestore como fonte de verdade.
4. Implementar busca federada em camadas conforme `06_federated_search_architecture.md`,
   começando sem FatSecret (placeholder de camada, desativada até haver contrato).
5. Decidir, como decisão de negócio separada (não técnica), se vale contratar FatSecret Premier
   para fechar a lacuna restante — recomendo revisitar isso só depois de medir gaps reais de
   busca pós-lançamento do Open Food Facts.

## K. Arquivos criados/alterados
Apenas documentação, nenhum código:
- `docs/nutrition/catalog-expansion/01_current_state.md`
- `docs/nutrition/catalog-expansion/02_sources_comparison.md`
- `docs/nutrition/catalog-expansion/03_canonical_model.md`
- `docs/nutrition/catalog-expansion/04_search_benchmark.md`
- `docs/nutrition/catalog-expansion/05_licensing_and_storage.md`
- `docs/nutrition/catalog-expansion/06_federated_search_architecture.md`
- `docs/nutrition/catalog-expansion/07_recommendation.md` (este arquivo)

## L. Confirmação
- Nenhum commit foi feito.
- Nenhum push foi feito.
- Nenhuma integração de produção foi ativada. A única atividade externa real realizada foi uma
  série de consultas de leitura (GET) à API pública do Open Food Facts, sem chave, com
  User-Agent identificado, sem persistir nenhum dado retornado em banco — usadas apenas para
  compor o benchmark acima. Nenhuma chamada foi feita à FatSecret (sem credenciais) e nenhum
  scraping foi feito contra a TBCA (por risco de violar os termos de uso).
