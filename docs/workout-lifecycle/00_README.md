# Ciclo de vida do treino

## Objetivo

Este diretório consolida decisões que atravessam a prescrição sem misturar
responsabilidades diferentes. A arquitetura de produto passa a reconhecer
quatro camadas:

```text
Questionnaire
  → Normalization
  → Prescription Engine
      Safety → Selection → Base Txxx → Limitation/Equipment → Personalization → Validation
  → Personalized Program
  → Persistence
  → Schedule Engine
  → Workout Execution
  → Workout History
  → Progression Engine
  → Program Revision
  → novo ciclo
```

- **Questionnaire** coleta fatos e preferências declaradas.
- **Prescription Engine** seleciona T001–T090 e compõe a dose inicial segura.
- **Schedule Engine** relaciona sessões ordenadas a dias e conclusões.
- **Progression Engine** altera o programa ao longo do tempo e de reavaliações.

Agenda não escolhe template, e progressão não deve ser simulada por um
modificador permanente de experiência.

## Legenda obrigatória de status

| Status | Significado |
|---|---|
| `IMPLEMENTED` | Existe comportamento executável e auditado no repositório atual. |
| `APPROVED_NOT_IMPLEMENTED` | A decisão de produto está fechada, mas ainda não existe execução completa. |
| `FUTURE_DESIGN` | Direção arquitetural aprovada; contrato e implementação ainda serão detalhados. |
| `DECISION_REQUIRED` | Falta uma escolha de produto ou regra quantitativa. |

“Aprovado” nunca deve ser apresentado como “implementado”. Na dúvida, o status
mais conservador prevalece.

## Mapa de leitura

1. `01_PROGRAM_LIFECYCLE.md` — fronteiras e estados do programa.
2. `02_BEGINNER_ADAPTATION.md` — adaptação temporária de entrada.
3. `03_SCHEDULE_ENGINE.md` — preferência semanal, rotação e faltas.
4. `04_PROGRESSION_ENGINE.md` — quando o programa evolui (Beginner stages,
   renovação normal), separado da prescrição.
5. `05_PERSISTENCE_AND_VERSIONING.md` — snapshots, Firestore e versões.
6. `06_REASSESSMENT.md` — pós-parto e outras reavaliações.
7. `07_OPEN_DECISIONS.md` — registro central DR-001 em diante.
8. `08_PRESCRIPTION_CLOSURE_ANALYSIS.md` — auditoria quantitativa, decisões e
   simulações da fase de fechamento.
9. `09_WORKOUT_EXECUTION_AND_HISTORY.md` — o que o usuário realmente fez numa
   sessão, set a set, e como isso avança o Schedule Engine.

Documentos relacionados:

- `../31_questionario_entrada_t001_t090.md`;
- `../32_workout_prescription_engine.md`;
- `../workout-modifiers/`.

## Verdade atual resumida

| Tema | Status | Verdade documental |
|---|---|---|
| Seleção T001–T090, safety, composição básica, trace e snapshot local | `IMPLEMENTED` | Motor atual em `src/workoutPrescription/`. |
| Iniciante semanas 1–3+ | `IMPLEMENTED` | Manter 50%/70%/100% dos exercícios; dose interna preservada. |
| Intermediário e avançado na dose-base | `IMPLEMENTED` | Ambos preservam a base. |
| Estratégia 30/45, 60 base e 90 sem preenchimento | `IMPLEMENTED` | Manter 60%/80%/100%/100% dos exercícios. |
| Prioridade muscular | `IMPLEMENTED` | Preservar/ordenar e no máximo +1 set por prioridade/sessão. |
| Metadados por limitação declarada | `IMPLEMENTED_V1` | Resolver puro, profiles `product_policy`, fail-closed, interseção, equipment e trace versionado; revisão profissional não é alegada. |
| Agenda semanal | `IMPLEMENTED_V1` | Config/state/events em Firestore, resolver puro, decisão de falta explícita; independente da identidade A/B/C das sessões (`03_SCHEDULE_ENGINE.md`). |
| Execução de treino e histórico | `IMPLEMENTED_V1` | Set a set, carga/reps reais, skip semântico, finish completo/parcial, integra com o Schedule sem duplicar a lógica de avanço (`09_WORKOUT_EXECUTION_AND_HISTORY.md`). |
| Progressão de estágio (Beginner + renovação normal) | `IMPLEMENTED_V1` | Tempo + sessões reais (nunca tempo sozinho); renovação ~90 dias + aderência ≥60%; sempre novo snapshot, nunca muta o anterior (`04_PROGRESSION_ENGINE.md`). |
| Progressão de carga/deload | `FUTURE_DESIGN` | Fora de escopo — DR-027. |
| Templates e programas em Firestore | `APPROVED_NOT_IMPLEMENTED` | Hoje há apenas snapshots locais por usuário/questionário. |
