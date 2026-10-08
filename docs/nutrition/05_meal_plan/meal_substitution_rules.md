# AJ Fit Nutrition — Troca de Refeições Recomendadas

## 1. Escopo

Na V1, o usuário não troca alimentos individuais dentro da recomendação.

A ação de personalização disponível é trocar **uma opção completa de refeição**.

---

## 2. Fluxo

`usuário solicita troca -> informa motivo/preferência -> IA gera nova opção -> validador verifica -> usuário escolhe confirmar`

---

## 3. Motivos

A experiência pode coletar motivos como:

- não gostei;
- quero outra opção;
- prefiro outro alimento;
- quero mais variedade.

O motivo pode alimentar preferências futuras quando aplicável.

---

## 4. Equivalência nutricional

A nova opção deve manter aproximadamente:

- energia;
- proteína;
- gordura;
- carboidratos;

da meta da refeição original.

A comparação usa os valores reais do catálogo.

---

## 5. Validação

A opção substituta deve:

- respeitar todas as exclusões;
- respeitar padrão alimentar;
- usar somente alimentos approved;
- permanecer dentro das tolerâncias;
- ser plausível como refeição.

---

## 6. Confirmação

A troca só altera o plano depois de confirmação explícita do usuário.

Não substituir silenciosamente.

---

## 7. Histórico

A alteração deve ser auditável.

Registrar:

- opção anterior;
- nova opção;
- data;
- motivo informado quando houver;
- versão da geração.

---

## 8. Diário

Trocar uma recomendação não altera nenhum registro de consumo real já existente.

O diário permanece independente.
