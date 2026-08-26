# Registro central de decisões requeridas

`RESOLVED_V1` significa suficiente para a V1, não implementação. Decisões
substituídas permanecem registradas para evitar que a complexidade antiga volte
como requisito implícito.

Implementação atual: regras simples que substituem DR-001/003/015/016/021 e a
decisão DR-022 estão executáveis em `src/workoutPrescription/`; versões
`modifierRules=2.0.0`, `compositionEngine=2.0.0` e
`limitationResolver=1.0.0`. DR-004 e DR-006 estão executáveis sob a política
conservadora V1. Os 76 profiles usam `approved + product_policy`; isso não
substitui nem inventa revisão profissional. Os 40 ausentes permanecem
fail-closed quando necessários.

| ID | Estado anterior | Estado V1 | Resultado |
|---|---|---|---|
| DR-001 | `RESOLVED` para redução de sets | `SUPERSEDED` | Beginner reduz quantidade de exercícios por 50%/70%; sets preservados. |
| DR-002 | `RESOLVED` com RIR | `SUPERSEDED_NOT_REQUIRED` | V1 não controla RIR, esforço ou proximidade da falha. |
| DR-003 | `RESOLVED` com budget +20% | `SUPERSEDED` | Priority preserva/ordena e pode adicionar +1 set por prioridade/sessão. |
| DR-004 | `PARTIALLY_RESOLVED` | `RESOLVED_IMPLEMENTED_V1` | Schema, ausência, `not_applicable`, substitutes, interseção, versão e resolver implementados. |
| DR-005 | `RESOLVED` | `RESOLVED` | `unknown` nunca é `compatible`; tentar alternativa revisada. |
| DR-006 | `PROFESSIONAL_REVIEW_REQUIRED` | `RESOLVED_PRODUCT_POLICY_V1` | 76 profiles aprovados para comportamento conservador de produto, zero `unknown`; 40 sem profile continuam fail-closed. Não é aprovação clínica. |
| DR-007 | aberta | aberta | Primeira reavaliação pós-parto. |
| DR-008 | aberta | aberta | Critérios de saída da família postpartum. |
| DR-009 | aberta | `RESOLVED_IMPLEMENTED_V1` | `workoutTemplates/Txxx`, schema/hash/seed e Rules implementados. |
| DR-010 | aberta | `RESOLVED_IMPLEMENTED_V1` | Snapshot privado em `users/{uid}/workoutPrograms/{programId}` e pointer fixo implementados. |
| DR-011 | aberta | `RESOLVED_V1` | Estados `active/superseded` + Progression Engine decide QUANDO a transição ocorre (`04_PROGRESSION_ENGINE.md`); lifecycle de carga/exercício continua fora de escopo. |
| DR-012 | aberta | `RESOLVED_IMPLEMENTED_V1` | Schedule Engine: resolver puro, config/state/events em Firestore, decisão explícita de falta (`03_SCHEDULE_ENGINE.md`). |
| DR-013 | aberta | `PARTIALLY_RESOLVED_V1` | Progressão de STAGE (Beginner 1→2→3 e renovação normal de ~90 dias) resolvida — `04_PROGRESSION_ENGINE.md`. Regressão e deload continuam abertos/fora de escopo (DR-027). |
| DR-014 | aberta | `PARTIALLY_RESOLVED_V1` | Renovação normal usa o MESMO template quando não há alternativa real na biblioteca (1:1 por sexo/objetivo/frequência/ambiente) — nenhuma troca de Txxx é inferida. Critério de troca real de template continua `DECISION_REQUIRED` (DR-027). |
| DR-015 | `PARTIALLY_RESOLVED` com timing | `RESOLVED_V1_SIMPLE` | 30/45 reduzem contagem aproximada; não estimar minutos. |
| DR-016 | `RESOLVED` com donors/receivers | `SUPERSEDED` | Regra simples +1 por prioridade/sessão substitui budget. |
| DR-017 | aberta | `RESOLVED_V1` | `trainingDays: Weekday[]` (IDs `MON`..`SUN`, ordem canônica), `timezone` IANA em `scheduleConfig`; `days===7` auto-preenche sem pergunta. |
| DR-018 | aberta | `RESOLVED_V1` | Falta = decisão explícita `CONTINUE_SEQUENCE`/`FOLLOW_SCHEDULE`, persistida como evento; múltiplas faltas colapsam em uma decisão só. |
| DR-019 | `RESOLVED` | `RESOLVED` | Novo exercício somente após gap demonstrado. |
| DR-020 | aberta | aberta | Conteúdo de reavaliação pós-parto. |
| DR-021 | `RESOLVED_PERCENTAGE` | `SUPERSEDED_NOT_REQUIRED` | Beginner preserva duration/cycles internos. |
| DR-022 | `RESOLVED` | `RESOLVED` | `return_to_training` não ativa Beginner Adaptation. |
| DR-023 | `HUMAN_DECISION_REQUIRED` | `CANCELLED_NOT_REQUIRED_FOR_V1` | RIR-base saiu do escopo. |
| DR-024 | `HUMAN_DECISION_REQUIRED` | `CANCELLED_NOT_REQUIRED_FOR_V1` | Não há redução de duration/cycles. |
| DR-025 | `BLOCKED_BY_DATA` | `NOT_REQUIRED_FOR_PRESCRIPTION_V1` | Timing/rest/transições podem ser feature futura de execução. |
| DR-026 | `REVIEW_REQUIRED` | `CANCELLED_REPLACED_BY_ORDER` | Ordem do template + metadata existente substituem `slotRole`. |
| DR-027 | aberta | aberta | Load progression, deload, critério real de troca de template quando existir mais de uma alternativa compatível — nenhum implementado (`04_PROGRESSION_ENGINE.md` §Fora de escopo). |

## Bloqueadores reais da V1

Para personalização não clínica, as regras estão fechadas documentalmente. O
Limitation Resolver V1 está implementado com governança de produto e fail-closed;
uma futura governança profissional é independente. Firestore V1,
Schedule Engine V1, Workout Execution & History V1 e Progression Engine V1
(transições de Stage do Beginner + renovação normal por ciclo/aderência)
estão implementados; load progression e deload continuam fora de escopo
(DR-027).

Ao avaliar limitação, candidatos são validados diretamente contra todas as
constraints e precisam ser `compatible` ou `not_applicable`. Sem solução, não
declarar segurança: retornar `NO_SAFE_SUBSTITUTION`. A redução cosmética
posterior não serve como fallback de safety.
