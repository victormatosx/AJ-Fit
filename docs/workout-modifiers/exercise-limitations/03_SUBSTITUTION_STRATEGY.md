# Estratégia de substituição por limitação

## Pipeline

```text
Safety Gate
→ classificar original em todas as regiões declaradas
→ reunir candidatos ordenados (limitation profile + grafo atual)
→ filtrar existência/status/availability
→ filtrar função, primary muscle e movement pattern
→ filtrar equipamento/ambiente
→ filtrar TODAS as limitações
→ filtrar adaptationRuleIds executáveis
→ escolher primeiro candidato válido
→ revalidar sessão inteira
```

Um candidato válido para `knee` não é válido para `knee + back` se estiver
`avoid` ou `unknown` em `back` conforme a política DR-005. `not_applicable` é
ignorado somente naquela região. Recalcular sempre a partir do original e do
conjunto completo.

## Agregação, não recursão e ciclos

Para múltiplas regiões, reunir as listas na ordem canônica regional, preservar
a ordem interna e remover duplicatas. Cada candidato é reavaliado contra todas
as limitações; nenhuma lista constitui autorização absoluta.

A V1 é explicitamente não recursiva. Para uma lista original `A → [B, C]`:

1. validar B contra todas as constraints;
2. se B falhar, não consultar adaptações/substitutos de B;
3. tentar C, ainda a partir da lista original de A;
4. se todos falharem, retornar `NO_SAFE_SUBSTITUTION`.

Por isso ciclos como `A ↔ B` são detectados e reportados, mas não bloqueiam a
persistência V1. O runtime futuro ainda deve manter `visitedExerciseIds`; uma
evolução que autorize recursão também deve impor limite determinístico de 116
IDs e reabrir a decisão de ciclos antes de ser ativada.

## DR-005 — unknown

Status: `RESOLVED`.

Política fail-safe:

1. safety/restrição profissional continua podendo bloquear antes do exercício;
2. tentar primeiro substituto revisado compatível com todas as constraints;
3. aceitar `compatible`/`not_applicable`; `adapt` exige variante executável;
4. para `mild`, original `unknown` nunca passa como compatible;
5. sem candidato, retornar `NO_SAFE_SUBSTITUTION`; uma redução cosmética futura
   não comprova que o template é seguro;
6. priority/duration/beginner nunca reintroduzem o exercício rejeitado.

## Estados finais

- `EXERCISE_REPLACED_LIMITATION` quando houver candidato válido;
- `NO_SAFE_SUBSTITUTION` quando um slot não puder ser resolvido;
- `CATALOG_GAP` somente após o processo formal descrito em `05_CATALOG_GAPS.md`.

Precedência por região: `unknown` falha fechado; `avoid` rejeita; `adapt` exige
ação compatível; `compatible` permite; `not_applicable` não participa. Entre
várias regiões, qualquer rejeição vence e adaptações incompatíveis falham.

`avoid` com `substituteExerciseIds=[]` e
`candidateStatus=missing_exercise_candidate` é uma regra V1 válida. Ela não é
gap de integridade do profile: representa decisão explícita de rejeitar o
original sem alternativa cadastrada e conduz a `NO_SAFE_SUBSTITUTION`.
