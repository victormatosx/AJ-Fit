# Home presentation snapshot: auditoria de cacheabilidade

Auditado em 2026-09-22 na árvore de `HomeScreen`, `AppShell` e nos hooks de Home. A rota `app` continua sendo decidida por `resolvePremiumGate` antes de `AppShell` montar. `updatedAt` é diagnóstico, não prova de atualidade.

| Seção | Dados exibidos | Fonte atual | Classe / pode ficar stale? | UID? | programInstanceId? | Mesma data? | CTA? | Snapshot permitido? | Estratégia |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Header/saudação/avatar | data local, nome, foto | relógio, AuthContext/profile cache | B: nome/foto só com UID; data sempre atual | sim | não | data calculada novamente | Perfil | nome/foto visual; navegação só com sessão atual | Reusar profile cache; espaço do ícone de suporte reservado. |
| Descanso no header | estado/timer de execução | RestSessionContext | D: exige execução atual | sim | sim | sim | Retomar | não | Estado neutro até autoridade. |
| Support/unread | contador de mensagens | listener Firestore | C: número antigo pode enganar | sim | não | não | Abrir suporte | não | Reservar 42 px; só mostrar badge do listener atual. |
| EvolutionTicker | nível, ciclo, proximidade, métricas | useWorkoutEvolution/EvolutionSummaryPresentationCache | B: visual stale por programa | sim | sim | não | Evolução | cache existente, sem duplicação | Só usar após identidade atual do programa; nenhum pending/earned/CTA via cache. |
| Today / Treino de hoje | sessão, título, meta, estado do calendário | prescrição + Schedule Engine | C antes de identidade atual; B somente mesmo UID, programa, data local, timezone e configuração | sim | sim | sim | Iniciar/revisar/retomar/avançar | conservador: apenas geometria | Poster neutro na trilha rápida; ação exige prescrição, schedule e execução atuais. |
| BodyMuscleMap | músculos da sessão de Today | prescrição atual | C: segue Today | sim | sim | sim | não | não | Reservar área no poster. |
| Missed-session notice/popover | decisão pendente | Schedule Engine | D: estado de decisão atual | sim | sim | sim | Pode iniciar fluxo | não | Ocultar até resolução atual. |
| ProgramProgressStrip | nível/ciclo/proximidade | EvolutionViewModel | B: stale visual por programa | sim | sim | não | Abrir Evolution | cache existente | Shell reservado até identidade atual; CTA só com view model autoritativa. |
| WeeklyOverview | sete dias, estados, resumo | Schedule config + activity fetch | B na mesma semana e programa; fora da semana perde semântica de hoje/missed | sim | sim | mesma semana e timezone | não | só após identidade; nesta fase reservar geometria | Semana nova recebe shell neutro, nunca estados antigos. |
| FrequencyHeatmap | 30 dias concluídos | completed workout dates | B: histórico concluído pode ficar stale, mas janela antiga não pode parecer janela atual | sim | não (histórico por UID) | janela deve ser recalculada para o dia atual | setas de paginação | sim, datas concluídas apenas | Recriar janela com datas persistidas; rotular estado como em atualização e desabilitar setas até fetch atual. Tamanho deriva de `useWindowDimensions`, sem segunda medição. |
| UpcomingWorkouts/modal | agenda, detalhes de sessão | Schedule Engine + prescrição | C: datas e programa podem mudar | sim | sim | sim | Abrir detalhes | só geometria | Shell estável; linhas e modal só após schedule/prescrição atuais. |

## Autoridade das ações

`onStart`/retomar exige prescrição e resolução atual do Schedule Engine, além do fluxo de execução/recovery atual. `onAdvanceWorkout` exige o `advancedWorkoutTarget` atual. Notice de falta exige a resolução `MISSED_SESSION_DECISION_REQUIRED` atual. Evolution exige um `EvolutionViewModel` acionável e atual; `SUMMARY_READY/CACHE` é somente visual. Setas da frequência exigem a janela/hook atuais. Detalhes de próximos treinos exigem prescrição e agenda atuais. Perfil e suporte são navegação da sessão autenticada, mas o badge unread só vem do listener atual. Snapshot nunca alimenta nenhum desses handlers.

## Limite da trilha rápida

`activeProgram.programInstanceId` só existe após `useWorkoutPrescription` resolver. Até lá, nenhuma seção ligada ao programa pode exibir conteúdo de programa persistido sem risco de mostrar o programa A quando B já está ativo. A primeira revelação pode usar saudação por UID, histórico de frequência por UID e geometria neutra para o resto. As seções de programa são substituídas após a identidade e os dados atuais chegarem. A ausência de snapshot mantém o gate original integral.
