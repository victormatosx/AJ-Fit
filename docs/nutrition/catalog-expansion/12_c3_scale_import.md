# C3 — importação em escala e qualidade

## Fonte e decisão

A origem é o export nightly oficial da Open Food Facts, sem scraping e sem polling da Search
API. O JSONL oficial completo tem aproximadamente 13,1 GB. A extração interrompida herdada
continha 36.733 linhas/552 MB, mas como o dump é ordenado por barcode ela parou antes do bloco
brasileiro `789...` e não era uma amostra representativa.

O mesmo export oficial também é oferecido como CSV compactado. Foi usado
`en.openfoodfacts.org.products.csv.gz` (1.275.171.186 bytes), processado em streaming. A decisão
foi a estratégia C: preservar a C2 e somar o subconjunto BR completo e validado do export oficial.

Referência da fonte: <https://world.openfoodfacts.org/data>.

## Yield medido

| Métrica | Quantidade |
|---|---:|
| linhas globais lidas | 4.535.553 |
| registros marcados como Brasil | 34.109 |
| com nome | 32.422 |
| com kcal | 26.172 |
| com proteína | 24.764 |
| com carboidrato | 25.446 |
| com gordura | 24.274 |
| com os quatro valores centrais | 23.560 |
| aceitos pelo quality gate | 23.067 |
| rejeitados | 11.042 |
| taxa de aceitação sobre Brasil | 67,63% |
| barcodes duplicados no subset | 0 |
| erros de parse/normalização | 0 |

Rejeições: 9.119 macros incompletos; 1.683 nomes ausentes/inválidos; 147 nutrientes implausíveis;
58 soma de macros fisicamente impossível; 23 nomes sem letras; 12 barcodes ausentes/inválidos.
Nenhum macro foi corrigido silenciosamente.

Como contraste, o arquivo JSONL parcial aceitava apenas 1/36.733 registros. Ele não foi usado
para decidir o yield nem para escrever o catálogo.

## Execução e segurança operacional

O import é streaming, usa chunks e batches limitados, deduplica por barcode/source ID e mantém
checkpoint com path, tamanho, mtime, versão e linha processada. IDs são determinísticos, writes
são comparados com o documento existente e o metadata singleton é escrito somente após o fim.
A retomada após interrupção reconheceu 2.356 documentos já escritos como `unchanged`.

Plano antes da escrita: 22.257 creates, 810 updates, 0 unchanged; 20 itens OFF legados da C2
seriam preservados. Após o import, um backfill idempotente adicionou metadata C3 nesses 20 itens.
Um novo dry-run completo contra o estado final retornou 0 creates, 0 updates e 23.067 unchanged.

## Estado final

| Fonte | Documentos |
|---|---:|
| TACO | 519 |
| Open Food Facts | 23.087 |
| total físico/meta | 23.606 |
| ativos/pesquisáveis | 23.605 |
| hidden | 1 |

O audit read-only encontrou 1.836 documentos com ao menos uma flag: 1.795
`KCAL_MACRO_MISMATCH` (OFF), 24 `ZERO_KCAL_WITH_MACROS` (OFF), 26
`UNUSUAL_KCAL_FOR_CATEGORY` (8 OFF/18 TACO), 4 `SUSPECT_NAME` (OFF) e 1
`MACRO_SUM_EXCEEDS_PHYSICAL_LIMIT` (OFF legado). Mismatch de Atwater permanece somente como
sinal de revisão, pois pode refletir fibra/polióis/arredondamento.

Depois do relatório read-only, somente o item legado `Amendoim Salgado`
(`flc_off_7896336012250_fbe3f6cad83f47c2`) foi marcado `hidden`, usando a flag severa e
determinística de soma física impossível. Seus macros não foram alterados. Os demais flags não
foram escondidos automaticamente.
