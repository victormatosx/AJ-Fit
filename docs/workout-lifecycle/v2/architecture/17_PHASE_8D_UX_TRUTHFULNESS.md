# Fase 8D — UX Truthfulness — Relatório Final

## 1. Git

Branch `main`; baseline `d24319ba15e63095fd376bcd99acd30f4abce343`. O worktree já continha as Fases 1–8C e alterações do usuário. Nenhum commit, push, merge, reset, checkout destrutivo ou deploy foi executado.

## 2. UX Architecture Before

O hook combinava lifecycle/pending/decision, mas convertia duas dimensões em um `displayProgress` sintético, guardava autoativação por apenas um render e produzia um diff posicional incompleto. Home ainda ligava para calendário e próximos treinos fixos.

## 3. UX Architecture After

`useWorkoutEvolution` continua sendo a fronteira única. Ele reconcilia pelo serviço 8B, lê lifecycle/pending/decision, observa lifecycle/pending em tempo real, hidrata o último evento AUTO da ProgramInstance ativa, aplica acknowledgement local e entrega um union sem combinações impossíveis. Componentes continuam sem Firestore direto.

## 4. Lifecycle Claim Inventory

| Claim visível | Fonte | Tratamento |
|---|---|---|
| nível conquistado | `WorkoutLifecycle.currentTrainingLevel` | label explícito quando difere |
| nível do treino ativo | `TrainingCycle.level` | label “treino ativo” |
| ciclo | `TrainingCycle.cycleNumber` | inteiro sem teto |
| dias ativos/sessões válidas | `ProgressionDecision` V2 | contagens separadas |
| aderência | `ProgressionDecision.adherence.quality` | sinal sem percentual sintético |
| evolução disponível | `PendingEvolution` | tipo/qualidade congelados |
| autoativação | evento imutável da ProgramInstance ativa | aviso até acknowledgement |
| mudanças | snapshots source/target | diff local determinístico |

## 5. Fake/Stale Data Found

Foram encontrados: percentual composto, zeros/50% inventados em `NO_ACTION`, fisiologia em copy Beginner, Renewal com mudanças/frequência presumidas, autoativação efêmera, frequência/estrutura sempre anunciadas, calendário julho/2026 fixo, três próximos treinos fixos, número decorativo “04” e resíduos i18n de streak/volume/PR/XP/next level.

## 6. Fake/Stale Data Removed

Todos os itens acima foram removidos ou substituídos por estado neutro. O calendário não é mais alcançável e seu componente agora é um empty state verdadeiro. Os objetos i18n históricos de ticker/stats/upcoming/mock foram eliminados nas três línguas.

## 7. Progress Visualization Before

Uma única barra representava `min(activeDays/minDays, adherence/0.70)` como se fosse uma grandeza de evolução.

## 8. Progress Visualization After

Sem barra ou porcentagem. A UI mostra dias ativos, sessões válidas e aderência `BELOW_TARGET/GOOD/HIGH` separadamente. `NO_ACTION` usa `null`, não zero. Proximidade é mapeada do tipo/reason do motor, sem previsão temporal.

## 9. Beginner Journey

Copy motivadora de construção de base/consistência, baseada no outcome do motor. Não há alegação de adaptação corporal ou percentual fisiológico.

## 10. Intermediate Journey

Ciclo e nível permanecem separados. Cycle Evolution anuncia próximo ciclo; Level Promotion anuncia o nível-alvo realmente conquistado.

## 11. Advanced Journey

Advanced continua em ciclos indefinidos. Testes cobrem ciclos 10, 57 e 999 sem estado terminal ou nível inexistente.

## 12. Earned Level Promotion UX

Usa trophy/realce de earned unlock, nível-alvo e cycle reset vindo do lifecycle. Durante defer, nível conquistado e prescrição ainda ativa podem divergir visualmente sem colapso.

## 13. Earned Cycle Evolution UX

Usa semântica de novo ciclo disponível/ativo e nunca diz que existe um novo nível.

## 14. HIGH vs STANDARD/GOOD

HIGH recebe borda/HUD de destaque e copy excepcional. GOOD usa copy positiva de critérios concluídos, sem aparência de falha. Regras/CTAs são iguais.

