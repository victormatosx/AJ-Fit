# AJ Fit Nutrition — Substituições de Alimentos

## 1. Princípio

A V1 não terá mapa manual canônico de substituições.

A IA pode sugerir candidatos.

O backend decide se o candidato é aceitável.

---

## 2. Fluxo

`alimento original -> IA sugere candidato -> engine valida -> engine calcula quantidade -> usuário confirma`

---

## 3. Critérios de validação

Uma substituição deve considerar:

1. restrições do usuário;
2. padrão alimentar;
3. categoria/função na refeição;
4. proximidade de macros;
5. plausibilidade da quantidade;
6. impacto na refeição inteira;
7. impacto nas metas diárias.

---

## 4. Categoria e função

Não basta comparar calorias.

Exemplo:

150 g de arroz não deve ser substituído automaticamente por qualquer alimento com calorias parecidas.

A substituição deve preservar função alimentar razoável.

---

## 5. Cálculo da quantidade

A IA não define a quantidade final de forma autoritativa.

O engine ajusta a quantidade para aproximar:

- energia;
- carboidratos;
- proteína;
- gordura;

conforme a função do alimento original.

---

## 6. Restrições

Eliminar qualquer candidato que:

- esteja em `excludedFoodIds`;
- viole vegan/vegetarian;
- possua alergênico incompatível;
- não esteja approved;
- seja alimento próprio do usuário quando a operação exigir catálogo global.

---

## 7. Correção da refeição

Após substituir:

1. recalcular a refeição;
2. recalcular o dia;
3. ajustar quantidade se necessário;
4. rejeitar se não for possível manter tolerâncias aceitáveis.

---

## 8. Escolha do usuário

Quando possível, apresentar múltiplas opções.

O usuário escolhe qual substituir.

A troca não deve ocorrer silenciosamente.

---

## 9. Receitas

Na V1, substituição dentro de receita deve ser tratada separadamente.

Alterar ingrediente de receita exige recalcular a receita inteira.

---

## 10. Observabilidade

Registrar:

- alimento original;
- candidatos;
- candidato escolhido;
- motivo de rejeição;
- quantidade antes/depois;
- impacto em macros.

Isso será útil para melhorar prompts e regras sem criar mapa manual.
