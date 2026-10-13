# C4 — refresh operacional do Open Food Facts

## Fonte e comando

O processo usa o JSONL Brasil produzido do export CSV nightly oficial do Open Food Facts; não usa scraping nem paginação abusiva da search API.

Dry-run obrigatório:

```sh
npm run nutrition:food-log:off-refresh -- \
  --project ajfit-2f321 \
  --input scripts/nutrition/sources/off-brazil-csv.jsonl \
  --full-snapshot
```

Aplicação explícita:

```sh
npm run nutrition:food-log:off-refresh -- \
  --project ajfit-2f321 \
  --input scripts/nutrition/sources/off-brazil-csv.jsonl \
  --catalog-version food-log-off-refresh-AAAA-MM-DD \
  --full-snapshot --confirm \
  --allow-current-test-project ajfit-2f321
```

Não há cron público ativado. O processo está pronto para execução operacional revisada.

## Garantias

- streaming do JSONL de entrada;
- project guard em qualquer write;
- dry-run padrão com relatório e amostras;
- mínimo padrão de 30 mil linhas para aceitar semântica de snapshot completo;
- dedupe por barcode durante a leitura;
- comparação de conteúdo que ignora timestamps/versão para não reescrever todos os itens;
- batches de no máximo 400;
- idempotência: rerun do mesmo snapshot produz zero novos/alterados/deprecados;
- meta escrito uma única vez, após todas as mudanças;
- nenhuma operação em `nutritionFoods`.

## Diff aplicado em 2026-10-09

Entrada oficial Brasil:

- 34.109 linhas;
- 23.043 aceitas pelo gate final;
- 11.066 rejeitadas;
- 0 JSON inválido;
- 0 novo;
- 0 alterado;
- 23.043 sem mudança de conteúdo;
- 18 registros ativos antigos agora rejeitados pela fonte;
- 1 registro ativo antigo ausente do snapshot;
- 25 registros já inativos.

Motivos de rejeição do snapshot:

- 9.119 macros incompletos;
- 1.683 nomes ausentes/inválidos;
- 146 nutrientes implausíveis;
- 57 soma física impossível;
- 26 kcal zero com macros;
- 23 nomes sem letras;
- 12 barcodes ausentes/inválidos.

Após revisão do dry-run, os 19 ativos antigos foram marcados `deprecated`. Nada foi apagado.

## Produto removido ou alterado

- novo válido: criado como `active`;
- conteúdo válido alterado: documento atualizado, identidade preservada;
- reaparecimento válido: volta a `active` e remove metadata de depreciação pelo replace canônico;
- desaparecido do snapshot completo: `deprecated` com razão `missing_from_source`;
- presente, mas reprovado no gate: `deprecated` com razão `source_record_rejected`;
- já `hidden`/`deprecated`: decisão existente não é sobrescrita por ausência;
- diário antigo: snapshot nutricional permanece imutável;
- favorito indisponível: aparece como indisponível e pode ser removido.

## Fontes futuras

FatSecret continua sem credenciais/contrato BR/Premier e não bloqueia C4. Quando autorizado, deve implementar `FoodSearchProvider` e fornecer busca/detalhe por ID com atribuição/limites contratuais; não exige reescrever UI.

TBCA continua somente com adapter testado por fixtures sintéticos. Licença/autorização USP/FoRC permanece pré-condição para download, import ou persistência.

## Próximos passos operacionais

- obter aprovação para agendamento e retenção de relatórios;
- observar hit rate do cache e p95 real de produção sem enviar query raw;
- revisar nomes OFF muito curtos ou pouco descritivos sem inventar dados;
- contratar FatSecret BR/Premier ou autorizar TBCA apenas se gaps reais reaparecerem.