## 15. Motivational Renewal Before

O heading/body e “What Changed” presumiam variações e frequência mantida; o título mostrava o nome do nível, aproximando Renewal de achievement.

## 16. Motivational Renewal After

Renewal é “versão alternativa”, com sparkles neutros, sem trophy, level unlock, cycle completion, achievement, punição ou XP. Nível/ciclo permanecem iguais; mudanças reais ainda podem ser mostradas.

## 17. Deferral UX

Primeiro defer preserva o treino atual e reprompt futuro. Segundo defer comunica disponibilidade imediata e autoativação ao fim do período. `isPromptable` controla somente a oferta de novo defer/reprompt.

## 18. Deferred Manual Start

Start fica fora do branch `isReady` e está disponível em `EVOLUTION_DEFERRED`. `nextPromptAt` nunca é usado como permissão de ativação; Start chama `activatePendingEvolution(...MANUAL)`.

## 19. Auto-Activation UX

Level, Cycle e Renewal têm títulos/corpos próprios. O aviso abre apenas em superfície segura: nunca no tab Workout, durante confirmação ou sobre outro overlay.

## 20. Persistence/Acknowledgement

O fato vem do ledger imutável. Acknowledgement é `AsyncStorage` device-local, uid-scoped e event-id-scoped. Falha de storage não bloqueia lifecycle; no pior caso o aviso real reaparece.

## 21. Multi-Device UX

Listeners de lifecycle/pending reconciliam mudanças externas. Cada dispositivo confirma separadamente. Política de múltiplos eventos: somente o AUTO mais recente da ProgramInstance atualmente ativa; eventos de instâncias superseded não aparecem como novos.

## 22. What Changed Architecture

Pending compara ProgramInstance source ativa com o plano target congelado. Após AUTO, compara snapshot da `previousProgramInstanceId` com a ProgramInstance ativa. Um mismatch de identidade resulta em diff ausente, nunca em claim aproximado.

## 23. What Changed Examples

O diff cobre: replacement com `{sessionIndex, slotIndex, fromExerciseId, toExerciseId}`, add/remove, reorder somente com mesmo multiset na sessão, sets/reps somente para a mesma identidade, frequência/sessões/split somente quando realmente diferem.

## 24. No-Change Handling

Quando os dois snapshots são observavelmente iguais, mostra “prescrição atualizada sem mudanças visíveis na estrutura”. Não inventa variação para preencher o card.

## 25. Program Adaptation UX

Adaptation não cria pending/unlock e continua síncrona pela autoridade 8B. A copy disponível declara ajuste por informações recentes e preservação de nível/ciclo; não é celebration.

## 26. Career vs Active Prescription

`earnedLevel` e `activeLevel` continuam campos diferentes. O card rotula a prescrição ativa e, quando necessário, exibe separadamente o nível conquistado.

## 27. Home Audit

Data é locale/timezone real; treino de hoje vem de WorkoutProgram + Schedule. Foram removidos calendário fixo, upcoming fixo, “04”, ticker, stats e traduções mockadas. Sem streak/volume/PR/XP/next-level falso.

## 28. Profile Audit

Profile usa exatamente o mesmo `EvolutionViewModel` V2 de Home. Não há XP, points, barra percentual ou nível hardcoded.

## 29. Progress Screen Audit

Body usa assessments reais; Photos usa vault real. Loads mostra empty state em produção porque cargas não são persistidas. A preview de Loads é explicitamente `__DEV__` e não é apresentada como dado do usuário em produção.

## 30. Placeholder Residual Search

Busca final não encontra `displayProgress`, `consistencyPercent`, `compositeProgress`, `AUTO_ACTIVATED_RECENTLY`, `CONSISTENCY_MOCK`, `MOCK_DATE`, `weekVolume`, `nextLevelValue` ou claims antigos nas superfícies de produção. Ocorrências em testes históricos/comentários foram removidas quando ambíguas.

## 31. XP/Gamification Boundary

Nenhum XP/reward/achievement foi criado. A UI celebra somente earned facts já persistidos; Renewal permanece fora da fronteira de achievement.

