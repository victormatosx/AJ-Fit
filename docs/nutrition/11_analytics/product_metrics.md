# AJ Fit Nutrition — Métricas de Produto

## 1. Métricas principais

As duas métricas principais da V1 são:
1. usuários que registram refeições;
2. usuários ativos semanalmente em Nutrição.

A leitura de sucesso deve combinar as duas.

## 2. WAU de Nutrição

Definição sugerida:
usuário único que, na semana, realiza pelo menos uma ação relevante de Nutrição.

Ações relevantes:
- abrir plano;
- registrar refeição;
- criar alimento;
- criar receita;
- abrir resumo semanal;
- trocar refeição.

Evitar contar apenas abertura passiva da aba como atividade principal.

## 3. Logging Active Users

Métrica:
`Nutrition Logging WAU`

Usuários únicos que registraram pelo menos uma refeição na semana.

## 4. Dias registrados por semana

Distribuição:
- 0 dias;
- 1–2 dias;
- 3–4 dias;
- 5–6 dias;
- 7 dias.

Essa métrica é mais útil do que um score genérico de “aderência”.

## 5. Funil de ativação

Funil recomendado:

```text
abriu Nutrição
-> iniciou Perfil Nutricional
-> concluiu Perfil Nutricional
-> solicitou geração
-> plano gerado
-> abriu plano
-> registrou primeira refeição
-> registrou em segundo dia distinto
```

O segundo dia de registro ajuda a separar curiosidade de adoção.

## 6. Conversões principais

Acompanhar:
- `% tab open -> profile started`
- `% profile started -> profile completed`
- `% profile completed -> plan requested`
- `% plan requested -> plan generated`
- `% plan generated -> plan opened`
- `% plan opened -> first meal logged`
- `% first meal logged -> second distinct logged day`

## 7. Uso do plano recomendado

Medir:
- refeições registradas usando opção recomendada;
- refeições registradas livremente;
- distribuição entre ambas.

Isso não vira “nota de aderência”.

## 8. Uso de alternativas

Acompanhar:
- pedidos de nova opção por plano ativo;
- taxa de aceitação;
- taxa de rejeição;
- refeições com mais pedidos de alternativa;
- motivo categorizado.

## 9. Alimentos próprios

Acompanhar:
- usuários que criam alimento;
- média de alimentos próprios criados;
- percentual de registros usando alimento próprio.

## 10. Receitas

Acompanhar:
- usuários que criam receita;
- receitas criadas por usuário;
- percentual de logs usando receita própria.

## 11. Favoritos

Acompanhar:
- usuários que favoritam;
- favoritos por usuário;
- reutilização de favoritos em planos futuros, quando essa lógica existir.

## 12. Resumo semanal

Acompanhar:
- taxa de abertura;
- recorrência;
- clique vindo de notificação;
- retenção após visualizar resumo semanal.

## 13. Relação com Evolução

Pode-se analisar de forma agregada:
- usuários com registros frequentes de Nutrição;
- usuários que também registram peso;
- frequência conjunta de uso.

Não afirmar causalidade.

## 14. Retenção

Cortes sugeridos:
- D1;
- D7;
- D28;
- W4.

Eventos de retorno devem ser baseados em ações relevantes de Nutrição.

## 15. Métricas a evitar

Evitar transformar em KPI principal:
- número bruto de dietas geradas;
- número bruto de chamadas de IA;
- número de alimentos do catálogo;
- número de telas abertas.

## 16. Métrica norteadora da V1

Sugestão:

`Weekly Nutrition Engaged Users`

Definição:
usuários que, em uma semana, registraram alimentação em pelo menos 2 dias distintos.

Essa métrica combina uso real com recorrência mínima.
