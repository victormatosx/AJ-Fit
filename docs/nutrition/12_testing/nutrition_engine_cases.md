# AJ Fit Nutrition — Casos de Teste do Nutrition Engine

## 1. Objetivo

Validar todos os cálculos e invariantes do Nutrition Engine.

---

## 2. RMR — Mifflin-St Jeor

Testar:

- masculino;
- feminino;
- diferentes idades;
- diferentes pesos;
- diferentes alturas;
- limites válidos.

Validar fórmula exatamente conforme versão canônica.

---

## 3. TDEE

Cobrir todos os níveis:

- sedentary;
- low_active;
- active;
- very_active.

Também testar:

- integração com frequência de treino;
- ausência temporária do contexto de treino;
- prevenção de double counting.

---

## 4. Objetivos

### Perda de peso

Validar:
- gradual;
- moderate;
- accelerated;
- deficit percentual;
- safety floor.

### Ganho de massa

Validar:
- gradual;
- moderate;
- accelerated;
- surplus percentual;
- limites máximos.

### Manutenção

Validar ausência de deficit/surplus indevido.

### Recomposição

Validar regra canônica específica quando os valores forem fechados.

---

## 5. Safety floors

Casos em que o cálculo bruto cai abaixo do mínimo:

- aplicar floor;
- preservar consistência;
- registrar clamp quando o contrato exigir.

Testar por sexo conforme regra canônica.

---

## 6. Proteína

Cobrir:
- min;
- target;
- max;
- objetivos diferentes;
- pesos diferentes.

Invariante:
- target dentro do range.

---

## 7. Gordura

Validar:
- mínimo g/kg;
- target;
- ajuste;
- nunca abaixo do mínimo.

---

## 8. Carboidratos

Validar cálculo por restante energético.

Casos:
- sobra normal;
- sobra mínima;
- conflito com proteína/gordura;
- impossibilidade.

Nunca aceitar carbs negativos.

---

## 9. Fibra

Validar cálculo por kcal:

`g / 1000 kcal`

Casos:
- diferentes targets calóricos;
- arredondamento;
- limites definidos no canonical.

---

## 10. Meal distribution

Testar 2 a 6 refeições.

Validar:
- soma das metas por refeição aproxima total diário;
- proteína distribuída;
- refeições principais maiores quando regra aplicar;
- snacks menores quando aplicável;
- tolerâncias.

---

## 11. Tolerâncias

Testar:
- exatamente no limite;
- ligeiramente abaixo;
- ligeiramente acima;
- claramente inválido.

---

## 12. Mudança de peso

Novo peso não altera plano ativo.

Só nova geração produz novo snapshot.

---

## 13. Determinismo

Mesmo input + mesma versão de regras deve gerar exatamente o mesmo output do engine.

---

## 14. Versionamento

Cada output deve conter versões corretas.

Testar que nova versão canônica não reinterpreta silenciosamente snapshot antigo.
