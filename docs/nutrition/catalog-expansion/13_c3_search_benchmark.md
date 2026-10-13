# C3 — benchmark de busca e performance

Execução real em 2026-10-09 contra `ajfit-2f321`, após o import e após o índice
`status + searchPrefixes(CONTAINS) + searchSourcePriority + __name__` ficar pronto.

## Antes e depois

| Medida | baseline C3 (catálogo C2) | final C3 |
|---|---:|---:|
| catálogo total | 1.349 | 23.606 |
| queries do benchmark expandido | 151 | 151 |
| resultados úteis | 128 | 150 |
| cobertura útil | 84,8% | **99,3%** |
| zero-result rate | 15,2% | **0,7%** |
| prioridade | 22/27 | **27/27** |

O benchmark define resultado útil como a presença, nas cinco primeiras posições, de um item que
casa todos os conceitos relevantes do termo. Ele imprime contagem, fontes e top 5 de cada uma
das 151 consultas.

Cobertura final: carnes/aves 24/24; peixes 8/8; ovos 4/4; laticínios 13/13;
carboidratos 20/20; frutas 16/16; legumes/verduras 8/8; suplementos 7/8;
preparações 15/15; bebidas 7/7; cereais/snacks 8/8; marcas 20/20.

Único gap: **multivitamínico**. Não há resultado no subset BR aprovado. Não foi inserido alias
enganoso nem item de baixa qualidade para fechar artificialmente a métrica.

## Gaps obrigatórios da C2

| Busca | Primeiro resultado final |
|---|---|
| contrafilé / contra filé | Carne, bovina, capa de contra-filé... (TACO) |
| muçarela / mussarela | Mussarela (OFF) |
| tilápia / tilapia | Tilapia Sem Pelé (OFF) |
| frango desfiado | Frango Desfiado (OFF) |
| estrogonofe / strogonoff | Estrogonofe (OFF) |
| ovo | cinco primeiros são itens TACO de ovo real |
| frango | cinco primeiros são itens TACO de frango real |

## Performance remota

- 151 queries, 6.788 reads; média 45 reads/query;
- latência: média 539,3 ms, p50 558 ms, p95 888,9 ms, máximo 1.895,3 ms;
- primeira página de `frango`: uma query, 60 reads, 452,9 ms;
- segunda página: lookup do cursor + query, 61 reads, 751,1 ms;
- a query é limitada a 60 candidatos independentemente do tamanho total.

O teste sintético cobre ranking determinístico de 10.000 candidatos com limite generoso de 3 s,
processamento/dedupe/quality gate de 10.000 produtos com limite de 2 s e pool paginado de 60.
Esses testes são guards de regressão, não números de produção. A medição real acima ainda é
aceitável para Firestore e não justifica migração automática para Algolia/Typesense; p95 e custo
de reads devem continuar monitorados.