## 32. Accessibility

Start/Keep/Ack/Close têm role/label; loading usa `busy`, disabled é propagado pelo `CtaButton`, modal usa `accessibilityViewIsModal`, e não há gesto exclusivo.

## 33. Theme/Responsive Behavior

Componentes usam tokens do theme, sem cor nova fixa. Conteúdo está em `ScrollView`, CTAs ficam após conteúdo e o empty state usa tokens. Light/dark permanecem cobertos por testes estruturais. Device pequeno/font scaling não foi executado nesta sessão.

## 34. i18n

pt-BR/en/es têm 71 folhas de evolution em paridade, sem missing keys. Renewal/Level/Cycle/auto/diff mantêm semântica equivalente. `i18n:audit` passou com zero blocking issues; os 11 hardcodes reportados são preexistentes fora de lifecycle.

## 35. View Model Test Matrix

Cobertura: loading/error, unavailable legacy, dimensões reais, `NO_ACTION`, Beginner, earned/active divergence, Renewal, defer 1/2, reprompt, auto Level/Cycle/Renewal, histórico incompleto e Advanced 10/57/999.

## 36. Component Test Matrix

Não existe React Native Testing Library no repositório. Conforme a instrução da fase, foram adicionados testes estruturais Node para card/modal/AppShell/Home: Start deferred, failure, realtime/ack, a11y, reduced motion, ausência de writes e ausência de mocks.

## 37. Visual State Matrix

Código/teste estrutural cobre normal, loading, unavailable, error, Level GOOD/HIGH, Cycle GOOD/HIGH, Renewal, defer 1/2 e três autos. Simulator/device e screenshots: **NOT_RUN — há simuladores locais, mas não existe fixture autenticado nem rota de preview capaz de alcançar esses estados sem criar um bypass de produção**. Não são declarados como passados.

## 38. 8A Regression

Snapshots autoritativos, limitation preservation, progression window, extras exclusion, quatro ciclos Intermediate, 70/85 e equivalência role/session continuam cobertos pela suíte unitária/integrada verde.

## 39. 8B Regression

Autoridade V2, post-workout, stale prepare, adaptation/pending safety, recovery e matrizes de corrida permanecem verdes. UI usa somente serviços 8B para Start/Defer.

## 40. 8C Regression

Rollout/kill switch/telemetry/Rules/CI não foram redesenhados. Static/CI audit, Rules e Functions permanecem verdes.

## 41. Full Test Matrix

| Gate | Resultado |
|---|---|
| root typecheck/static/i18n/CI audit | PASS |
| root unit | PASS — 3.967; 101 opt-in skipped |
| root Firestore integration | PASS — 681 |
| Firestore Rules | PASS — 345 |
| Storage Rules | PASS — 91 |
| Functions typecheck/unit/build | PASS — 1.179; 39 opt-in skipped |
| focused 8D/view/i18n | PASS |
| simulator/device/screenshots | NOT_RUN — sem fixture lifecycle autenticado/preview route |

## 42. Files Created

`src/workoutEvolution/autoActivationNotice.ts`, seus testes, teste estrutural `uxStructure.test.ts` e este relatório.

## 43. Files Modified

View model/hook/diff; EvolutionCard/UnlockScreen; AppShell/Home/Consistency; loaders read-only de lifecycle/program; i18n evolution/home; prewarm; testes i18n/navigation/theme/integration; comentário órfão de Workout.

## 44. Documentation Updated

`product/01_USER_FACING_STATES.md`, `product/03_PROGRESS_VISUALIZATION.md`, relatórios históricos 11/12 com notas de supersessão e este relatório 17. Histórico não foi reescrito silenciosamente.

## 45. Acceptance Criteria

Todos os critérios abaixo usam `PASS`, `N/A`, `NOT_IMPLEMENTED` ou `BLOCKED`. Não há `NOT_IMPLEMENTED`/`BLOCKED`.

