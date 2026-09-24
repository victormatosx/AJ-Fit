# Home Bootstrap Perf Audit — Gate Final Controlado

Encerramento das Fases 1-3 (`docs/home-bootstrap-perf-audit-phase{1,2,3}.md`). **Nenhuma otimização nova, nenhuma mudança de código de produção.** Objetivo único: obter um baseline final confiável, com ambiente limpo, para confirmar (ou não) a degradação observada no lote do Fase 3 e decidir se resta trabalho client-side seguro.

## A. Estado do ambiente

Limpeza executada antes da coleta:
- Metro (porta 8082) encerrado e reiniciado do zero (`EXPO_PUBLIC_PERF_TRACE=1 npx expo start --port 8082`), log dedicado (`/tmp/metro-gate-final.log`).
- Simulator (`iPhone 17 Pro`, `48A6A7E3-7C9B-406E-B19F-4524699D85A5`) desligado (`simctl shutdown`) e rebootado do zero antes de qualquer medição.
- Nenhum sibling worktree usado — todo o trabalho no worktree canônico `/Users/lucaslima/AJ-Fit`.

| | Antes da limpeza | Logo após boot do Simulator | Após estabilizar (pré warm-up) | Durante o batch de 10 (medido ao final) |
|---|---|---|---|---|
| Load average (1 min) | 3.55 | 23.09 (transiente, boot) | 5.22 | 3.06 |
| Memória livre | ~71MB (fim do Fase 3) | — | — | recuperada, sem pressão visível |

Branch: `perf-consolidation`. HEAD: `86d4875` (mesmo commit do fim do Fase 3 — nenhum código mudou entre os relatórios). Porta do Metro: `8082`. `firestore-debug.log` não commitado.

## B. 10 runs (após 2 warm-ups descartados)

Warm-ups: 2 execuções completas, `overlay_hidden` confirmado em ambas, descartadas da estatística.

10 runs reais, **10/10 chegaram em `home_initial_overlay_hidden`** (nenhuma falha de captura, diferente do Fase 3 que teve 1 run incompleto):

| Run | home_mount | today | evolution | dataSettled | overlayHidden | last blocker |
|---|---|---|---|---|---|---|
| 1 | 4273ms | 5975ms | 8861ms | 8873ms | 9176ms | evolution |
| 2 | 4130ms | 6116ms | 7928ms | 7939ms | 8208ms | evolution |
| 3 | 4103ms | 5837ms | 7827ms | 7838ms | 8102ms | evolution |
| 4 | 3999ms | 5776ms | 7577ms | 7589ms | 7852ms | evolution |
| 5 | 3967ms | 5606ms | 7413ms | 7424ms | 7687ms | evolution |
| 6 | 4051ms | 5754ms | 7466ms | 7477ms | 7743ms | evolution |
| 7 | 4470ms | 6283ms | 8079ms | 8091ms | 8358ms | evolution |
| 8 | 3467ms | 5365ms | 7134ms | 7146ms | 7408ms | evolution |
| 9 | 3730ms | 5731ms | 7252ms | 7263ms | 7568ms | evolution |
| 10 | 4348ms | 6111ms | 8368ms | 8379ms | 8646ms | evolution |

Sem erros, sem retries visíveis nos logs. Leituras duplicadas: idênticas em todos os 10 runs (`workout_lifecycle.bundle`×3, `workout_schedule.config`×2, `workout_programs.snapshot`×2, `user_profile.document`×2) — exatamente o estado deixado pelo Fase 2, confirmando que nada regrediu nem foi alterado.

## C. p50/p75/p95/min/max

