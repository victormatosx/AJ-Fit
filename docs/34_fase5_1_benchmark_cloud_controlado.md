# Fase 5.1 — Benchmark Cloud Controlado (Evolution server-side)

Status: Fase concluída — **benchmark cloud bloqueado por ausência de ambiente não-prod**, conforme protocolo de segurança da própria fase. SEM deploy, SEM push, SEM migração, SEM alteração de Home.
Data: 2026-09-21
Branch: `perf-consolidation` @ `24a97e0` (continuação da Fase 5.0).

---

## A. Ambiente cloud disponível

```
git branch --show-current  → perf-consolidation
git rev-parse --short HEAD → 24a97e0
git status --short         →  M firestore-debug.log (+ artefatos não commitados da Fase 5.0)
```

`.firebaserc`:
```json
{ "projects": { "production": "ajfit-2f321" } }
```
Único alias existente é `production`. `functions/package.json` tem um script `deploy:staging` (`firebase deploy --only functions --project staging`) mas **não existe alias `staging` em `.firebaserc`** — o script é órfão/aspiracional, não funcional hoje.

`firebase projects:list` (read-only, CLI autenticado) retornou **9 projetos** na conta, dos quais **apenas 1 é o AJ-Fit** (`ajfit-2f321`, produção). Os outros 8 são projetos de apps completamente diferentes e não relacionados (AgroCorte, CarbonSense, SmartCommission, DashboardQuizEmagrecimento, Ecomerce Reveste Mais, ORDERMILK, pratica02-lucasvlima, RevesteMaisPintores) — nenhum é um ambiente staging/dev/test do AJ-Fit.

---

## B. Projeto usado

**Nenhum.** Não foi criado, configurado nem usado nenhum projeto cloud para o benchmark — nem produção, nem novo.

Confirmado com o usuário (pergunta explícita feita antes de prosseguir): a decisão foi **parar e reportar o bloqueio**, sem autorizar criação de um projeto staging novo nesta sessão.

Frase de protocolo, conforme pedido: **"benchmark cloud bloqueado por ausência de ambiente não-prod."**

---

## C. Região (levantamento read-only do projeto de produção, sem deploy)

- Functions: nenhum `setGlobalOptions`/região explícita no projeto (exceto `cleanupPhotoVaultOrphans` → `us-central1`) → default 2nd-gen = `us-central1`. (Já confirmado na Fase 5.0.)
- Firestore: `firebase firestore:databases:list --project ajfit-2f321 --json` → `locationId: "nam5"` (multi-região North America, cujos pontos de replicação incluem `us-central1`).
- Runtime: Node 22.

Region fit: **adequado** — `us-central1` está dentro da multi-região `nam5`, não há distância geográfica relevante a documentar. Isso não muda a recomendação, mas remove uma variável de incerteza que a Fase 5.0 tinha deixado em aberto.

Nenhuma alteração de região foi feita.

---

## D. Benchmark client warm — NÃO EXECUTADO

## E. Benchmark server warm — NÃO EXECUTADO

## F. Cold starts comprovados — NÃO EXECUTADO (0 de 5 obtidos)

## G. Comparação (client vs server warm vs server cold) — SEM DADOS

Todos os quatro itens acima dependem de um ambiente cloud não-produtivo, que não existe (§A/§B). Não foi fabricado nenhum número, nenhuma estimativa disfarçada de medição, e nenhum teste foi rodado contra o projeto de produção. Isso é uma conclusão válida da fase, não uma lacuna escondida — reportada explicitamente como bloqueio, conforme o protocolo pedido.

---

## H. Tempo interno server vs tempo total callable — SEM DADOS (mesmo motivo)

---

## I. Equivalência funcional

Trabalho local (sem cloud) avançado nesta fase, via TDD estrito contra Firestore Emulator real:

- Suíte do protótipo agora tem **12 testes de integração** (11 da Fase 5.0 + 1 nova fixture EARNED), todos passando (`Tests 12 passed (12)`), `tsc --noEmit` limpo.
- **Bug real encontrado e corrigido durante a construção da fixture EARNED** (não é só cobertura nova): `serverEvaluateProgression.ts` passava `program.sessions` cru como `prescribedSessions` para `isValidProgressionSessionAgainstPrescription`, mas o schema Firestore usa um campo numérico `sets` por exercício enquanto essa função espera `setCount`. Sem o mapeamento `sets→setCount` (que o cliente já faz em `loadAuthoritativePrescribedSessions`, `src/services/workoutProgressionV2.ts:33-60`), `validSessionCount` ficava **silenciosamente zerado** — não era específico da fixture nova, afetava qualquer cenário do protótipo com execuções reais, incluindo potencialmente resultados das fixtures anteriores que envolviam execuções. Corrigido replicando a mesma conversão do cliente.
- Isso reforça, empiricamente, a razão de exigir TDD e fixtures reais em vez de aceitar "a lógica é compartilhada, logo está correta" como prova suficiente — a lógica de decisão pura (`evaluateProgressionV2`) é de fato compartilhada e correta via ADR-016, mas a camada de **orquestração/tradução** (Admin SDK → `ProgressionSnapshotV2`) é código novo deste protótipo e já continha um bug real antes de ser testada com um cenário de execuções earned.

