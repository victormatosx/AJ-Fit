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

Primeira tentativa:

- ajustar gramas;
- preservar os alimentos escolhidos quando possível;
- manter restrições.

Se a correção produzir plano válido, aceitar.

---

## 8. Retry

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
