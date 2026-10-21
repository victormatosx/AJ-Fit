> Registro histórico: o sistema musculoesquelético e as políticas clínicas V3/legacy descritos aqui foram descontinuados. Não são contratos atuais. Ver [remoção definitiva](../removal-physical-limitations/REPORT.md).

# AJ Fit — Etapa 4: auditoria rigorosa e independente da V3 (relatório final)

Auditoria adversarial, não implementação. Nenhum arquivo de produção foi modificado nesta etapa. `ACTIVE_SUBSTITUTION_POLICY` permanece `'legacy'` — confirmado por leitura direta e por grep exaustivo (`src/`, `functions/src/`, `scripts/`): nenhum ponto de chamada de produção passa `policy:'v3'`, nenhuma configuração remota/Firestore/env var pode sobrescrevê-lo. Nenhum commit, push, deploy ou escrita real foi realizado. Todas as contagens abaixo foram **recalculadas de forma independente** (parser próprio, escrito do zero, nunca reaproveitando o script de importação) — não aceitas por igualdade de números dos relatórios anteriores.

Método: quatro investigações independentes foram conduzidas em paralelo (cada uma com script próprio, fora do repositório, em `/private/tmp/.../scratchpad/`), mais a reverificação direta do dataset e a reexecução completa das suítes de teste, todas sintetizadas abaixo.

---

## A. Resumo executivo

- **A V3 está tecnicamente correta na importação dos dados?** Sim — confirmado por um reparse independente byte-a-byte da planilha: 0 erros de resolução de nome, 0 divergências de prioridade, 0 relações ausentes/duplicadas/mal associadas, hash da planilha fonte confere.
- **Está segura?** Nas verificações exaustivas realizadas (120 exceções editoriais × todas as regiões ativas; 352.170 pares candidato×par-de-regiões), **zero violações de segurança musculoesquelética** foram encontradas. Nenhuma exceção editorial libera equipamento, disponibilidade operacional ou perfil de limitação. Isso é uma evidência forte, não uma garantia absoluta — ver pendências de revisão clínica abaixo.
- **Está completa?** Não. Das 203 relações bloqueadas investigadas individualmente, **51 (25%) são possíveis falsos bloqueios** e **50 (25%) têm um defeito de dado real** (perfil de limitação ausente de um dos lados). Isso é material, não um detalhe.
- **Pode substituir o legado?** Não ainda. Foi encontrada uma lacuna crítica de preservação: **nenhuma sessão fixa a política de substituição no momento da criação** — se a flag global for alternada no futuro, execuções já em andamento seriam avaliadas pelas regras V3 na próxima substituição solicitada, contradizendo a garantia de "nunca retroativamente" afirmada no relatório de integridade da Etapa 3.
- **Principais bloqueios**: (1) lacuna de fixação de política por sessão (P0, segurança de ativação); (2) 50 relações com perfil de limitação ausente (P1, dado); (3) 51 possíveis falsos bloqueios por critério de mecânica/padrão excessivamente estrito sem exceção editorial (P1/P2); (4) cobertura esparsa da planilha para combinações de múltiplas limitações (P2, decisão editorial, não bug); (5) os 41 rascunhos inativos continuam bloqueando um número concreto de âncoras reais (ex.: `incline-dumbbell-bench-press` tem suas duas melhores alternativas V3 como rascunhos, ficando sem nenhuma alternativa utilizável hoje).

---

## B. Integridade do dataset (reverificada de forma independente)

Um parser Python **inteiramente novo**, escrito sem reutilizar `scripts/importSubstitutionsV3.py`, releu a planilha diretamente (incluindo os 4 arquivos de comentário) e comparou contra `docs/substitutions-v3/dataset.json`.

