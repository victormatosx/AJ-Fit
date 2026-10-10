# AJ Fit Nutrition — Pipeline de Validação da IA

## 1. Objetivo

Garantir que nenhuma resposta do modelo vire dieta válida sem validação determinística.

---

## 2. Etapa 1 — Structured Output

Validar contra JSON Schema.

Falhas estruturais:

- tentar correção local quando trivial;
- caso contrário, retry.

---

## 3. Etapa 2 — IDs

Verificar que todo `foodId`:

- existe;
- está ativo;
- possui `generationStatus = approved`;
- pertence ao subconjunto permitido.

---

## 4. Etapa 3 — Restrições

Bloquear qualquer opção que viole:

- excludedFoodIds;
- padrão vegetariano/vegano;
- allergen constraints;
- safety constraints.

---

## 5. Etapa 4 — Recalcular nutrientes

Ignorar qualquer macro declarado pelo modelo.

Recalcular tudo usando:

- foodId;
- grams;
- dados canônicos do Food Catalog.

---

## 6. Etapa 5 — Comparar metas

Validar:

- kcal;
- proteína;
- carboidratos;
- gordura;
- fibras;
- meta por refeição;
- meta diária.

---

## 7. Correção determinística

Implementação V1: o validator escala todas as quantidades de uma opção pelo mesmo fator `targetKcal/actualKcal`, arredonda gramas a 0,1 g e aceita apenas fator entre 0,5 e 2 e cada quantidade entre 5 e 1000 g. Recalcula todos os nutrientes e exige passar as faixas de cada refeição; se a proporção de macros continuar errada, não aceita a correção. O total diário usa somente as opções principais. A fibra desconhecida não vira zero para validação da opção.

A seleção limita 48 candidatos, preserva cobertura por categoria de refeição e considera `varietyPreference`. Suplementos só entram se o perfil aceitar whey/protein e o alimento global aprovado estiver explicitamente entre preferidos ou usuais. Alimentos sem fibra ou revisão de alergênicos não entram na geração V1.

Primeira tentativa:

- ajustar gramas;
- preservar os alimentos escolhidos quando possível;
- manter restrições.

Se a correção produzir plano válido, aceitar.

---

## 8. Retry

São no máximo três chamadas no total: inicial e duas repetições. O terceiro attempt usa `gpt-6-astra` somente quando a falha anterior é `AI_SCHEMA_INVALID` ou `AI_MACRO_VALIDATION_FAILED`. Violações de safety/exclusões param imediatamente. O feedback é somente um código técnico.

Se não for possível corrigir:

- chamar novamente o modelo;
- fornecer apenas os motivos de invalidação necessários.

Máximo: **2 retries**.

---

## 9. Fallback para modelo mais forte

Pode ser usado apenas quando:

- modelo principal repetidamente falhar em validação;
- erro não for causado por input impossível;
- custo estiver dentro do limite da operação.

O fallback não ignora o limite global de tentativas.

---

## 10. Falha final

Se continuar inválido:

- não persistir;
- registrar erro;
- retornar estado tratável;
- permitir nova tentativa do usuário.

---

## 11. Nunca fazer

Não:

- aceitar “quase válido” porque o texto parece razoável;
- confiar nos macros declarados pela IA;
- relaxar exclusões;
- ultrapassar safety gate para evitar erro.
