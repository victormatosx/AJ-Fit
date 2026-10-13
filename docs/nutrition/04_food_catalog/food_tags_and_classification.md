# AJ Fit Nutrition — Classificação, Tags e Restrições

## 1. Objetivo

Permitir que o sistema selecione e valide alimentos sem depender da interpretação livre da IA.

---

## 2. Categorias

Todo alimento deve pertencer a uma categoria canônica.

Exemplos:

- protein_source;
- carbohydrate_source;
- fruit;
- vegetable;
- dairy;
- fat_source;
- legume;
- cereal;
- beverage;
- supplement;
- other.

A taxonomia final deve ser pequena e estável.

---

## 3. Vegetarianismo e veganismo

Cada alimento deve informar:

- `vegetarian`;
- `vegan`.

Isso é obrigatório para a V1.

A IA não deve inferir essas propriedades pelo nome.

---

## 4. Alergênicos

O catálogo deve manter alergênicos estruturados.

Exemplos:

- milk;
- egg;
- peanut;
- tree_nuts;
- soy;
- wheat;
- fish;
- shellfish;
- other.

Essa informação serve como camada adicional de segurança.

---

## 5. Alimentos excluídos

Na V1, qualquer item marcado pelo usuário como:

- não gosto;
- não posso consumir;

vira exclusão rígida.

O motivo não precisa ser clínico.

`excludedFoodIds` deve bloquear o alimento em:

- geração;
- regeneração;
- substituição;
- validação.

---

## 6. Dietary flags

A V1 deve possuir pelo menos:

- vegetarian;
- vegan.

Outras tags podem ser adicionadas futuramente.

Evitar criar dezenas de tags sem uso real.

---

## 7. Aliases

Busca deve suportar sinônimos e regionalismos.

Exemplos:

- mandioca;
- aipim;
- macaxeira.

Aliases pertencem ao alimento canônico.

Eles não criam alimentos duplicados.

---

## 8. Idioma

O catálogo da V1 é somente PT-BR.

Internamente, enums e IDs podem seguir o padrão técnico já existente no app.

A camada de apresentação deve ficar desacoplada para internacionalização futura.

---

## 9. Status de geração

Todo alimento global possui status:

- approved;
- pending_review;
- blocked.

Somente `approved` pode ser usado pela IA na geração automática.

---

## 10. Validação

A IA pode sugerir apenas IDs válidos.

Depois da geração, o backend verifica:

- status approved;
- categoria;
- flags dietéticas;
- exclusões;
- alergênicos;
- macros reais.

A resposta da IA nunca é aceita sem essa validação.
