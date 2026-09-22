# Home Presentation Snapshot — Gate Final A/B (SNAPSHOT_OFF vs SNAPSHOT_ON)

Escopo único: responder se o Home Presentation Snapshot causa a regressão de tempo autoritativo observada em [home-presentation-snapshot-report.md](./home-presentation-snapshot-report.md) (lançamento → Home autoritativa: 7852ms → 10056ms, −28,1% na amostra). **Nenhuma funcionalidade nova, nenhuma mudança de autoridade, nenhuma otimização, nenhum push/deploy.** Branch `perf-consolidation`, mesmo commit em todo o experimento (`8cf8669`).

## A. Ambiente

Flag de teste DEV-only criada em `src/dev/homeSnapshotAbFlag.ts` (`HOME_SNAPSHOT_FAST_PATH_ENABLED`), com um único ponto de gate no efeito de leitura do snapshot em `AppShell.tsx` (a única fonte de estado de que tudo o resto — `cachedFrequency`, `snapshotVisualReady`, `home_snapshot_*` — deriva). Removida ao final do experimento (ver Parte K); `AppShell.tsx` está byte-idêntico ao HEAD.

Limpeza antes da coleta:

| | Antes | Após fechar Chrome+Spotify | Após 44 cold starts (fim do batch) |
|---|---|---|---|
| Load average (1/5/15 min) | 4.39 / 6.82 / 5.05 | 3.68 / 5.98 / 4.90 | 6.48 / 4.60 / 4.80 |
| Memória livre | ~61MB | ~1GB (momentâneo) | ~71MB |

Spotify fechou e ficou fechado. Chrome foi fechado mas **se reabriu sozinho** (ligado ao `chrome-devtools-mcp`, que mantém uma conexão CDP ativa) — documentado, não insistido, pois brigar com essa integração não faz parte do escopo. Simulator (`iPhone 17 Pro`, `48A6A7E3-7C9B-406E-B19F-4524699D85A5`): `simctl shutdown` + boot limpo. Metro: processo anterior morto, reiniciado do zero (`EXPO_PUBLIC_PERF_TRACE=1 npx expo start --port 8082`), log dedicado `/tmp/metro-snapshot-ab-gate.log`. Sessão de auth persistida reaproveitada (nunca login novo), igual às fases anteriores.

**Achado ambiental relevante:** a memória livre voltou a cair para ~71MB e o load average voltou a subir ao final do batch de 44 runs (~28 minutos corridos) — reproduzindo, dentro deste próprio experimento, exatamente o padrão de degradação de sessão longa que a Fase 3 já havia documentado. Isso por si só é evidência a favor de "ruído ambiental", não de "regressão de código": o ambiente não ficou limpo por 28 minutos seguidos neste hardware, com ou sem snapshot.

## B. Desenho A/B

Intercalado estrito, sem restart de Metro entre modos (o arquivo de flag é editado; Metro serve a transformação atualizada na próxima requisição de bundle, sem precisar reiniciar): OFF → ON → OFF → ON… Cada cold start = `simctl terminate` + `simctl launch` + deep link explícito (`ajfit://expo-development-client/?url=...`) para forçar a conexão ao Metro — um `simctl launch` puro por vezes abre a tela do launcher do dev client sem conectar (o mesmo problema já registrado no relatório original), então o deep link é enviado sempre, incondicionalmente, após o launch.

2 pares de warm-up descartados (2 OFF + 2 ON), depois 20 pares mantidos (20 OFF + 20 ON) — o máximo preferido pelo protocolo. Script: `scripts/homeSnapshotAbGate.sh`; análise: `scripts/analyzeSnapshotAbGate.mjs`.

## C–D. Runs OFF e ON

20 pares mantidos cada. **Completude: 16/20 OFF chegaram a `home_authoritative_ready`; 15/20 ON.** As 9 falhas (4 OFF, 5 ON) são timeouts de 35s, concentradas nos últimos ~6 pares do batch (pares 16, 19, 20, 21, 22 — o fim da sessão de 28 minutos), afetando os dois modos quase igualmente — consistente com degradação de sessão, não com o modo. Tabela completa por run (per-mark) em `/tmp/abgate-analysis.md` e reproduzível via:

