# AJ Fit Nutrition — Elegibilidade e Safety Gates

## 1. Objetivo

Definir quando um usuário pode iniciar geração de plano alimentar.

---

## 2. Elegibilidade básica

Para gerar dieta na V1, o usuário precisa:

- possuir acesso normal ao app;
- ter os dados físicos obrigatórios disponíveis;
- ter objetivo válido;
- possuir Perfil Nutricional completo;
- não estar em safety gate bloqueador.

---

## 3. Gravidez

Gravidez é bloqueio de geração na V1.

A gravidez é **estado atual**, não snapshot imutável. `Quiz.pregnancyScreening` (onboarding) só serve para pré-preencher `nutritionProfile/current.pregnant` na primeira vez que o Perfil Nutricional é criado. Depois disso, `Quiz.pregnancyScreening` nunca é lido de novo — a fonte de verdade passa a ser exclusivamente `nutritionProfile/current.pregnant`, editável pela usuária e revalidada a cada geração.

Fluxo:

```text
nutritionProfile/current.pregnant == true
-> generation denied
-> no AI call
-> professional guidance message
```

Não existe override pelo usuário.

---

## 4. Lactação

Lactação/amamentação também bloqueia geração.

Mesmo princípio da gravidez: `nutritionProfile/current.breastfeeding` é o estado atual e autoritativo, editável pela usuária. Não existe snapshot imutável equivalente no restante do AJ Fit para lactação — o campo é coletado e mantido inteiramente dentro de `nutritionProfile/current`.

Fluxo equivalente à gravidez.

---

## 5. Menores

A Nutrição não cria gate adicional para menores porque menores não possuem acesso ao produto no escopo atual.

Se essa política global mudar, Nutrição deve ser reavaliada antes de permitir geração.

---

## 6. Condições médicas

A V1 não pergunta sobre:

- diabetes;
- doença renal;
- doença hepática;
- doença cardiovascular;
- transtornos alimentares;
- outras condições clínicas.

Portanto:

- não inferir diagnóstico;
- não fingir que o sistema avaliou risco clínico;
- não criar bloqueio baseado em condição que não foi coletada.

---

## 7. Reavaliação antes de gerar

Eligibility gate deve rodar a cada nova geração.

Não assumir que elegibilidade anterior continua válida.

Para gravidez e lactação, isso significa ler `nutritionProfile/current.pregnant` e `nutritionProfile/current.breastfeeding` no momento da geração — nunca reutilizar um valor cacheado no cliente nem reconsultar `Quiz.pregnancyScreening`.

---

## 8. Plano já existente

Se um usuário se tornar inelegível posteriormente:

- não gerar novo plano;
- produto deve poder esconder/desativar ações de regeneração;
- não modificar silenciosamente histórico existente.

A política final de exibição de plano antigo pode ser definida em fase legal/produto.
