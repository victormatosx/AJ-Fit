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

Fluxo:

```text
pregnant == true
-> generation denied
-> no AI call
-> professional guidance message
```

Não existe override pelo usuário.

---

## 4. Lactação

Lactação/amamentação também bloqueia geração.

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

---

## 8. Plano já existente

Se um usuário se tornar inelegível posteriormente:

- não gerar novo plano;
- produto deve poder esconder/desativar ações de regeneração;
- não modificar silenciosamente histórico existente.

A política final de exibição de plano antigo pode ser definida em fase legal/produto.
