# AJ Fit Nutrition — Alergias e Restrições Alimentares

## 1. Modelo da V1

O usuário não precisa diferenciar:

- não gosto;
- intolerância;
- alergia;
- restrição pessoal.

Tudo entra em uma lista única de exclusão rígida.

---

## 2. Hard exclusions

```text
excludedFoodIds
```

Significa:

**não utilizar este alimento em nenhuma recomendação**.

Não existe exceção baseada em macro ou preferência da IA.

---

## 3. Segunda camada: alergênicos

O catálogo mantém alergênicos estruturados.

Exemplos conceituais:

- milk;
- egg;
- peanut;
- tree_nuts;
- soy;
- wheat;
- fish;
- shellfish.

A lista final deve acompanhar a taxonomia definida no catálogo.

---

## 4. Propagação

Quando um alimento/produto contém ingrediente ou alergênico relacionado a uma restrição conhecida:

- remover dos candidatos;
- rejeitar caso apareça na resposta da IA.

Isso evita depender apenas de match exato por `foodId`.

---

## 5. Produtos industrializados

Para permitir bloqueio seguro, produtos industrializados devem armazenar, quando disponível:

- ingredientes relevantes;
- alergênicos;
- traços/avisos quando a fonte trouxer essa informação.

---

## 6. Dados incompletos

Se composição ou alergênicos não forem conhecidos:

- não inventar;
- não classificar como seguro por inferência livre da IA.

Produtos de dados incompletos podem receber status que impeça uso automático na geração.

---

## 7. Diário alimentar

O usuário pode registrar livremente o que consumiu.

O diário representa realidade, não recomendação.

Portanto, o sistema pode permitir registrar alimento excluído se foi de fato consumido.

Isso não significa que o alimento passa a ser elegível para recomendação.

---

## 8. Alteração de restrição

Se o usuário adicionar nova exclusão e o plano ativo contiver esse alimento:

- identificar conflito;
- informar quais refeições foram afetadas;
- recomendar nova geração;
- não alterar o plano silenciosamente.