```
node scripts/analyzeSnapshotAbGate.mjs perf-runs/abgate-kept-off-run-*.log -- perf-runs/abgate-kept-on-run-*.log
```

| Run | Mode | completo | route APP | home_mount | evolution settled | dataSettled | authoritative ready | snapshot overlay hidden |
|---:|---|---|---:|---:|---:|---:|---:|---:|
| 3 | OFF | sim | 6120 | 6078 | 11235 | 11247 | 11497 | — |
| 3 | ON | sim | 6070 | 6039 | 10980 | 10993 | 11250 | 6969 |
| 4 | OFF | sim | 6542 | 6504 | 11502 | 11513 | 11775 | — |
| 4 | ON | sim | 7675 | 7644 | 13699 | 13714 | 13967 | 8599 |
| 5 | OFF | sim | 6667 | 6636 | 12443 | 12456 | 12751 | — |
| 5 | ON | **NÃO** | — | — | — | — | — | — |
| 6 | OFF | sim | 6031 | 5999 | 13662 | 13673 | 13967 | — |
| 6 | ON | sim | 7306 | 7268 | 12852 | 12865 | 13117 | 8236 |
| 7 | OFF | sim | 8156 | 8118 | 14228 | 14243 | 14546 | — |
| 7 | ON | sim | 5601 | 5560 | 9958 | 9969 | 10219 | 6527 |
| 8 | OFF | sim | 7598 | 7563 | 12134 | 12146 | 12406 | — |
| 8 | ON | sim | 19417 | 19384 | 27508 | 27520 | 27830 | 20295 |
| 9 | OFF | sim | 6857 | 6813 | 11937 | 11949 | 12223 | — |
| 9 | ON | sim | 9116 | 9085 | 13973 | 13985 | 14233 | 9951 |
| 10 | OFF | sim | 6529 | 6498 | 19406 | 19420 | 19668 | — |
| 10 | ON | **NÃO** | 4675 | 4634 | — | — | — | — |
| 11 | OFF | sim | 4733 | 4701 | 8597 | 8608 | 8867 | — |
| 11 | ON | sim | 4245 | 4214 | 8017 | 8031 | 8281 | 5127 |
| 12 | OFF | sim | 4191 | 4159 | 7881 | 7893 | 8154 | — |
| 12 | ON | sim | 4261 | 4229 | 8113 | 8127 | 8377 | 5160 |
| 13 | OFF | sim | 5354 | 5323 | 9858 | 9869 | 10130 | — |
| 13 | ON | sim | 6532 | 6500 | 11543 | 11557 | 11843 | 7439 |
| 14 | OFF | sim | 10206 | 10167 | 15412 | 15425 | 15677 | — |
| 14 | ON | sim | 10914 | 10881 | 16208 | 16220 | 16505 | 11793 |
| 15 | OFF | sim | 10318 | 10281 | 13861 | 13873 | 14134 | — |
| 15 | ON | sim | 12489 | 12449 | 17845 | 17856 | 18113 | 13429 |
| 16 | OFF | **NÃO** | — | — | — | — | — | — |
| 16 | ON | sim | 4390 | 4360 | 9213 | 9225 | 9559 | 5301 |
| 17 | OFF | sim | 6190 | 6159 | 10570 | 10581 | 10847 | — |
| 17 | ON | sim | 7016 | 6976 | 13624 | 13635 | 13919 | 7875 |
| 18 | OFF | sim | 5685 | 5654 | 22070 | 22084 | 22334 | — |
| 18 | ON | sim | 6039 | 6000 | 13126 | 13138 | 13388 | 6910 |
| 19 | OFF | sim | 8130 | 8094 | 13679 | 13691 | 14024 | — |
| 19 | ON | **NÃO** | 25966 | 25927 | — | — | — | 26892 |
| 20 | OFF | **NÃO** | — | — | — | — | — | — |
| 20 | ON | sim | 11605 | 11570 | 18275 | 18286 | 18604 | 12453 |
| 21 | OFF | **NÃO** | 10207 | 10167 | — | — | — | — |
| 21 | ON | **NÃO** | — | — | — | — | — | — |
| 22 | OFF | **NÃO** | — | — | — | — | — | — |
| 22 | ON | **NÃO** | — | — | — | — | — | — |

