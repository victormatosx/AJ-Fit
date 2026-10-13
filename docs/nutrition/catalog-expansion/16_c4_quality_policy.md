# C4 — política final de qualidade

## Princípio

O catálogo preserva o valor declarado pela fonte. O audit nunca recalcula ou substitui macros. Flags são evidência para visibilidade e manutenção, não autorização para “corrigir” rótulos.

## Status

- `active`: pode aparecer na busca e ser registrado.
- `hidden`: falha severa determinística de qualidade; preservado para auditoria/referências, excluído da busca.
- `deprecated`: desapareceu ou deixou de passar no snapshot oficial mais recente; preservado para referências e histórico, excluído da busca.

Um item que reaparece válido em refresh posterior pode voltar a `active`. Itens nunca são apagados pelo refresh.

## Severidade

Warnings, sem bloqueio automático:

- `KCAL_MACRO_MISMATCH`;
- `UNUSUAL_KCAL_FOR_CATEGORY`;
- `INVALID_BARCODE_FORMAT`.

Severos, elegíveis a `hidden` apenas com `--apply-hidden <FLAG> --confirm`:

- `ZERO_KCAL_WITH_MACROS`;
- `MACRO_SUM_EXCEEDS_PHYSICAL_LIMIT`;
- `NEGATIVE_NUTRIENT_VALUE`;
- `IMPLAUSIBLE_NUTRIENT_VALUE`;
- `SUSPECT_NAME` (sem qualquer letra Unicode ou curto demais).

O import OFF também rejeita energia zero com macros materiais, evitando reincidência. Letras Unicode são válidas; nomes CJK não são tratados como corruptos apenas por não serem latinos.

## Tolerância energética

A estimativa base usa 4 kcal/g de proteína, 4 kcal/g de carboidrato e 9 kcal/g de gordura. Fibra admite aproximadamente 2 kcal/g. Como o modelo não guarda álcool nem poliálcoois e rótulos variam quanto à inclusão de fibra em carboidratos, o warning é assimétrico:

- abaixo: diferença maior que `max(80 kcal, 40% da estimativa)`;
- acima: diferença maior que `max(120 kcal, 60% da estimativa com fibra)`.

Isso reduziu mismatch falso-positivo de 1.795 para 1.133 sem transformar a checagem em gate de import. A categoria de baixa energia só gera warning acima de 350 kcal/100 g em item sem marca.

## Resultado real

Audit read-only refinado sobre 23.606 documentos:

- 1.161 documentos com ao menos uma flag;
- 1.133 `KCAL_MACRO_MISMATCH`, todos OFF;
- 24 `ZERO_KCAL_WITH_MACROS`, OFF;
- 12 `UNUSUAL_KCAL_FOR_CATEGORY` (8 TACO, 4 OFF);
- 1 `MACRO_SUM_EXCEEDS_PHYSICAL_LIMIT`, OFF;
- zero nomes inválidos após aceitar letras Unicode.

Aplicação explícita feita na C4:

- 24 itens de energia zero passaram para `hidden`;
- o item de soma física impossível já estava `hidden` desde C3;
- total final `hidden`: 25;
- nenhum dos 1.133 mismatches foi ocultado;
- nenhum macro foi alterado.

O refresh oficial classificou ainda 19 ativos antigos como `deprecated`: 18 já não passam no gate atual e 1 não existe no snapshot completo. Total final `deprecated`: 19.