---

## J. Fixture EARNED

Adicionada: `LEVEL_PROMOTION_ELIGIBLE` (BEGINNER→INTERMEDIATE) — o branch EARNED mais simples de `evaluateProgressionV2` (não depende de `earnedIntermediateCycleCount`, que só entra em INTERMEDIATE→ADVANCED). A fixture calcula as datas prescritas MON/WED/FRI reais a partir da data corrente (não hardcoded), replicando a rotação de `buildExpectedSessionIndexByDate`, e gera `workoutExecutions`+`scheduleEvents` consistentes.

TDD real: RED confirmado primeiro (`expected 'PROGRESS_CONTINUES' to be 'LEVEL_PROMOTION_ELIGIBLE'`), GREEN depois do fix do bug de §I.

Isso prova equivalência funcional do caminho server-side para **pelo menos uma progressão real suportada**, conforme pedido — não apenas para o branch `PROGRESS_CONTINUES` da Fase 5.0.

---

## K. Lacunas — reclassificadas nesta fase

Investigação read-only dedicada (Passo 13), não apenas repetição da Fase 5.0:

| Lacuna | Classificação | Evidência |
|---|---|---|
| **Flex schedule** | **BLOCKER** | Opção de onboarding real, simétrica a `fixed` (`src/onboarding/questionDefs.ts:54-58`), shipped via `4b81d87 feat(schedule): support flexible onboarding and progression` — feature completa, sem flag, sem WIP. Cliente já implementa fim-a-fim (`workoutProgressionV2.ts:330-379`, `resolver.ts:59-69`, `MyPlanScreen.tsx:424-430`). Qualquer conta que escolheu "flexible" não pode ser avaliada pelo protótipo hoje. |
| **Fallback legado de questionnaire** | **BLOCKER** (por ora) | ADR-012 (Phase 8A, 2026-08-29 — **~3 semanas antes de hoje**): migração é *lazy*, só ocorre na próxima ativação real; **sem backfill no repo**. Contas com `ProgramInstance` pré-8A continuam no fallback indefinidamente até reativarem. Sem acesso a dados de produção, não é possível quantificar quantas contas reais ainda dependem disso — mas a ausência de backfill e a proximidade temporal da Phase 8A tornam implausível que seja uma cauda desprezível. Vira **LEGACY COMPATIBILITY REMOVÁVEL DEPOIS** somente após (a) confirmar via query real que zero `programInstances` ativos carecem de `prescriptionInputSnapshot`, ou (b) rodar uma migração de backfill explícita — nenhuma das duas existe ainda. |

**Conclusão de §K: nenhuma migração de Opção A para produção pode avançar sem fechar pelo menos um dos dois blockers (ou provar, com dado real de produção, que o fallback legado não tem mais tráfego).**

---

## L. Impacto projetado em Evolution total

Sem dados de D-H, isso é qualitativo, não uma extrapolação numérica de benchmark — deliberadamente, para não repetir o erro de "não fingir cold start" aplicado a latência também.

- Fase 5.0 mediu **12 ondas sequenciais** no cold start dominante de Evolution (NO_ACTION). Opção A, mesmo no cenário ótimo (RTT de progression caindo a praticamente zero do lado cliente), ataca só as ondas 7-9 — **3 das 12**.
- As ondas 1-6 e 10-12 (recovery, pending duplicado 2×, outstanding, hydration, events duplicado 2×) **não são tocadas** pela Opção A e não devem ser somadas como se fossem eliminadas — eliminar essas exigiria Opção B/C (maior risco, não avaliada em benchmark real nesta fase) ou, mais simples, deduplicar as leituras client-side já identificadas na Fase 5.0 (fora do escopo desta fase).
- **Não é correto projetar "Evolution caindo de ~4s para X"** sem o dado real de warm/cold da Opção A — o que temos é: mesmo no melhor caso teórico, o piso não cai abaixo do tempo das 9 ondas restantes + overhead de callable (desconhecido, bloqueado em §D-H).

---

## M. Custo operacional

Sem mudança em relação à Fase 5.0 §M — nenhum dado novo de custo real por invocação foi coletado (bloqueado por §B). Seguem válidas as conclusões qualitativas: sem `minInstances`, custo incremental por invocação é pequeno; o risco real é cold start, não o custo monetário.

---

## N. Cold-start risk

Sem alteração — nenhuma função do projeto tem `minInstances` (confirmado de novo nesta fase via mesma configuração, nada mudou desde a Fase 5.0). **Esta continua sendo a maior incerteza não resolvida da arquitetura proposta**, e esta fase não conseguiu reduzi-la porque o benchmark cloud que mediria isso está bloqueado.

---

## O. Progressive rendering — mapeamento completo (Passo 17)

Área Evolution na Home (`EvolutionTicker` + `ProgramProgressStrip`, mais o modal `EvolutionUnlockScreen`):

