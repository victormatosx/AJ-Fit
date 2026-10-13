# AJ Fit Nutrition — Regras de Geração do Plano

## 1. Objetivo

Definir o contrato funcional para a IA gerar o plano alimentar recomendado.

---

## 2. Entrada

A geração recebe:

- Nutrition Engine Output;
- slots de refeição escolhidos pelo usuário;
- padrão alimentar;
- alimentos preferidos;
- alimentos habituais;
- alimentos excluídos;
- preferência por repetição ou variedade;
- catálogo aprovado para geração.

---

## 3. Saída esperada

Para cada refeição:

- 2 ou 3 opções;
- uma opção marcada como principal;
- somente alimentos `approved`;
- quantidades em gramas;
- alimentação compatível com todas as restrições;
- metas da refeição dentro das tolerâncias.

---

## 4. Regra de recomendação

O plano é apenas uma recomendação.

A geração não deve assumir que o usuário irá seguir exatamente os alimentos ou quantidades propostas.

A arquitetura deve permitir comparar posteriormente o recomendado com o consumido.

---

## 5. Alimentos

A IA não pode:

- inventar alimentos;
- usar alimentos bloqueados;
- usar alimentos próprios do usuário na geração automática da V1;
- ignorar `excludedFoodIds`;
- redefinir macros do catálogo.

---

## 6. Preferências

A IA deve:

- priorizar alimentos que o usuário gosta;
- priorizar alimentos habituais quando fizer sentido;
- respeitar a preferência por repetição ou variedade;
- nunca tratar preferência positiva como obrigação absoluta.

---

## 7. Opções equivalentes

As opções de uma mesma refeição devem ficar próximas da meta nutricional daquela refeição.

Não é necessário que sejam numericamente idênticas.

Todas passam pelo validador determinístico.

---

## 8. Opção principal

A IA deve escolher uma opção principal com base em:

- aderência às preferências;
- simplicidade;
- adequação nutricional;
- alimentos habituais;
- coerência com o padrão alimentar.

A escolha da opção principal não altera as metas nutricionais.

---

## 9. Validação

Após geração:

1. resolver todos os IDs;
2. recalcular nutrientes pelo catálogo;
3. verificar restrições;
4. verificar tolerâncias;
5. corrigir quantidades quando possível;
6. rejeitar/regenerar quando necessário.

---

## 10. Escopo V1

Não gerar:

- receitas prontas;
- lista de compras;
- cardápio diferente por dia;
- estratégia pré/pós-treino;
- diferenciação treino/descanso.