| Item | Resultado |
|---|---|
| Hash SHA-256 da planilha fonte | `01ef1ba8...` — idêntico ao registrado no dataset |
| Grupos (`rules`) reconstruídos de forma independente | 556 — idêntico |
| Relações principais reconstruídas | 1.156 — idêntico |
| Erros de resolução de nome (independente) | **0** |
| Divergências de prioridade/alvo/ordem (independente) | **0** |
| Divergências de presença de exceção editorial por célula (independente) | **0** |
| `REVISAR` | 26 (5 academia + 21 casa) — confirmado |
| `SEM SUBSTITUIÇÃO ACEITA` | 1 (`dumbbell-fly` + `shoulder`, casa) — confirmado |
| Alternativas condicionais | 139 — confirmado, nunca candidatas em `editorialCandidatesV3` |
| Exceções editoriais (comentários de célula) | 120 — confirmado via contagem bruta dos 4 arquivos XML de comentário (4+7+66+43=120), todas atribuídas à célula exata, nenhuma a uma linha errada |
| Comentários não reconhecidos | 0 — todo comentário real da planilha corresponde a um dos 2 textos canônicos |
| Identidades (130 catálogo + 6 atividades + 41 rascunhos) | 177 — regeneradas do código-fonte atual nesta etapa, byte-idênticas ao dataset |
| Sobreposição rascunho×operacional | 0 |

**Nenhuma inconsistência encontrada na importação.** Isso NÃO significa que o conteúdo semântico das relações esteja todo correto — ver seção C. A importação é uma tradução fiel da planilha; os problemas encontrados abaixo são do próprio conteúdo editorial ou dos dados de catálogo, não da transcrição.

---

## C. As 203 relações bloqueadas — classificação individual

Recontagem independente confirmou exatamente 203 (`bothOperationalSeeded && legacyRejected && !eligibleInIsolatedV3Engine`, recomputado do zero a partir do array bruto). Cada uma foi avaliada individualmente contra os dados reais de `movement.pattern`, `target.primaryMuscle`, `movement.mechanic`, `equipment` e `limitationProfile` dos dois exercícios envolvidos (tabela completa em `/private/tmp/.../scratchpad/etapa4/blocked203_table.md`, 203 linhas).

| Classificação | Quantidade | % |
|---|---:|---:|
| **A — Bloqueio correto** | 22 | 11% |
| **B — Possível falso bloqueio** | 51 | 25% |
| **C — Revisão editorial necessária** | 80 | 39% |
| **D — Problema de dados** | 50 | 25% |

### A — Bloqueio correto (22)
Padrão de movimento E músculo primário genuinamente diferentes (ex.: `reverse-hack-squat-unilateral → bulgarian-split-squat-dumbbell`: squat vs. lunge, glúteos vs. quadríceps), ou equipamento `slider`/`stationary_bike` corretamente fora do conjunto doméstico. Esses bloqueios estão certos.

### B — Possível falso bloqueio (51)
**Todos no contexto `common`** (não clínico). Em todos, fonte e alvo compartilham exatamente o mesmo `movement.pattern` e `target.primaryMuscle`, e são rejeitados **somente** por `ROLE_MISMATCH`/mecânica (compound vs. isolation) — estruturalmente idêntico à forma das 120 relações que já receberam exceção editorial, mas estas nunca receberam um comentário na planilha. Exemplos: `resistance-band-pullover → bar-lat-pulldown` (só mecânica difere), `bench-dips → cable-triceps-pushdown` (só mecânica difere), `front-raise → dumbbell-shoulder-press` (mesmo músculo, padrão raso diferente mas declarado equivalente editorialmente). **Isso é o achado mais acionável desta auditoria**: não é um problema de segurança, é uma inconsistência editorial — a planilha aprovou a relação, mas nunca marcou a exceção de mecânica que ela precisaria para passar pelo mesmo gate que já libera as outras 120.