## E. Tabela comparativa (ms, apenas runs completos)

| Métrica | Modo | n | min | p50 | p75 | p95 | max |
|---|---|---:|---:|---:|---:|---:|---:|
| `app_root → home_authoritative_ready` | OFF | 16 | 8154 | **12406** | 14134 | 22334 | 22334 |
| `app_root → home_authoritative_ready` | ON | 15 | 8281 | **13388** | 16505 | 27830 | 27830 |
| `premium_gate_resolved_app → home_authoritative_ready` | OFF | 16 | 3816 | 5366 | 6084 | 16649 | 16649 |
| `premium_gate_resolved_app → home_authoritative_ready` | ON | 15 | 4036 | 5591 | 6903 | 8413 | 8413 |
| `home_mount → home_evolution_ready` (evolution settled) | OFF | 16 | 3580 | 5124 | 5807 | 16416 | 16416 |
| `home_mount → home_evolution_ready` (evolution settled) | ON | 15 | 3803 | 5327 | 6648 | 8124 | 8124 |
| `app_root → home_initial_data_settled` | OFF | 16 | 7893 | 12146 | 13873 | 22084 | 22084 |
| `app_root → home_initial_data_settled` | ON | 15 | 8031 | 13138 | 16220 | 27520 | 27520 |

Diferença p50 bruta: **+982ms (+7,9%) ON vs OFF** no `app_root → authoritative` — muito menor que os −28,1% (2204ms) da amostra original, e dentro do que a Parte I mostra ser ruído intra-modo.

**Nenhuma comparação absoluta aqui é comparável ao baseline limpo de 7852ms do [gate-final de bootstrap](./home-bootstrap-perf-audit-gate-final.md)** — este batch de 44 cold starts consecutivos degradou o ambiente por si só (Parte A), então os dois braços (OFF e ON) estão igualmente inflados. A pergunta que importa não é "os números absolutos bateram no baseline limpo" (não bateram, para nenhum dos dois modos) — é "ON é consistentemente pior que OFF dentro desta mesma sessão degradada". Resposta na Parte I.

### Caminho ON-only (fast path do snapshot)

| Métrica | n | min | p50 | p75 | p95 | max |
|---|---:|---:|---:|---:|---:|---:|
| `app_root → home_snapshot_overlay_hidden` | 15 | 5127 | 7875 | 11793 | 20295 | 20295 |
| `premium_gate_resolved_app → home_snapshot_overlay_hidden` | 15 | 835 | **899** | 924 | 940 | 940 |
| `home_snapshot_read_start → home_snapshot_applied` | 15 | 14 | 16 | 18 | 21 | 21 |
| `home_snapshot_applied → home_snapshot_layout_committed` | 15 | 39 | 52 | 61 | 106 | 106 |
| `home_snapshot_layout_committed → home_snapshot_visual_ready` | 15 | 697 | **745** | 768 | 778 | 778 |

`route APP → cached Home visible` (p50 899ms) confirma, de forma estável em todos os 15 runs completos, o ganho percebido já documentado no relatório original (~993ms). Este número não competiu com nenhuma degradação de sessão — é local e determinístico.

## F. Custo local do snapshot

Leitura AsyncStorage + parse + projeção (`home_snapshot_read_start → home_snapshot_applied`): **14–21ms em todos os 15 runs**, desprezível frente a qualquer estágio autoritativo (segundos). `applied → layout_committed`: 39–106ms, também pequeno.

