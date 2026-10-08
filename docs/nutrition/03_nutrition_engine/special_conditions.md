# AJ Fit Nutrition — Condições Especiais e Gates

## 1. Gestação

Gestação ativa bloqueia geração automática na V1.

O sistema deve:

- não gerar dieta;
- não chamar IA para montar refeições;
- recomendar acompanhamento profissional.

## 2. Lactação

Lactação ativa também bloqueia geração automática na V1.

## 3. Menores de idade

Menores não têm acesso ao app segundo a regra atual do produto.

## 4. Condições médicas

A V1 não implementa questionário clínico detalhado nem dietas terapêuticas específicas.

Não adicionar suporte silencioso para condições clínicas sem nova especificação.

## 5. Alimentos excluídos

Todo item em `excludedFoodIds` é hard exclusion.

Se uma nova exclusão tornar o plano atual incompatível:

- revisar;
- avisar;
- recomendar regeneração.

Não regenerar automaticamente.