### C — Revisão editorial necessária (80)
**Todos no contexto `musculoskeletal`** — mesma assinatura de divergência de padrão/mecânica que a categoria B, mas sob uma limitação ativa, onde a diferença biomecânica tem implicação de segurança real que uma heurística de metadado de catálogo não pode responsavelmente decidir. Exemplo: `incline-dumbbell-bench-press → pec-deck-machine-fly` sob limitação de ombro/cotovelo/coluna — mesmo músculo (peito), mas padrão `horizontal_push` vs. `horizontal_adduction`; pode ser uma adaptação segura e até preferível sob certas limitações, ou pode não ser — **isto exige revisão profissional, não é determinável apenas pelo código**. Nenhuma dessas 80 foi tratada como aprovada nesta auditoria.

### D — Problema de dados (50)
Todas com `LIMITATION_PROFILE_MISSING` em um dos dois lados da relação — a relação nunca pode ser avaliada, independente de equivalência, porque falta o perfil de limitação de um exercício (ex.: `one-arm-dumbbell-row → low-cable-row-close-supinated-grip`: o alvo não tem `limitationProfile`). Isso é a mesma divergência pré-existente já documentada na auditoria original (seed local sem perfis completos) — não uma regressão desta etapa, mas uma pendência real de dados que bloqueia 50 relações musculoesqueléticas que, de outra forma, poderiam ser avaliadas.

### Verificação de segurança sobre os 120 já aceitos
Checagem exaustiva (não amostral): para cada uma das 120 exceções editoriais, confirmado que a exceção nunca é aplicada se o perfil de limitação do alvo para a região ativa for `avoid`/`pending`/inválido — **0 violações em 120 verificações**. A exceção nunca "vaza" para o gate de segurança.

---

## D. Análise da cobertura — por que caiu tanto

**Metodologia confirmada equivalente** (reimplementada de forma totalmente independente, sem reaproveitar `scripts/auditSubstitutionsV3.ts`): mesmos 102 templates, mesmos 127 cenários de região não-vazios, mesmo catálogo (`SHARED_LIMITATION_CATALOG` é construído uma única vez, independente da política — confirmado por leitura direta, não há troca de catálogo entre legado/V3), mesmo critério de sucesso (`status === 'COMPOSED'`), mesmos denominadores (714 = 102×7 regiões isoladas; 12.954 = 102×127 combinações não-vazias). Os números recalculados coincidem exatamente com os relatados: legado 102/629/8.932, V3 isolada 102/117/321. **A comparação é justa.**

Decomposição por causa, sobre 202.481 decisões de exercício bloqueadas através de todos os 12.954 cenários (e separadamente sobre o subconjunto de 2.298 decisões dos 714 cenários de região única):

| Causa | Todas as combinações | Só região única |
|---|---:|---:|
| 1. Nenhuma relação editorial autorizada para a região ativa (planilha nunca cobriu esse par exercício×região) | 189.356 (93,5%) | 169 |
| 2. Estado bloqueado (`REVISAR`/`SEM SUBSTITUIÇÃO ACEITA`) para a região ativa | 6.892 | **1.025** (maior causa isolada em região única) |
| 3. Perfil de limitação ausente/inválido | 590 | 396 |
| 4. Regra de equipamento | 0 como causa isolada | 0 |
| 5. Incompatibilidade de padrão de movimento (sem exceção) | 1.710 | 632 |
| 6. Falta de alternativa comum entre múltiplas limitações (interseção vazia apesar de cada região ter candidato individualmente) | 3.190 (1,6% dos cenários multi-região) | n/a (exige 2+ regiões) |
| 7. Divergência de IDs/classificação | 0 como causa isolada | 0 |
| 8. Erro de implementação do motor V3 | **0 encontrado** | 0 |
| Colisão de slot já usado na sessão (não é uma lacuna real) | 725 | 64 |
| Não classificado | 18 | 12 |