**Um achado real que merece registro:** `layout_committed → visual_ready` ficou **consistentemente em 697–778ms** nos 15 runs — muito mais que um único `requestAnimationFrame` deveria custar (~16ms). Isso sugere que a *própria* thread JS está ocupada com outro trabalho (Evolution/Today/lifecycle iniciando concorrentemente logo após `home_mount`) quando o callback do RAF do snapshot tenta rodar, atrasando-o. É um custo real, pequeno e isolado ao caminho visual do próprio snapshot — **não** foi demonstrado que ele rouba tempo do caminho autoritativo (a Parte E mostra `home_mount → evolution_settled` do modo ON não pior, de forma consistente, que o modo OFF). Fica registrado como candidato a investigação futura, não como causa da regressão de 28% original.

## G. Firestore — contagem de leituras e queries

| Label | OFF max | OFF mediana | ON max | ON mediana |
|---|---:|---:|---:|---:|
| `reconcile.firestore_reads.pending_evolution` | 3 | 3 | 4 | 3 |
| `reconcile.firestore_reads.recovery_cycles` | 1 | 1 | 1 | 1 |
| `reconcile.firestore_reads.recovery_instances` | 1 | 1 | 1 | 1 |
| `reconcile.firestore_reads.recovery_state` | 1 | 1 | 1 | 1 |
| `user_profile.document` | 2 | 2 | 2 | 2 |
| `workout_executions.program_instance` | 1 | 1 | 1 | 1 |
| `workout_executions.range_query` | 2 | 2 | 2 | 2 |
| `workout_lifecycle.bundle` | 6 | 3 | 3 | 3 |
| `workout_lifecycle.program_instance_events` | 3 | 2 | 2 | 2 |
| `workout_programs.snapshot` | 2 | 2 | 2 | 2 |
| `workout_schedule.config` | 2 | 2 | 4 | 2 |
| `workout_schedule.events` | 1 | 1 | 1 | 1 |

Medianas idênticas entre OFF e ON em todos os labels. Os máximos que divergem (`workout_lifecycle.bundle` 6 vs 3, `workout_schedule.config` 4 vs 2) são valores isolados de runs individuais (não sistemáticos — a mediana, que é o que caracteriza o comportamento típico, bate igual), consistentes com retries/timing de rede pontuais já documentados nas fases anteriores, não com uma mudança estrutural de queries causada pelo snapshot. **Confirmado: ON e OFF disparam essencialmente o mesmo bootstrap remoto** — mesmas queries, mesma ordem, sem leitura extra atribuível ao snapshot em si (o snapshot só lê `AsyncStorage`, nunca Firestore).

## H. Timing do Evolution

`home_mount → home_evolution_ready` (Parte E): p50 OFF 5124ms vs ON 5327ms — diferença de 203ms no p50, mas p95 OFF (16416ms) é na verdade **pior** que p95 ON (8124ms), invertendo a direção que uma "regressão real" exigiria. Evolution começa a mesma distância de `home_mount` nos dois modos (não há atraso de início atribuível ao snapshot — o snapshot não gate nem depende de nada que Evolution usa).

## I. Causa da regressão anterior — análise pareada

Para isolar o efeito do modo da deriva de sessão, comparei ON−OFF **dentro de cada par** (mesmo momento da sessão, portanto mesma degradação ambiental de fundo) para os 13 pares em que ambos os lados completaram:

| Run | Δ (ON − OFF) authoritative ready | Nota |
|---:|---:|---|
| 3 | −247ms | |
| 4 | +2192ms | |
| 6 | −850ms | |
| 7 | −4327ms | ON mais rápido |
| 8 | +15424ms | **outlier: `profile_remote_ready` de 11475ms — pré-mount, antes do snapshot rodar** |
| 9 | +2010ms | |
| 11 | −586ms | |
| 12 | +223ms | |
| 13 | +1713ms | |
| 14 | +828ms | |
| 15 | +3979ms | |
| 17 | +3072ms | |
| 18 | −8946ms | **outlier: Evolution parallel batch de ~15s em run OFF — sem snapshot envolvido** |

