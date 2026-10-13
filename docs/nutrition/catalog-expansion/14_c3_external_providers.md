# C3 — providers externos e próximos passos

## FatSecret

Não há credenciais FatSecret no repositório nem nas variáveis de ambiente desta execução. A C3
não inventa chaves e não bloqueia por isso.

Para uma integração brasileira futura será necessário contratar/confirmar acesso Premier com
localização `region=BR` e idioma `pt`. O endpoint de busca v5 é
`GET https://platform.fatsecret.com/rest/foods/search/v5` (OAuth 2, scope Premier, até 50 itens
por página), com alimentos genéricos/de marca e servings/macros. Lookup por barcode existe em
`/rest/food/barcode/find-by-id/v2`. A política de persistência deve ser revisada no contrato;
a documentação do search limita o que pode ser armazenado a IDs permitidos.

Referências oficiais:

- <https://platform.fatsecret.com/docs/guides/localization>
- <https://platform.fatsecret.com/docs/v5/foods.search>
- <https://platform.fatsecret.com/docs/v2/food.find_id_for_barcode>

O encaixe já existe em `FoodSearchProvider`: implementar um provider `fatsecret`, mapear a
resposta para o resultado canônico e, só então, compor local + externo atrás da mesma interface.
As telas não precisam ser reescritas. Credenciais devem permanecer no backend; o app cliente não
deve receber o secret OAuth.

## TBCA

`tbcaAdapter.ts` é somente scaffold e foi validado exclusivamente com fixtures sintéticos.
Nenhum download, scraping, import ou persistência TBCA foi feito. O uso comercial continua
dependente de autorização/licença explícita USP/FoRC; até isso ocorrer, a fonte deve permanecer
desabilitada.

## C4

1. obter decisão contratual/licença para FatSecret BR e/ou TBCA;
2. cobrir `multivitamínico` com uma fonte válida, não com alias aproximado;
3. automatizar refresh nightly OFF com staging, diff, checkpoint e política de depreciação;
4. revisar amostras dos flags de kcal e melhorar thresholds por categoria sem reescrever macros;
5. medir p95/reads/custo em telemetria real e só avaliar motor externo com evidência de degradação;
6. considerar typo tolerance/semântica após preservar o contrato e o ranking determinístico;
7. alimentar `recentIds` a partir do diário recente quando houver requisito de produto explícito.