**Achado central: ~93,5% da queda em cenários multi-região é cobertura esparsa da planilha**, não um defeito do motor. A aba de limitações da V3 cobre um subconjunto pequeno das combinações exercício×região possíveis (consistente com o próprio número já documentado na auditoria original: só 164 de 910 pares academia tinham declaração explícita na V2). O motor legado mascarava essa esparsidade com fallback por família/similaridade; a V3, por desenho, falha fechado em vez de inventar uma alternativa não aprovada. Isso é uma consequência correta e esperada do requisito 2/7 da Etapa 3 — não um bug.

**Nenhum bug do motor V3 foi encontrado** (causa 8 = 0). Um ponto de desenho, não um bug, merece decisão humana explícita: a interseção entre regiões ativas (`editorialCandidatesV3`) exige que todas as regiões concordem na **ordem relativa** dos candidatos sobrepostos, não só na membership — duas regiões que aprovam os mesmos exercícios X e Y mas em ordem oposta produzem interseção vazia em vez de escolher uma ordem por algum critério de desempate. Isso amplifica a queda multi-região além da pura esparsidade de dados. Recomendo confirmação explícita de que esse comportamento fail-closed é intencional (parece ser, pelo comentário no próprio código), mas o impacto quantitativo (parte dos 3.190 casos da causa 6) não havia sido medido antes.

**A diferença de cobertura não é um erro de comparação.** É real, nos pontos corretos, e majoritariamente rastreável a conteúdo editorial ausente — não a um defeito de engenharia.

---

## E. Simulações de usuários sintéticos

| # | Perfil | Resultado |
|---|---|---|
| 1 | Academia, sem limitações | Compõe normalmente. |
| 2 | Casa, sem limitações | Compõe normalmente. |
| 3 | Academia, ombro | Bloqueio de segurança limpo quando não há alternativa aprovada — sem exceção de código, sem oferta insegura. |
| 4 | Casa, joelho | Idem. |
| 5 | Lombar (`back`/`spine`) | Idem. |
| 6 | Duas limitações simultâneas (ombro+cotovelo) | Interseção reduzida corretamente; bloqueio limpo quando vazia. |
| **7** | **Três ou mais limitações simultâneas** | **Todos os 6 templates amostrados (academia e casa) falharam a compor inteiramente.** Esta é a ilustração concreta do número 321/12.954 — não é hipotético, é o comportamento real hoje. |
| 8 | Casa com poucos equipamentos | O resolvedor respeita corretamente um contexto de equipamento restrito quando um é fornecido — mas **o caminho de composição de produção nunca fornece um**: está fixado em `unrestrictedEquipmentContext`, uma lacuna pré-existente do v1.27 herdada sem alteração pela V3 (não é uma regressão desta etapa, mas é uma lacuna real e já existente). |
| 9 | Preferência permanente | Aplicada corretamente quando válida; colisão trata corretamente (mantém o prescrito, nunca escolhe uma terceira opção). |
| **10** | **Treino em andamento / retorno a uma âncora real** | Achado concreto: para `incline-dumbbell-bench-press`, as duas melhores alternativas V3 (`dumbbell-flat-bench-press`, `incline-barbell-bench-press`) são **ambas rascunhos dos 41 inativos** — esse exercício real, hoje, não tem nenhuma alternativa V3 utilizável. |
| 11 | Programa antigo (`templateSourceVersion` legado) | Caminho legado completamente isolado e não afetado pela V3. |
| 12 | Reversão ao original | `evaluateRevertToAnchor` funciona de forma idêntica sob legado e V3 (nunca exige autorização editorial, por desenho). |

Distinção aplicada consistentemente: falha de montagem (`BLOCKED`) ≠ ausência de substituição disponível ≠ bloqueio intencional de segurança. Nenhum cenário produziu uma oferta insegura ou um erro não tratado.

---

## F. Segurança musculoesquelética

