# C2 — Resultados reais de import

Executado em produção de teste: projeto `ajfit-2f321` (autorizado como ambiente de teste atual
pelo brief da C2, via `--allow-current-test-project ajfit-2f321`). Rules e índices já deployados
antes do import.

## TACO

```
npm run nutrition:food-log:taco-import -- --confirm --project ajfit-2f321 --allow-current-test-project ajfit-2f321
```

```json
{"mode":"WRITE","sourceType":"taco","catalogVersion":"food-log-taco-4a-edicao-2011-v1","accepted":519,"rejected":0}
{"created":519,"updated":0,"unchanged":0}
```

- **519/519 registros aceitos**, 0 rejeitados — o dataset TACO já era limpo o suficiente (foi
  validado uma vez na C1/geração; reaproveitar o mesmo validador de nutrição confirma isso).
- Importante: isso inclui os **461 registros que estão `pending_review` para geração de IA** (sem
  `allergens`/`dietaryFlags` revisados) — no catálogo de registro eles entram normalmente como
  `status: 'active'`, porque faltar revisão de alergênico não impede logging, só geração
  (decisão explícita do brief da C2, Parte 4).

## Open Food Facts

```
npm run nutrition:food-log:off-fetch -- --out scripts/nutrition/sources/off-brazil-raw.json --pages 30 --page-size 100 --delay-ms 7000
npm run nutrition:food-log:off-import -- --confirm --project ajfit-2f321 --allow-current-test-project ajfit-2f321
```

```json
{"fetched":1000,"qualityRejected":170,"normalizeRejected":0,"accepted":830}
{"mode":"WRITE","sourceType":"off","catalogVersion":"food-log-off-brazil-v1","accepted":830,"rejected":170}
{"created":830,"updated":0,"unchanged":0}
```

### Teto de coleta real — por que só 1.000 produtos

A busca v2 da Open Food Facts (`world.openfoodfacts.org/api/v2/search`, sem chave, só
`User-Agent` identificado) funcionou nas primeiras ~10 páginas (1.000 produtos, com `503`s
ocasionais absorvidos por retry/backoff — consistente com o que a C1 já havia observado). Depois
disso, o servidor passou a responder **`401`** de forma sustentada, inclusive em uma segunda
tentativa após ~10 minutos de espera. Isso é consistente com um bloqueio temporário por
volume/IP, não um erro transitório — **decidi não insistir** (trocar User-Agent, IP, etc. seria
contornar um bloqueio deliberado do provedor, o que não é apropriado). O resultado: 1.000
produtos brutos coletados, 830 aceitos após o filtro de qualidade.

Isso confirma, na prática, a conclusão já antecipada na C1
(`02_sources_comparison.md`): a API de busca ao vivo da OFF não é confiável para ingestão em
volume "milhares/dezenas de milhares" — **produção real precisa usar os exports oficiais em
massa (JSONL/CSV)** da OFF (`world.openfoodfacts.org/data`), não a API de busca paginada. Fica
como ação explícita de C3 (ver `07_recommendation.md`/seção "O que fazer na C2" desta mesma
pasta).

### Motivos de rejeição (170 de 1.000)

| Motivo | Descrição |
|---|---|
| `INCOMPLETE_MACROS` | maioria dos rejeitados — produto sem kcal/proteína/carboidrato/gordura por 100g simultaneamente preenchidos |
| `MISSING_OR_INVALID_NAME` | nome vazio ou com menos de 2 caracteres úteis |
| `NEGATIVE_NUTRIENT_VALUE` / `IMPLAUSIBLE_NUTRIENT_VALUE` / `IMPLAUSIBLE_FIBER_VALUE` | não ocorreram nesta amostra, mas os testes unitários (`offQualityFilter.test.ts`) cobrem cada caso |
| `DUPLICATE_BARCODE_IN_BATCH` | não ocorreu nesta amostra (OFF não retornou o mesmo código de barras duas vezes nas 10 páginas) |

Todos os critérios são determinísticos (sem IA), implementados em
`src/nutrition/foodLog/offQualityFilter.ts` e cobertos por 8 testes unitários.

## Total no catálogo de registro (`foodLogCatalog`)

**1.349 alimentos** (519 TACO + 830 Open Food Facts), todos com `status: 'active'`, todos com
`nutritionPer100g` completo (kcal/proteína/carboidrato/gordura; fibra nullable quando ausente na
fonte).

Isso fica abaixo da meta "dezenas de milhares" do gate da Parte 16 — explicitamente porque a meta
é qualificada por "conforme ingestão segura disponível", e o teto real desta fase foi o
rate-limit/bloqueio da OFF, não uma limitação do pipeline (o pipeline é paginado, com checkpoint,
e aceitaria rodar por muito mais páginas se a fonte permitisse). Ver `07_recommendation.md` para
o plano de C3 (exports oficiais da OFF).

## `foodLogCatalogMeta/current` (resultado real)

```json
{
  "schemaVersion": 1,
  "sourceVersions": { "taco": ["4a-edicao-2011"], "off": ["food-log-off-brazil-v1"] },
  "sourceCounts": { "taco": 519, "off": 830 },
  "rejectedCounts": { "taco": 0, "off": 170 },
  "importedRecordCount": 1349
}
```
