# Ciclo de vida do programa

## Fronteiras

O ciclo de vida não é uma extensão implícita do Selection Engine. Cada camada
tem entrada, saída e versão próprias:

```text
QuestionnaireAnswers
  → Prescription: template + modificadores + sessão final
  → Schedule: posição das sessões no calendário e estado de conclusão
  → Progression: próxima dose/variante após evidência e reavaliação
```

## Template-base não é programa personalizado

Um Txxx é uma receita canônica reutilizável. Ele nunca é mutado para um usuário:

```text
T004 + modifiers do usuário X → personalized program P123
T004 + modifiers do usuário Y → personalized program P456
```

P123 e P456 preservam `templateId` e versões de origem, mas contêm snapshots
finais próprios. Alterar T004 futuramente não modifica retroativamente nenhum
programa iniciado.

## Estados conceituais

| Estado | Responsabilidade | Status |
|---|---|---|
| avaliação coletada | Questionnaire | `IMPLEMENTED` |
| prescrição gerada | Prescription Engine | `IMPLEMENTED`, com lacunas explícitas |
| agenda configurada | Schedule Engine | `IMPLEMENTED_V1` (`03_SCHEDULE_ENGINE.md`) |
| sessão concluída/perdida/reagendada | Schedule Engine | `IMPLEMENTED_V1`; decisão explícita CONTINUE_SEQUENCE/FOLLOW_SCHEDULE, DR-012/DR-018 `RESOLVED_V1` |
| programa em adaptação inicial | Prescription + lifecycle | geração Week 1/2/3+ `IMPLEMENTED`; avanço automático de semana ainda depende do lifecycle futuro |
| reavaliação solicitada | Questionnaire/lifecycle | `FUTURE_DESIGN` |
| programa progredido/regredido | Progression Engine | `FUTURE_DESIGN` |
| programa substituído por nova prescrição | Prescription + persistence | local parcial hoje; nuvem futura |

## Invariantes

1. A identidade da sessão (`A`, `B`, `C`...) não depende do nome do dia.
2. Uma falta não altera silenciosamente o template ou a dose.
3. Tempo decorrido, sozinho, não comprova prontidão clínica nem progressão.
4. Nova avaliação pode gerar nova prescrição; não reescreve snapshot histórico.
5. Safety sempre pode interromper agenda ou progressão.
6. Prescrição, agenda e progressão têm versionamento independente.
7. Cada transição relevante deve ser explicável por reason codes abstratos;
   respostas clínicas, PII e texto livre não pertencem a IDs ou logs comuns.

## Referência temporal

Programas podem ser organizados em ciclos de alguns meses, com cerca de três
meses como referência de produto. Isso é `FUTURE_DESIGN`, não um timer que
promove automaticamente o usuário, troca template ou encerra pós-parto.