- Cobertura de perfil no catálogo real usado pelo resolvedor: **95 aprovados / 35 ausentes / 0 inválidos** sobre 136 exercícios operacionais — números que coincidem com a auditoria pré-V3 original (não fabricados nesta etapa).
- **120 exceções editoriais verificadas exaustivamente (não por amostragem)**: 0 casos em que a exceção permitiu ignorar um perfil `avoid`/`pending`/inválido na região ativa.
- **352.170 pares candidato × combinação de 2 regiões verificados exaustivamente**: 0 casos de candidato aceito sem ser terminal (`compatible`/`not_applicable`) simultaneamente em todas as regiões ativas.
- Nenhuma liberação indevida encontrada. 80 casos (categoria C da seção C) permanecem como **pendentes de revisão especializada** — não foi emitido nenhum veredito clínico definitivo para eles, conforme instruído.
- As 50 relações da categoria D (perfil ausente) são tratadas corretamente como indisponíveis — "ausência de perfil" nunca é interpretada como "seguro por omissão" (confirmado no código e no comportamento).

---

## G. Compatibilidade e preservação de usuários existentes

| Risco investigado | Nível | Evidência |
|---|---|---|
| **Sessão em andamento não tem política fixada no momento da criação** | **ALTO** | Nenhum documento de sessão/programa armazena um campo `policy`/`substitutionPolicy`. `isRequestedSubstitutionEligible`/`evaluateManualSubstitutionCandidate` sempre resolvem `policy ?? ACTIVE_SUBSTITUTION_POLICY` (uma constante global lida no momento da requisição). Se a flag for alternada no futuro, **toda execução em andamento — incluindo as iniciadas sob o legado — seria avaliada sob regras V3 na sua próxima solicitação de substituição**, sem qualquer "grandfathering". Isso contradiz a afirmação do relatório de integridade da Etapa 3 de que nada é avaliado retroativamente — essa afirmação só vale para substituições já aplicadas, não para novas solicitações sobre sessões existentes. |
| Cliente antigo + backend futuro com V3 | MÉDIO-ALTO | Nenhuma negociação de capacidade de cliente existe; um backend com V3 ativa aplicaria regras que o app do cliente nunca mostrou ao usuário. |
| Preferência permanente antiga reavaliada sob V3 | MÉDIO | Falha de forma segura (mantém o exercício prescrito, nunca escolhe uma terceira opção), mas sem explicação ao usuário sobre por que sua preferência parou de funcionar. |
| Repetição da mesma solicitação (idempotência) | BAIXO | Nenhuma duplicação encontrada na transação do callable. |
| Manipulação direta de ID no backend | **Nenhum bypass encontrado** em 5 tentativas adversariais (candidato não autorizado, ID de rascunho, spoofing de ambiente, auto-substituição, ID inexistente) — a fronteira de ambiente se sustenta porque vem do documento de programa carregado no servidor, nunca do ID do candidato enviado pelo cliente. **Ressalva**: os testes exercitaram a função pura de decisão (`isRequestedSubstitutionEligible`), não a transação completa do Firestore (autenticação, guarda de série concluída, carregamento de contexto) — essa camada não foi testada nesta auditoria. |
| Divergência local × catálogo remoto | Não testada diretamente nesta etapa (exigiria acesso ao Firestore real, fora do escopo). Risco conhecido e já documentado na auditoria original (6 perfis remotos com campos residuais inválidos). |

---

## H. Ativação e rollback

- `ACTIVE_SUBSTITUTION_POLICY = 'legacy'` confirmado estático, sem qualquer caminho de sobrescrita remota (grep exaustivo, 0 ocorrências).
- Nenhum documento `v3SubstitutionDatasetState`/equivalente existe ainda — consistente com "nada publicado".
- Os 4 bloqueadores em `V3_ACTIVATION_BLOCKERS` permanecem genuinamente abertos (verificado por inspeção de código, não por confiança na lista).
- **Lacuna na própria lista de bloqueadores**: `V3_ACTIVATION_BLOCKERS` cobre apenas bloqueadores arquiteturais — não inclui bloqueadores de conteúdo (as 50 relações D, as 51 B, os 41 rascunhos sem vídeo/perfil). Alguém lendo só essa constante pode presumir, incorretamente, que ela é a lista completa de pendências.
- **A lacuna de fixação de política por sessão (seção G) é o requisito técnico mais urgente antes de qualquer ativação futura** — sem ele, nenhuma migração seria segura, independente de qualquer outro item da lista.

