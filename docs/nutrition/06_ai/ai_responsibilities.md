# AJ Fit Nutrition — Responsabilidades da IA

## 1. Pode fazer

A IA pode:

- combinar alimentos aprovados em refeições;
- gerar 2 ou 3 opções por refeição;
- escolher a opção principal;
- respeitar preferências e alimentos habituais;
- variar refeições;
- gerar nova opção de refeição;
- interpretar feedback simples e estruturado;
- sugerir alimentos dentro do subconjunto permitido.

---

## 2. Não pode fazer

A IA não pode:

- calcular RMR;
- calcular TDEE;
- escolher déficit ou superávit;
- calcular metas de proteína, gordura, carboidratos ou fibras;
- alterar metas do Nutrition Engine;
- decidir limites de segurança;
- ignorar safety gates;
- inventar nutrientes;
- inventar alimentos;
- usar alimentos fora do catálogo permitido;
- usar alimentos com status diferente de `approved`;
- ignorar exclusões alimentares;
- criar dieta para usuário bloqueado por eligibility gate.

---

## 3. Autoridades

### Nutrition Engine
Autoridade para metas e segurança determinística.

### Food Catalog
Autoridade para composição nutricional e classificação dos alimentos.

### AI
Autoridade apenas para composição textual/estrutural da recomendação dentro das restrições fornecidas.

### Validator
Autoridade final para aceitar ou rejeitar a saída antes da persistência.

---

## 4. Regra de conflito

Se a resposta da IA conflitar com engine, catálogo ou safety:

**a IA perde sempre**.

---

## 5. Preferências aprendidas

Feedback persistente deve virar dado estruturado.

Exemplo:

`user dislikes oatmeal`

não deve depender de histórico de conversa.

Deve virar preferência/restrição estruturada e ser aplicada em gerações futuras.
