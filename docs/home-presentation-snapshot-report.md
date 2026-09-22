# Home presentation snapshot + stale-while-revalidate

Data: 2026-09-22. Branch: `perf-consolidation`. Ambiente visual/performance: iPhone 17 Pro Simulator, Expo SDK 56 development build, Metro com `EXPO_PUBLIC_PERF_TRACE=1`. A implementação segue a [documentação versionada do Expo 56](https://docs.expo.dev/versions/v56.0.0/). Sem push ou deploy.

## A–B. Auditoria e classes

A tabela completa com dados, fonte, UID, programa, data, CTA e estratégia está em [home-presentation-snapshot-audit.md](./home-presentation-snapshot-audit.md). Resumo:

| Classe | Seções | Decisão |
| --- | --- | --- |
| A | nenhuma seção mutável da Home | A data do header é calculada no relógio atual; não é persistida. |
| B | header por UID; Evolution por UID + `programInstanceId`; Frequency por UID; Weekly somente na mesma semana e programa | Histórico de frequência é a única seção nova persistida. Evolution continua no cache próprio e verifica o programa atual. |
| C | Today, BodyMuscleMap, UpcomingWorkouts, Weekly antes da identidade do programa, ProgramProgressStrip sem identidade, unread | Geometria reservada até resolução atual; nenhuma afirmação antiga sobre Today/agenda/unread. |
| D | missed-session, descanso/execução, CTA de treino, advancement/pending/progression, notice de ativação | Apenas fontes atuais do AppShell/Schedule/Evolution. |

## C. Schema

`HomePresentationSnapshot` versão 1 contém `schemaVersion`, `uid`, `updatedAt` e `sections.frequency` com `timezone`, `throughLocalDate` e no máximo 30 `completedLocalDates`. A projeção não contém programa, Today, schedule, pending, earned, lifecycle, entitlement, callbacks ou snapshots Firestore. O parser rejeita JSON ruim, esquema errado, chaves extras, datas inválidas, datas fora da janela e UID diferente. A versão mais restrita permite revelar o histórico por UID antes de conhecer a identidade do programa atual.

## D–F. Identidade e calendário

- Chave local por UID. O `AppShellContent` remonta quando UID muda; a projeção ainda exige igualdade explícita entre UID autenticado e UID do registro. Logout e exclusão removem o registro e bloqueiam writes antigos enfileirados. Reads tardios são cancelados na desmontagem.
- Não há campo visual de programa no novo snapshot. `EvolutionSummaryPresentationCache` continua separado e só projeta após `programInstanceId` atual coincidir. Today/Weekly/Upcoming exibem conteúdo de programa somente depois da resolução atual; o schedule expõe `matchesActiveProgram` para impedir um frame com resolução do programa anterior.
- O heatmap é refeito para a data local atual no timezone salvo. Datas posteriores a `throughLocalDate` têm aspecto de desconhecidas, nunca são anunciadas como dias vazios confirmados. Se o registro aponta para o futuro ou não cobre nenhuma data da janela atual, há cache miss. `updatedAt` não invalida histórico arbitrariamente.

## G–J. Seções principais

Today mostra poster neutro e sem CTA enquanto o schedule atual não resolve; em erro inicial mostra indisponibilidade. O título/CTA/músculos antigos nunca vêm do snapshot. O poster mantém altura mínima estável no caminho com snapshot. Depois de uma Home autoritativa, um refresh mantém o título e mapa da sessão em tela enquanto retira o CTA.

Evolution reutiliza `EvolutionSummaryPresentationCache`, que já tem UID e `programInstanceId` e só dá `SUMMARY_READY/CACHE` visual. Nenhum pending/earned/activation/action é restaurado. `ProgramProgressStrip` reserva altura em erro/indisponibilidade no caminho com snapshot.

Weekly reserva área neutra até Today, schedule e atividade atuais; assim não aparece o transitório “0 de 0” observado na primeira captura. Frequency mostra histórico salvo com legenda própria e setas indisponíveis, troca direto para a janela atual, e usa `useWindowDimensions` sem medição de largura posterior. Upcoming reserva a área de até três linhas; numa revalidação após autoridade da sessão, mantém as linhas existentes com toque desabilitado. Unread nunca é restaurado: o botão de suporte mantém 42×42 sem badge até o listener atual responder.

## K. Ações

| Ação | Autoridade exigida |
| --- | --- |
| Iniciar/revisar/retomar Today | prescrição, Schedule Engine e `programInstanceId` atuais; `matchesActiveProgram`; fluxo de execução/recovery do AppShell |
| Adiantar treino | `advancedWorkoutTarget` atual e mesmas condições de Today |
| Notice de falta | resolução atual `MISSED_SESSION_DECISION_REQUIRED` |
| Evolution/ProgramProgress | view model acionável atual, nunca `SUMMARY_READY/CACHE` |
| Setas Frequency | janela `AUTHORITATIVE` e estado atual do hook |
| Detalhes Upcoming | prescrição e agenda atuais; linhas antigas da sessão ficam disabled durante refresh |
| Suporte/perfil | somente navegação do UID autenticado; badge depende exclusivamente do listener atual |

## L–Q. Cenários

| Cenário | Evidência | Resultado/limite |
| --- | --- | --- |
| Primeira abertura/cache miss | teste de read miss + gate original preservado no `AppShell` | Overlay antigo até `homeInitialVisualReady`; write somente após todos os statuses `SUCCESS`, programa e frequência atual. |
| Segunda abertura | 10 cold starts com `home_snapshot_hit`, layout, visual ready e overlay hidden | Home visual antes da autoridade em todos os 10 runs. |
| Virada do dia D→D+1 | fixture `projectCachedFrequency` | Janela muda para D+1, dia novo fica desconhecido; Today não consta do schema. |
| Programa A→B | ausência de campos de programa no schema, `matchesActiveProgram`, cache Evolution com ID próprio | Nenhum conteúdo de programa A vem do novo snapshot; teste unitário do gate de Today cobre mismatch do schedule. Sem troca real A→B no simulador. |
| Pós-treino | política `authoritativeReachedOnce` e CTA de Today/linhas Upcoming desabilitados durante refresh | Visual da sessão permanece; nova gravação espera statuses `SUCCESS`. Sem execução real de treino nesta rodada. |
| Multiusuário A→B | parser/key por UID, remount e teste de logout/write tardio | A não pode ser lido como B. Sem login real de duas contas no simulador. |
| Corrupção | fixture JSON inválido, schema, UID, campo extra, data inválida/fora da janela | Cache miss sem crash e fallback autoritativo. |
| Offline/erro | fixture de erro de leitura atual + snapshot, gate de CTA e write | Cache visual continua, Today não acionável, nenhum write; indisponibilidade textual em Today. Sem desligar rede do simulador/host nesta rodada. |

## R. Performance

Comparação entre [baseline limpo de 10 runs](./home-bootstrap-perf-audit-gate-final.md) e 10 cold starts quentes finais em `perf-runs/snapshot-release2-run-*.log`. Valores em milissegundos desde o epoch de performance da aplicação; percentis pelo mesmo método de nearest rank. O relatório bruto está em `perf-runs/snapshot-release2-report.md` (gitignored); `scripts/analyzeHomeSnapshotPerf.mjs` reproduz a tabela.

| Métrica | Antes p50 | Depois p50 | Ganho |
| --- | ---: | ---: | ---: |
| Rota APP → primeira Home visual | 3850 | 993 | 74,2% |
| Lançamento → primeira Home visual | 7852 | 5869 | 25,3% |
| Lançamento → Home autoritativa | 7852 | 10056 | −28,1% nesta amostra |

| Métrica depois (ms) | min | p50 | p75 | p95 | max |
| --- | ---: | ---: | ---: | ---: | ---: |
| Rota APP → cached Home visible | 893 | 993 | 1063 | 1158 | 1158 |
| Lançamento → cached Home visible | 5021 | 5869 | 6778 | 11412 | 11412 |
| Lançamento → authoritative Home ready | 8202 | 10056 | 13853 | 14467 | 14467 |

10/10 hits; 10/10 chegaram a `home_authoritative_ready`. A meta `<1s` após APP foi atingida no p50, não no p75/p95. O tempo autoritativo variou e piorou nesta amostra; não há alegação de redução de bootstrap remoto. O primeiro ganho também inclui o tempo de auth/rota, que o snapshot não reduz. Uma tentativa de medição foi descartada porque o development client abriu seu launcher sem conectar ao Metro; os logs vazios não entraram na série. Depois da reconexão, uma abertura de verificação confirmou o caminho antes dos 10 runs válidos.

## S. Validação visual

Capturas finais: [T2](./qa/home-snapshot/T2.png), [T3](./qa/home-snapshot/T3.png), [T4](./qa/home-snapshot/T4.png), [T5](./qa/home-snapshot/T5.png). No primeiro viewport, os limites do poster Today e as posições da semana/frequência permanecem estáveis; a semana substitui a área neutra sem inserir um card novo. O texto do ticker se move por animação e o development client exibiu brevemente sua faixa `Refreshing...` em T3, ambos fora do fluxo de layout da Home.

- PRIMEIRO FRAME SNAPSHOT COMPLETO = **SIM**, no sentido de conteúdo seguro ou geometria reservada em cada seção.
- LAYOUT SHIFT = **NÃO observado no primeiro viewport T2–T5**; abaixo da dobra e tamanhos de fonte especiais não tiveram captura visual.
- CARD ENTRA DEPOIS = **NÃO no primeiro viewport**; Upcoming tem área reservada por código, sem captura rolada.

## T. Segurança

| Pergunta | Resposta |
| --- | --- |
| Snapshot participa de lifecycle? | NÃO |
| Snapshot participa de progression? | NÃO |
| Snapshot libera CTA? | NÃO |
| Snapshot contorna PremiumGate? | NÃO |
| Snapshot pode cruzar UID? | NÃO |
| Snapshot pode cruzar programa? | NÃO: não contém dados de programa; Evolution valida ID próprio. |
| Today de ontem pode aparecer como Today de hoje? | NÃO: Today não é persistido. |
| Snapshot pode ser regravado antes de autoridade? | NÃO: write exige Home inicial visualReady, statuses `SUCCESS` e programa atual. |
| Offline pode parecer autoritativo? | NÃO: fonte `CACHE`, legenda de histórico salvo, CTA bloqueado e Today com indisponibilidade. |

## U. Validação técnica e Git

- `npm run typecheck`: passou.
- ESLint dos arquivos tocados: 0 erros; 1 warning antiga em `AuthContext.tsx` (`authRevision`).
- Testes Home/cache focados: 135 passaram. `npm test -- --maxWorkers=2`: 5.673 passaram, 187 skipped, 4 falhas preexistentes documentadas em Paywall/RevenueCat/tema. Um teste temporal `recentAuth` falhou em uma rodada sob carga e passou isolado; o pipeline de limitações também passou isolado após flutuar em rodadas paralelas.
- `git diff --check`: sem whitespace errors. Branch `perf-consolidation`; sem push/deploy. `firestore-debug.log` estava modificado antes e não foi incluído.

## V. Decisão

| Questão | Decisão |
| --- | --- |
| HOME SNAPSHOT VALIDADO | **NÃO integralmente**: warm start e invariantes unitárias validadas; falta execução E2E real de offline, duas contas, troca de programa e pós-treino. |
| SEGUNDA ABERTURA FICOU MATERIALMENTE MAIS RÁPIDA | **SIM**: −25,3% no p50 de lançamento até Home visual; −74,2% após a rota APP. |
| AUTORIDADE PRESERVADA | **SIM** no código e nos testes de política; sem fonte de verdade nova. |
| LAYOUT CONTINUA ESTÁVEL | **SIM no primeiro viewport capturado**; validação visual abaixo da dobra pendente. |
| MANTER IMPLEMENTAÇÃO | **SIM, localmente para a próxima validação controlada**; sem deploy. |
| SERVER-SIDE PODE SER ADIADO NESTE MOMENTO | **SIM** para perseguir a latência percebida; não há evidência de melhora autoritativa. |

Nenhuma fase seguinte foi iniciada.