---

## I. Plano de correções (identificação de problemas — nenhuma correção foi aplicada)

| # | Prioridade | Arquivo(s) | Causa | Consequência | Correção proposta | Testes necessários |
|---|---|---|---|---|---|---|
| 1 | **P0** | `functions/src/workoutLifecycle/exerciseSubstitution.ts`, snapshot de execução/programa | Política de substituição nunca é fixada no momento da criação da sessão | Uma ativação futura da V3 re-avaliaria sessões em andamento sob novas regras, quebrando a garantia de preservação | Persistir a política ativa (ou a identidade do dataset) no documento da execução/programa no momento da criação; ler esse valor fixo em toda substituição subsequente daquela sessão, nunca a constante global | Teste que cria uma sessão sob uma política, altera a constante global, e confirma que a sessão existente continua decidindo pela política original |
| 2 | **P1** | Perfis de limitação locais (`localLimitationCatalog.ts` / fonte de perfis) | 50 relações bloqueadas só por `LIMITATION_PROFILE_MISSING` em um dos lados | Reduz artificialmente a cobertura além do que a planilha realmente pretendia | Completar os perfis ausentes (decisão de dado/clínica, não de código) | Reexecutar a decomposição da seção D após qualquer adição de perfil e confirmar a queda em `D` |
| 3 | **P1** | Planilha V3 / processo editorial | 51 relações (categoria B) com a mesma forma estrutural das 120 já aceitas, mas sem comentário de exceção | Substituições plausivelmente válidas ficam indisponíveis sem necessidade | Revisão editorial pontual: para cada uma das 51, decidir se merece o mesmo comentário/exceção que as 120 já têm | Mesmo mecanismo de teste já existente (`editorialExceptionScopeV3`) aplicado às novas exceções, se adicionadas |
| 4 | **P2** | Planilha V3 (abas de limitação) | Cobertura esparsa de pares exercício×região (causa de 93,5% da queda multi-região) | Muitos cenários de limitação ficam sem alternativa, mesmo quando uma alternativa segura plausivelmente existe | Decisão editorial: expandir deliberadamente a cobertura das abas de limitação, região por região | Reexecutar a comparação de cobertura (seção D) após qualquer expansão |
| 5 | **P2** | 80 relações (categoria C) | Divergência de padrão/mecânica sob limitação ativa, não decidível por código | Permanecem bloqueadas até revisão profissional | Revisão clínica especializada, caso a caso | Nenhum teste de código resolve isto — é decisão humana |
| 6 | **P2** | `substitutionPolicyV3.ts` (`editorialCandidatesV3`) | Interseção multi-região exige ordem relativa idêntica entre regiões, não só membership | Amplifica a queda multi-região além da esparsidade de dados pura | Confirmação explícita do produto se esse comportamento fail-closed é o desejado, ou se deveria haver um critério de desempate | Teste que meça especificamente o efeito de relaxar a exigência de ordem (sem implementar, só medir) |
| 7 | **P2** | `V3_ACTIVATION_BLOCKERS` | Lista cobre só bloqueadores arquiteturais | Risco de subestimar o que falta para ativação | Documentar explicitamente, ao lado da constante, que bloqueadores de conteúdo (vídeos, perfis, B/C/D) são rastreados separadamente | N/A (documentação) |
| 8 | **P3** | `unrestrictedEquipmentContext` (v1.27, herdado) | Composição de produção nunca usa inventário real do usuário | Pré-existente, não uma regressão da V3 — fora do escopo desta etapa, mas relevante para o cenário 8 | Fora de escopo; decisão de produto já tomada no v1.27 | N/A |
| 9 | **P3** | Transação completa do callable `applyExerciseSubstitution` | Camada de transação/autenticação/guarda-de-série-concluída não foi exercitada nesta auditoria (só a função pura de decisão) | Risco residual não quantificado nesta etapa | Testes de integração contra emulador Firestore local, dedicados a essa camada | Suíte de integração com emulador, fora do escopo desta auditoria |