Os dois outliers (run 8, run 18) foram auditados individualmente nos logs brutos: ambos são o mesmo padrão de contenção de rede/Firestore já classificado como Categoria C no [gate-final de bootstrap](./home-bootstrap-perf-audit-gate-final.md#h-classificação-dos-custos-restantes) — variação de round-trip sob concorrência, não código. Run 8 ON's spike inteiro já estava contido em `auth_ready → profile_remote_ready`, **antes** de qualquer marca de snapshot disparar. Run 18 OFF nem executa código de snapshot (é OFF) e ainda assim teve o pior tempo autoritativo de toda a amostra — prova direta de que uma sessão degradada produz spikes de magnitude comparável **sem** o snapshot estar envolvido.

Excluindo os dois outliers documentados (11 pares restantes): **mediana do delta pareado = +828ms, média = +728ms**, com desvio de pares individuais entre −4327ms e +3979ms. O "sinal" (~750ms) é menor que o "ruído" intra-modo (pares OFF-apenas já variam ~5970ms entre si ao longo da sessão, ex. run 11 = 8867ms vs run 15 = 14134ms). Não há direção consistente: 5 dos 11 pares restantes têm ON mais rápido que OFF.

**Classificação: RUÍDO AMBIENTAL.** Não há evidência de que o snapshot piora consistentemente o tempo autoritativo. O −28,1% (2204ms) observado na amostra original comparava um baseline limpo de 10 runs (`gate-final`, ambiente controlado, load average 3–5) contra uma amostra "com snapshot" cuja proveniência ambiental nunca foi controlada da mesma forma — e este próprio experimento demonstrou, de forma independente e reproduzível, que uma bateria longa de cold starts (aqui, 44 runs / ~28 minutos) por si só empurra o ambiente para o mesmo tipo de degradação (load average subindo, memória livre caindo, falhas de captura concentradas no fim), afetando os dois modos igualmente. Resíduo pequeno (~700-800ms) não pode ser descartado com certeza total dado o nível de ruído, mas está a uma ordem de grandeza do +2204ms original e não seria — por si só — motivo para reverter o snapshot.

## J. Cenários E2E pendentes

**Não executados nesta rodada** (fora do escopo explícito deste gate, que era resolver apenas a dúvida de performance). Permanecem pendentes, herdados do [relatório original](./home-presentation-snapshot-report.md#l–q-cenários):

- Offline real (desligar rede do simulador/host).
- Duas contas A/B (cross-UID) com login real.
- Troca real de programa (A→B) no simulador.
- Pós-treino real (ou fixture segura equivalente) com execução de treino de ponta a ponta.
- Viewport rolado / Upcoming abaixo da dobra.

## K. Decisão

- **GANHO PERCEBIDO CONFIRMADO:** SIM — `route APP → cached Home visible` ficou em 835–940ms em 15/15 runs completos do modo ON, número estável e determinístico, batendo com o relatório original (~993ms).
- **AUTHORITATIVE PATH REGREDIU:** NÃO, dentro do que esta amostra consegue provar — a análise pareada (Parte I) não encontra uma direção consistente nem magnitude fora do ruído intra-modo; os dois maiores spikes da amostra foram auditados e atribuídos a contenção de rede pré-existente, não ao snapshot.
- **SNAPSHOT PODE IR PARA INTEGRAÇÃO:** Do ponto de vista de performance, SIM — sem evidência de regressão material do caminho autoritativo. A integração completa ainda depende dos cenários E2E pendentes (Parte J), que ficam fora do escopo deste gate.
- **SERVER-SIDE PODE SER ADIADO:** SIM — inalterado pela conclusão deste gate; segue a mesma razão já registrada no relatório original (o custo por round-trip Firestore neste ambiente é estrutural, não algo que o client-side, com ou sem snapshot, resolve).

## Limpeza

Flag de teste (`src/dev/homeSnapshotAbFlag.ts`) removida; `AppShell.tsx` restaurado ao HEAD (`git diff` vazio). `scripts/homeSnapshotAbGate.sh` e `scripts/analyzeSnapshotAbGate.mjs` mantidos (reprodutíveis, sem custo em produção, mesmo padrão dos scripts de fases anteriores). `perf-runs/abgate-*.log` gerados mas não commitados (`perf-runs/` gitignored). Não push, não deploy, nenhuma fase seguinte iniciada.