| Elemento | Classe | Comportamento atual |
|---|---|---|
| Ticker "loading"/"error"/oculto (UNAVAILABLE) | **A** | Já tem label estático de loading — sem skeleton |
| Ticker: nível ativo, nota de nível ganho, dias ativos, sessões completas, qualidade de adesão | **A** | Só aparece após `load()` resolver completamente — hoje **nada** é mostrado antes disso |
| Ticker: item de proximidade (`proximityFromDecision`) | **B** | Depende da leitura autoritativa da decisão (não da mutação) |
| Ticker: card de ação ("pronto"/"auto-ativado", CTA "ver evolução") | **B** | Anuncia pending evolution existente — precisa do reconcile autoritativo, mas só abre uma tela de revisão, não muta nada |
| `ProgramProgressStrip`: título, nível/ciclo | **A** | Componente retorna `null` inteiro em LOADING/UNAVAILABLE/ERROR — comentário no código já reconhece que depende do ticker acima para feedback de loading |
| `ProgramProgressStrip`: barra de progresso segmentada | **B** | Deriva de `summary.proximity` (decisão de progression) |
| `ProgramProgressStrip`: label de status, chevron/tap | **B** | Mesma dependência |
| `EvolutionUnlockScreen`: título, "o que mudou", stat de sessões | **B** | Tela inteira só monta após `EVOLUTION_READY`/`EVOLUTION_DEFERRED`/`AUTO_ACTIVATION_NOTICE` — sem skeleton |
| `EvolutionUnlockScreen`: CTA "Iniciar"/"Ativar" e "Manter atual"/"Adiar" | **C** | Mutação real — precisa da decisão completa + grant de autoridade |

**Achado central: hoje, zero elementos da área Evolution mostram qualquer conteúdo — nem cache, nem estado anterior com label — antes do `load()` resolver 100%.** Todos os itens classe A (nível ativo, ciclo, dias ativos, sessões completas, adesão) vêm de contexto de lifecycle/sessão anterior, não da decisão fresca deste cold start — são os melhores candidatos a aparecer imediatamente com rótulo de "atualizando". Não implementado nesta fase, apenas mapeado.

---

## P. Segurança

Sem mudança de superfície: a fixture EARNED e o fix de §I não alteraram o padrão de auth/validação (`request.auth.uid` único, payload forjado rejeitado, zero writes). Nenhum novo risco introduzido.

---

## Q. Git / Cloud cleanup

- **Cloud**: nada foi criado, nada para limpar — nenhum recurso cloud foi provisionado nesta fase.
- **Git**: arquivos novos (protótipo atualizado + testes + este relatório + o da Fase 5.0) permanecem no worktree. `firestore-debug.log` excluído de qualquer commit, conforme instruído. Nenhum push foi feito.

---

## R. Recomendação

1. **Server-side warm é materialmente mais rápido?** Não determinável — benchmark bloqueado.
2. **Quanto?** N/A.
3. **Cold start é pior que cliente direto?** Não determinável empiricamente; o risco estrutural (zero `minInstances` em todo o projeto) permanece sem evidência a favor ou contra.
4. **Quanto?** N/A.
5. **No mix realista warm/cold, ainda vale?** Não determinável sem dado real — não deve ser assumido.
6. **O ganho provável em Evolution TOTAL é relevante?** Mesmo no cenário ótimo, Opção A ataca só 3 das 12 ondas medidas na Fase 5.0 — ganho parcial por construção, não resolve o total sozinho.
7. **Opção A deve avançar?** Não ainda. Precisa, nesta ordem: (a) ambiente cloud não-prod real para o benchmark do Passo 6-9, (b) fechar os dois BLOCKERs de §K.
8. **Precisamos completar flex/legacy primeiro?** Sim — ambos confirmados como BLOCKER nesta fase, não apenas compatibilidade legada.
9. **Progressive rendering oferece melhor relação risco/benefício?** Sim, claramente — zero risco de autoridade (não muda nenhuma decisão, só ordem de exibição de dados já lidos), zero infraestrutura nova necessária, e o mapeamento em §O mostra que hoje 100% dos elementos esperam o `load()` completo mesmo quando parte da informação (classe A) já está disponível de sessão anterior.

---

## S. Decisão

**FASE 5.1 CONCLUÍDA: SIM** — o objetivo da fase (determinar se um benchmark cloud controlado é executável com segurança e, adicionalmente, fechar os itens locais pendentes da Fase 5.0: fixture EARNED e auditoria flex/legacy) foi cumprido. O benchmark cloud em si ficou bloqueado pelo próprio protocolo de segurança pedido — isso é uma conclusão válida da fase, não uma pendência.

**MIGRAÇÃO SERVER-SIDE RECOMENDADA: AINDA NÃO**

**PRONTO PARA FASE 5.2: NÃO** — faltam, na ordem: (1) um ambiente Firebase não-produtivo real e autorizado para o benchmark cloud, (2) fechar os BLOCKERs de flex schedule e fallback legado de questionnaire no protótipo (ou provar com dado real de produção que o fallback legado está extinto).
