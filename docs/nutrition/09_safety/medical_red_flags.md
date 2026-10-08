# AJ Fit Nutrition — Red Flags Médicos

## 1. Escopo da V1

A V1 não coleta histórico clínico detalhado.

Não perguntar explicitamente sobre:

- diabetes;
- doença renal;
- doença hepática;
- hipertensão;
- doença cardiovascular;
- transtorno alimentar;
- medicações;
- outras condições médicas.

---

## 2. Consequência arquitetural

O sistema não pode afirmar que:

- avaliou segurança clínica completa;
- personalizou dieta para doença;
- substitui nutricionista/médico;
- é adequado para condição clínica específica.

---

## 3. Não inferir diagnóstico

Não usar:

- peso;
- objetivo;
- escolhas alimentares;
- padrão de consumo;

para inferir doença ou diagnóstico.

---

## 4. Red flags efetivamente coletados

Na V1, os únicos bloqueios clínico-fisiológicos explícitos são:

- gravidez;
- lactação.

Eles são gates determinísticos.

---

## 5. Evolução futura

Se o AJ Fit passar a suportar condições clínicas:

1. revisar produto;
2. revisar responsabilidade profissional/regulatória;
3. criar questionário específico;
4. criar regras canônicas próprias;
5. validar com profissional qualificado;
6. atualizar eligibility gates;
7. criar novos testes e disclaimers.

Não adicionar condições clínicas isoladamente apenas via prompt de IA.