| Estágio | min | p50 | p75 | p95 | max |
|---|---|---|---|---|---|
| `app_root → profile_remote_ready` | 1417ms | 1952ms | 2057ms | 2224ms | 2224ms |
| `profile_remote_ready → workout_readiness_ready` | 1715ms | **1785ms** | 1811ms | 1862ms | 1862ms |
| `app_root → home_mount` | 3125ms | 3682ms | 3826ms | 4048ms | 4048ms |
| `home_mount → evolution_settled` | 3415ms | 3609ms | 3798ms | 4588ms | 4588ms |
| `app_root → dataSettled` | 6804ms | 7241ms | 7669ms | 8426ms | 8426ms |
| `app_root → overlayHidden` | 7066ms | 7504ms | 7936ms | 8729ms | 8729ms |

(Marks brutos, não relativos ao `app_root`, para comparação direta com Fases 1/2: `dataSettled` p50 = **7589ms**, `overlayHidden` p50 = **7852ms**, `home_mount` p50 = 4051ms.)

## D. Comparação com Fase 2

| Métrica | Fase 2 (final) | Gate Final | Diferença |
|---|---|---|---|
| `dataSettled` p50 | 7683ms | **7589ms** | -94ms (-1.2%) |
| `dataSettled` p75 | 8048ms | 8091ms | +43ms (+0.5%) |
| `dataSettled` p95 | 8798ms | 8873ms | +75ms (+0.9%) |
| `overlayHidden` p50 | 7944ms | 7852ms | -92ms (-1.2%) |
| `last blocker` | evolution 6/6 | evolution 10/10 | igual |
| `workout_lifecycle.bundle` max | 3 | 3 | igual |
| `workout_schedule.config` max | 2 | 2 | igual |

**O lote limpo confirma a faixa do Fase 2 quase exatamente** (diferenças de ±1% são ruído normal de rede/sistema, não sinal). Isso confirma, com um baseline agora robusto (n=10 vs o n=6 do Fase 2), que **o lote degradado do Fase 3 (dataSettled p50 9433ms) foi puramente ambiental** — a instrumentação adicionada no Fase 3 não introduziu custo real algum.

## E. Critical path final

```
app_root
├── auth_ready (~920ms)
├── subscription_bootstrap (paralelo, ~50ms — nunca é o gargalo)
└── profile_remote_ready (~1.4s após auth)
     ├── preferences_reconciliation (paralelo, serial mas ~13ms — irrelevante)
     └── workout_readiness_ready (~1.79s após profile — MAIOR estágio individual do pré-mount)
          └── premium_gate_resolved_app / home_mount / appshell_mount / evolution_start (~simultâneos)
               └── evolution_settled (~3.6s depois — MAIOR estágio geral, já auditado nas Fases 1/2)
                    └── dataSettled → layoutCommitted → visualReady → overlayHidden (rápido, <400ms total)
```

Nenhuma waterfall nova. O caminho crítico é: `auth → profile → workout_readiness (prescription) → home_mount → Evolution`, com Activity/Frequency/Support sempre fora do caminho crítico (confirmado nas Fases 1/2, reconfirmado aqui implicitamente pelos mesmos padrões de leitura).

## F. Tempo efetivo olhando o loading

`overlayHidden` p50 = 7852ms (mark bruto) — este É o tempo que o usuário efetivamente vê o overlay de carregamento, do lançamento do processo até a Home aparecer completa. Consistente com o Fase 2 (7944ms), dentro da margem de ruído.

## G. Validação visual

3 cold starts com captura em dois momentos (meio do carregamento + após assentar):

- **Meio do carregamento** (todas as 3 execuções): overlay fullscreen com spinner, nenhum conteúdo de Home visível.
- **Após assentar** (todas as 3 execuções): Home completa — saudação, card "Treino de hoje" com exercícios/séries/mapa corporal, barra de evolução do programa ("AVANÇADO · CICLO 1"), "Esta semana", "Sua frequência", tab bar — tudo presente no mesmo frame.

Combinado com os 10 runs do batch principal, todos com a sequência de marks `dataSettled → layoutCommitted → visualReady → overlayHidden` disparando em ordem estrita (a mesma máquina de estados do `reduceHomeBootstrapState`, travada desde o Fase 1 e nunca alterada):