**Pendências de vídeo/perfil dos 41 rascunhos** (separadas, não técnicas): sem alteração desde a Etapa 2/2.1 — 3 de 41 com vídeo produzido (nenhum aprovado), 38 sem nenhuma fonte. Nenhuma região clínica revisada para nenhum dos 41. Não listadas na tabela acima por serem puramente de conteúdo/produção, não de código.

---

## J. Testes executados nesta etapa

- `npm run typecheck` (app e functions): limpo nos dois.
- `npx eslint`: 0 erros em todos os arquivos tocados pela V3; avisos pré-existentes e não relacionados (estilo de array, imports duplicados em `composition.ts` já presentes desde a Etapa 3) não são regressão desta etapa.
- Suíte completa do app: **44 falhas — exatamente os mesmos 16 arquivos já documentados** (`iosRestActivityStructure`, `premiumEntitlementPrecedence`, `workoutLogicIntact`, `loadProgressWiring`, `scheduleRefreshState`, `editProfileFixedLayout`, `healthIntegrationScreenStructure`, `migratedScreensLifecycle`, `paywallRedesignStructure`, `premiumCommercialContextFase6`, `restOverlayNextExerciseStructure`, `restLiveActivityIntegrationStructure`, `sharedComponentsTheme`, `canonicalV127SubstitutionMapUnification`, `musculoskeletalFullCoverageV127`, `spineHomeClosureV127`); 7.900 passaram, 228 ignorados. Nenhuma falha nova atribuída à V3.
- Suíte completa do backend (`functions/`): **0 falhas**, 2.022 passaram, 391 ignorados.
- Testes de paridade preview/backend/evolução/limitação: 0 divergências encontradas sobre as relações reais do dataset, verificado além do teste existente (que já cobria preview↔backend; evolução e caminho de limitação automática foram cruzados nesta etapa pela primeira vez).

---

## Veredito final

### **APROVADA COM PENDÊNCIAS**

A estrutura é válida: a importação é fiel e reproduzível, a separação academia/casa e comum/musculoesquelética é rigorosa, as 120 exceções editoriais são corretamente escopadas e nunca comprometem segurança (verificado exaustivamente, não por amostra), nenhum bug de motor foi encontrado na lógica de composição, nenhuma tentativa de manipulação de ID conseguiu contornar a autorização editorial, e a flag permanece genuinamente inerte.

Mas existem pendências reais que impedem a classificação "pronta para homologação" sem qualificação:

1. **Uma lacuna crítica de preservação (P0)** — ausência de fixação de política por sessão — precisa ser resolvida antes que QUALQUER ativação futura, mesmo controlada, possa ser considerada seguramente reversível para usuários com sessões em andamento.
2. **101 das 203 relações bloqueadas (categorias B+D, 50%) são candidatas plausíveis a correção de dado/processo editorial**, não bloqueios definitivamente corretos — a cobertura real da V3, se essas forem endereçadas, é maior do que os números atuais sugerem.
3. **80 relações (categoria C) e a cobertura esparsa de combinações multi-região exigem decisão editorial/clínica humana**, não mais engenharia.

Nenhum problema de segurança, integridade de dados do usuário, ou violação de isolamento foi encontrado. A V3 pode seguir para testes controlados em aparelho (homologação) **assumindo que o item P0 seja tratado antes de qualquer teste que envolva alternar a flag em um ambiente com sessões reais** — em testes puramente locais/emulados de curto prazo sem sessões pré-existentes, o risco do item P0 não se manifesta. Não deve avançar para publicação enquanto os itens P0–P1 do plano de correções (seção I) não forem resolvidos.