| ID | Status | Evidência curta |
|---|---|---|
| A | PASS | inventário §4 |
| B | PASS | tabela de fontes §4 |
| C | PASS | presenter mapeia decisões V2 |
| D | PASS | testes sem Firestore em componentes |
| E | PASS | LOADING sem summary |
| F | PASS | `UNAVAILABLE` neutro |
| G | PASS | historyComplete/error, sem inferência |
| H | PASS | composite/bar removidos |
| I | PASS | nenhuma porcentagem substituta |
| J | PASS | activeDays real |
| K | PASS | adherence.quality real |
| L | PASS | sem data futura exata |
| M | PASS | sem days remaining |
| N | PASS | sem fisiologia |
| O | PASS | base/consistência |
| P | PASS | ciclos Advanced ilimitados |
| Q | PASS | framing Level |
| R | PASS | framing Cycle |
| S | PASS | visual/copy HIGH |
| T | PASS | GOOD positivo |
| U | PASS | earned celebration |
| V | PASS | sem performance não provada |
| W | PASS | zero XP |
| X | PASS | Renewal sem cycle complete |
| Y | PASS | Renewal sem level unlock |
| Z | PASS | Renewal sem achievement |
| AA | PASS | Renewal neutro |
| AB | PASS | sparkles/alternativa, não trophy |
| AC | PASS | diff real aplicável |
| AD | PASS | cycle preservado |
| AE | PASS | sem XP futuro |
| AF | PASS | READY Defer |
| AG | PASS | defer 1 testado |
| AH | PASS | defer 2 testado |
| AI | PASS | copy treino atual ativo |
| AJ | PASS | copy próximo disponível |
| AK | PASS | Start fora do gate READY |
| AL | PASS | serviço manual não usa promptability |
| AM | PASS | copy auto após defer final |
| AN | PASS | earnedLevel vem do lifecycle |
| AO | PASS | aviso auto específico |
| AP | PASS | evento + storage no cold start |
| AQ | PASS | não depende de memória de render |
| AR | PASS | ack oculta evento |
| AS | PASS | copy auto Level |
| AT | PASS | copy auto Cycle |
| AU | PASS | copy auto Renewal neutra |
| AV | PASS | safe-surface gate |
| AW | PASS | filtro ProgramInstance ativa |
| AX | PASS | identity guards source/target |
| AY | PASS | replacements slot-aware |
| AZ | PASS | reorder multiset-only |
| BA | PASS | sets same-identity only |
| BB | PASS | reps same-identity only |
| BC | PASS | sem claim volume |
| BD | PASS | frequency somente change |
| BE | PASS | split somente change |
| BF | PASS | no-change neutro |
| BG | PASS | teste determinismo |
| BH | PASS | exerciseId identity |
| BI | PASS | rows factuais concisas |
| BJ | PASS | título Level |
| BK | PASS | título Cycle |
| BL | PASS | título Renewal |
| BM | PASS | adaptation sem pending/unlock |
| BN | PASS | earned/active separados |
| BO | PASS | teste promoção deferred |
| BP | PASS | 8A/8B regression |
| BQ | PASS | 8A/8B regression |
| BR | PASS | Renewal mesmo cycle |
| BS | PASS | target level |
| BT | PASS | 10/57/999 testados |
| BU | PASS | streak removido |
| BV | PASS | volume removido |
| BW | PASS | PR removido |
| BX | PASS | XP removido |
| BY | PASS | next-level metric removida |
| BZ | PASS | data real |
| CA | PASS | calendário mock não alcançável/removido |
| CB | PASS | Profile compartilha V2 VM |
| CC | PASS | resíduos Home/i18n removidos |
| CD | PASS | activatePendingEvolution |
| CE | PASS | deferPendingEvolution |
| CF | PASS | ref in-flight |
| CG | PASS | ref in-flight |
| CH | PASS | só fecha/reload em true |
| CI | PASS | só fecha em true |
| CJ | PASS | reload em status stale + listeners |
| CK | PASS | listener troca VM do modal |
| CL | PASS | finish flow não aguarda UI |
| CM | PASS | ack só AsyncStorage |
| CN | PASS | storage testado |
| CO | PASS | pre-ack reaparece |
| CP | PASS | pós-ack some |
| CQ | PASS | latest current instance |
| CR | PASS | failure non-blocking |
| CS | PASS | pt-BR completo |
| CT | PASS | en completo |
| CU | PASS | es completo |
| CV | PASS | parity/audit |
| CW | PASS | copy tests Renewal |
| CX | PASS | copy Level/Cycle |
| CY | PASS | sem thresholds crus |
| CZ | PASS | forbidden-copy tests |
| DA | PASS | Start/Ack labels |
| DB | PASS | Keep/Close labels |
| DC | PASS | modal semantics |
| DD | PASS | busy/disabled/loading |
| DE | PASS | theme token tests |
| DF | PASS | ScrollView/wrapping estrutural; device NOT_RUN |
| DG | PASS | reduce-motion desliga slide |
| DH | PASS | nenhuma ação gesture-only |
| DI | PASS | integração 8A verde |
| DJ | PASS | integração 8A verde |
| DK | PASS | integração 8A verde |
| DL | PASS | unit 8A verde |
| DM | PASS | unit 8A verde |
| DN | PASS | unit boundaries verde |
| DO | PASS | equivalence tests verdes |
| DP | PASS | autoridade 8B intacta |
| DQ | PASS | post-workout V2 |
| DR | PASS | stale prepare tests |
| DS | PASS | safety races verdes |
| DT | PASS | recovery tests verdes |
| DU | PASS | race tests verdes |
| DV | PASS | race tests verdes |
| DW | PASS | race tests verdes |
| DX | PASS | race tests verdes |
| DY | PASS | race tests verdes |
| DZ | PASS | rollout intacto |
| EA | PASS | kill switch intacto |
| EB | PASS | telemetry intacta |
| EC | PASS | Rules 345/91 |
| ED | PASS | CI audit verde |
| EE | PASS | nenhum novo no-op produtivo |
| EF | PASS | matrix view model |
| EG | PASS | synthetic-field tests |
| EH | PASS | copy tests |
| EI | PASS | structural + VM deferred |
| EJ | PASS | três autos testados |
| EK | PASS | storage/ack tests |
| EL | PASS | diff matrix |
| EM | PASS | i18n audit |
| EN | PASS | 3.967 unit |
| EO | PASS | 681 integration |
| EP | PASS | 345 Firestore Rules |
| EQ | PASS | 91 Storage Rules |
| ER | PASS | 1.179 Functions |
| ES | PASS | TypeScript root/functions |
| ET | PASS | opt-in skips conhecidos; críticos executados nas matrizes 8B/8C |