**PRIMEIRO FRAME COMPLETO = SIM. CARD ENTRA DEPOIS = NÃO. LAYOUT SHIFT = NÃO.**

## H. Classificação dos custos restantes

| Custo | Duração (p50) | Classificação | Justificativa |
|---|---|---|---|
| `auth_ready` (Firebase Auth restoration) | ~920ms | **A** | Inevitável no cliente atual — tempo do próprio SDK do Firebase Auth restaurando a sessão. |
| `auth_ready → profile_remote_ready` | ~1.4s | **A** | Round trip Firestore real (`getUserProfile` + `getLatestQuestionnaire`, já paralelos), necessário para decisão de roteamento (Paywall/Onboarding/App). |
| `profile_remote_ready → workout_readiness_ready` | ~1.79s | **A** | Cadeia `loadActiveWorkoutProgram` (lifecycle + program snapshot), necessária para saber se existe programa antes de rotear — já auditada nas Fases 1/2, sem waterfall de código encontrada. |
| `home_mount → evolution_settled` | ~3.6s | **A**, majoritariamente | Resolução autoritativa do Evolution, exigida pelo requisito visual aprovado (overlay não pode sair sem estado terminal). Fase 2 já confirmou que o custo por-leitura (~1-1.5s) é contenção real de conexão concorrente, não uma escolha de arquitetura client-side corrigível. |
| `user_profile.document`×2, `workout_programs.snapshot`×2, `schedule_config`'s 3ª leitura (dentro do `evolution_progression`) | soma pequena, paralela | **B** | Candidatos já identificados e adiados no Fase 2 — seguros mas exigem threading por múltiplos arquivos; ganho esperado é pequeno (a maioria roda em paralelo, não está no caminho crítico serial). |
| O custo de ~1.0–1.5s por round trip Firestore neste ambiente (contenção de conexão sob concorrência, Fase 2 Parte O) | — | **C** | Reduzir isso exigiria ou uma mudança de infraestrutura (região/latência de backend, agregação de leituras em um único endpoint/Cloud Function) ou uma reformulação maior de como os dados são buscados — além do escopo de dedupe seguro no cliente. |
| A própria natureza de "decisão de roteamento antes de montar" (`resolvePremiumGate`) | ~4.0s de pré-mount total | **C** | Não é bug nem código legado — é a arquitetura de roteamento (Paywall/Onboarding/App/verificação). Mudar isso exigiria redesenhar o fluxo de onboarding/comercial, não uma otimização pontual. |

## I. Decisão

- **BASELINE FINAL CONFIÁVEL:** SIM — 10/10 runs limpos, ambiente controlado e registrado, load average estável (~3-5) durante a coleta, sem falhas de captura.
- **HÁ REGRESSÃO REAL DESDE FASE 2:** NÃO — diferença de ±1% em todas as métricas principais, dentro do ruído normal. O lote degradado do Fase 3 foi confirmado como artefato ambiental, não código.
- **AINDA EXISTE OTIMIZAÇÃO CLIENT-SIDE SEGURA E MATERIAL:** NÃO, no sentido de "material" — restam apenas os candidatos Categoria B já mapeados no Fase 2 (`user_profile.document`, `workout_programs.snapshot`, o 3º read de `schedule_config`), todos pequenos e já paralelos, sem impacto relevante esperado no `dataSettled` percebido.
- **PRÓXIMO GANHO RELEVANTE EXIGE MUDANÇA ARQUITETURAL:** SIM — tanto o custo por-round-trip Firestore (~1-1.5s sob concorrência, Fase 2 Parte O) quanto a própria necessidade de resolver roteamento (Paywall/Onboarding/App) antes de montar Home são características estruturais, não bugs client-side. Qualquer ganho substancial futuro (aproximar de ~5-6s) exigiria trabalho server-side/infraestrutura ou uma mudança de arquitetura de dados, não mais dedupe ou paralelização no cliente.

Não push. Não deploy. Nenhuma nova implementação iniciada.