## 46. Residual Search

`rg` nas superfícies de produção ficou limpo para percentual composto, auto efêmero, calendário/data mock, fake metrics e claims antigos do diff. “benchPress” restante é ID/nome legítimo do painel Loads; preview numérica é dev-only. `ProgressionFeedbackModal`/motor V1 são módulos órfãos não importados pelo AppShell e não são alcançáveis.

## 47. Known Issues

- Visual QA em simulator/device, small screen, large text e screenshots: NOT_RUN; simulador existe, mas não há fixture lifecycle autenticado/preview route e não foi criado bypass só para produzir evidência.
- Não há RNTL; testes de componente são estruturais, conforme fallback autorizado.
- Histórico de cargas real ainda não existe; produção mostra empty state.
- Acknowledgement é device-local por decisão explícita; outro device explica o mesmo fato uma vez.

## 48. Production Readiness After 8D

Pronto quanto a correctness, truthfulness, autoridade, concorrência, Rules, i18n e gates automatizados. O pass visual em device permanece uma atividade normal de release, declarada como não executada e não mascarada como sucesso.

## 49. Remaining Work Outside Lifecycle V2

Persistência/histórico real de cargas e consistência, UI de questionário de Program Adaptation, eventual economia XP/achievements e automação E2E visual autenticada. Nada disso é necessário para a verdade do lifecycle atual.

## 50. Final Verdict

**FASE 8D COMPLETA.** Não resta percentual fake, Renewal como achievement, Start bloqueado durante defer, autoativação invisível/efêmera, diff inventado, adaptation unlock ou métrica Home fake alcançável. A única evidência não produzida foi QA visual em device/screenshot, reportada explicitamente como NOT_RUN conforme a regra da fase.
