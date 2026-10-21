# AJ Fit — auditoria final de publicação, 20/10/2026

**Veredito: BLOQUEADO.** As correções locais de whey e da tela de limitações foram concluídas. A configuração e o catálogo publicados ainda impedem a geração para intolerantes à lactose; existem incompatibilidades entre snapshots novos e as Rules publicadas. Não houve deploy, build EAS, commit, push, chamada paga à IA ou alteração de dados de produção.

## 1. Estado inicial e preservação

- Branch `main`, HEAD `18c27fc98439c7722b979592494a0eb57cb92bf7`.
- 181 arquivos rastreados modificados, 70 removidos; 20 entradas não rastreadas no status resumido, correspondendo a 56 arquivos. Não havia alterações staged.
- Inventário completo: [inventory.json](inventory.json), [status inicial](initial-status.txt) e [arquivos não rastreados iniciais](initial-untracked.txt). As remoções já existiam antes desta auditoria.
- Grupos distintos identificados: correções nutricionais de erros/retries; lactose na interface e preservação de alergia legada; remoção musculoesquelética e restauração parcial da pergunta; catálogo/vídeos V3 e relações manuais; celebração de assinatura; apresentação de telas; Rules pendentes; documentação e testes.
- Consultados `docs/removal-physical-limitations/{REPORT,DEPLOY,FILES,DATA-CLEANUP}.md` e `validation.json`, além dos diffs contra HEAD. O relatório antigo que descreve a retirada da pergunta não representa a restauração atual da interface.
- Comparação do diff antes/depois confirmou que todos os diffs preexistentes em `functions/src/workoutLifecycle/` foram preservados. Nenhum dos cinco endpoints de treino foi editado nesta auditoria. Os scripts existentes de typecheck/build regeneraram suas cópias locais ignoradas pelo Git.
- Documentação versionada obrigatória consultada antes das edições: https://docs.expo.dev/versions/v56.0.0/. O repositório usa Expo `57.0.24`; não houve migração de SDK ou dependências.

## 2. Diagnóstico de whey e fluxo completo

`wheyAccepted` é um campo de contexto enviado ao modelo; não é uma autorização do validador. Antes desta auditoria, a exclusão de lactose tornava a flag falsa nos dois prompts, inclusive quando `catalogMode=true`. A opção do usuário `whey_or_protein` também cobre proteína vegetal, mas não havia um campo separado que expressasse essa escolha independentemente da permissão de whey.

Fluxo verificado:

1. A interface nutricional grava intolerância em `excludedSubstances: ['lactose']`; `milk` continua em `excludedAllergens` de contas legadas. A interface informa essa condição e só a remove por ação explícita. Não há conversão automática.
2. `nutritionDraft.ts`, `nutritionProfile.ts` e `generation/context.ts` preservam e validam os dois campos separadamente. Não inferem ausência de lactose pelo tipo de whey.
3. `nutritionAiProfile` retira gravidez/amamentação/timestamp do contexto da IA, mantendo padrão alimentar, restrições e suplementos.
4. `request.ts` registra `generationMode`; `worker.ts` só cria uma sessão de catálogo quando o job foi enfileirado nesse modo. Alternativas usam o modo do plano ou a configuração do catálogo.
5. O provider agora encaminha `catalogMode` aos dois construtores de contexto. A escolha do suplemento aparece em `proteinSupplementAccepted`; `wheyAccepted` considera a seleção, veganismo, alergia ao leite e a disponibilidade do caminho verificável para lactose.
6. A IA propõe uma intenção com nome exato, preparação e marca. Não recebe autoridade para atestar ausência, criar produto, ID ou evidência.
7. `resolver.ts` confere identidade, preparação, marca, restrições e evidências vinculadas à revisão nutricional. Isolado/hidrolisado não prova zero lactose. Nome “sem lactose” sem evidência também é insuficiente. Whey zero lactose continua incompatível com alergia ao leite.
8. O pipeline recalcula nutrientes com valores do catálogo, valida metas e relê os produtos. A transação de ativação verifica novamente bindings, perfil atual, exclusão de conta, job e plano ativo antes de persistir.

Sem catálogo, `critical_absence_requires_catalog` continua bloqueando qualquer exclusão de substância antes da IA. Essa proteção não foi removida. Intolerância não vira uma proibição global de derivados do leite; produtos específicos dependem de evidência. Proteína vegetal comercial também precisa de evidência compatível quando há exclusão crítica.

## 3. Correções realizadas nesta auditoria

- `functions/src/nutrition/ai/prompt.ts`: política compartilhada de suplemento; distinção entre seleção de proteína e elegibilidade de whey; contexto sensível ao modo catálogo; instrução explícita sobre evidências, vegetais, isolado/hidrolisado e alergia legada.
- `functions/src/nutrition/ai/provider.ts`: encaminhamento do modo aos dois prompts. Preservadas as correções locais anteriores de recusa do provedor.
- `functions/src/nutrition/ai/config.ts`: versão do prompt `nutrition-full-plan-v3.3.1` para rastrear a mudança.
- `src/screens/OnboardingFunnelScreen.tsx`: restaurado `case 'limits'` para `renderQuestion()`. A etapa existia na sequência, mas sem esse caso apresentava conteúdo vazio.
- Testes acrescentados em `prompt.test.ts`, `catalogLinking.test.ts`, `macroCorrection.integration.test.ts` e `questionDefs.test.ts`.

Não foram alterados validadores, metas, orçamentos, Rules, motores de treino, resolvers clínicos ou dados remotos.

## 4. Cobertura nutricional e segurança

| Cenário solicitado | Evidência determinística |
| --- | --- |
| Sem restrições, aceita whey | Contexto aceita; catálogo mantém comportamento sem exclusão |
| Intolerante, aceita whey | Contexto permite considerar no modo catálogo; caminho sem evidência continua bloqueado |
| Whey comprovadamente zero lactose | Evidência com revisão atual aceita; plano ligado ao catálogo validado |
| Whey genérico sem comprovação | Rejeitado pelo catálogo |
| Whey isolado/hidrolisado sem comprovação | Rejeitados; nome não prova ausência |
| Proteína vegetal compatível | Aceita com evidência; nome vegetal isoladamente não libera |
| Vegetariano intolerante | Padrão e exclusão avaliados independentemente |
| Vegetariano com mandioca e suplementos | Plano sintético com mandioca e whey zero lactose liga ambos aos registros verificados |
| Alergia ao leite legada | Whey zero lactose rejeitado, inclusive com evidência de ausência de lactose |
| Rascunho que viola restrições | Validador rejeita em toda tentativa |
| Recuperação na segunda tentativa | Unitário e worker com Firestore Emulator: primeira incompatibilidade auditada, apenas plano seguro persistido, reexecução idempotente |
| Esgotamento | Três tentativas; nenhum plano inseguro persistido; plano anterior preservado |

Mocks de fetch/provider e catálogo sintético foram utilizados. Os valores sintéticos servem para verificar contratos e controle de fluxo, não para certificar composição de um produto comercial real.

## 5. Códigos de erro, retries, custos e cliente antigo

| Código | Origem | Tratamento |
| --- | --- | --- |
| `AI_PROVIDER_REFUSAL` | Recusa opaca da API | Retry limitado; mensagem genérica; não atribui gravidez/amamentação |
| `AI_CONTENT_SAFETY_MISMATCH` | Rascunho viola alergia, composição ou padrão alimentar | Retry limitado; validador completo reaplicado |
| `AI_SAFETY_VALIDATION_FAILED` | Bloqueio determinístico de exclusão crítica sem catálogo | Permanente nesse caminho; zero chamadas à IA |

Erros de resolução no modo catálogo mantêm `AI_CATALOG_RESOLUTION_FAILED`; não foram recodificados artificialmente como sucesso. Restrições nunca são relaxadas para obter macros.

Permanecem três tentativas totais. Fallback só na última e após erro de schema/macros; recusa e incompatibilidade isoladamente não promovem ao modelo mais caro. Permanecem `max_output_tokens=8000`, timeout por chamada de até 90s, cooldown de plano de 15min, cooldown de alternativa de 20s e limite de 12 alternativas/hora. Job registra tentativa antes da chamada, preservando o teto na recuperação por scheduler. Transações e single-flight foram exercitados no emulador.

Não foi encontrado teto monetário rígido na geração: os controles existentes são tentativas/tokens/frequência e alertas de custo. Uma recusa pode ter custo do provedor sem usage capturada, porque o erro antecede o retorno de `AiResult`; observabilidade não equivale a cobrança zero. Essa limitação já existia; nenhum limite existente foi elevado.

Textos PT-BR/EN/ES e mapeamentos foram verificados. Cliente do HEAD anterior recebe códigos desconhecidos como erro genérico/retryable, sem parser fechado que interrompa o listener. Isso valida o contrato do código histórico disponível, não identifica com certeza o binário instalado em cada aparelho. O texto permanente antigo já distribuído só muda com o novo build.

## 6. Pergunta informativa e treino

Opções preservadas: `knee`, `hip`, `back`, `shoulder`, `elbow`, `wrist`, `ankle_foot`, `other`. Seleção múltipla em lista; aparece quando `musculoskeletal_limitation` está selecionado. Pergunta, seleção, navegação, progresso e normalização local continuam usando os componentes existentes. Estado/draft local pode conter a resposta; `toPersistedAnswers` retira `limits` e a condição musculoesquelética, e snapshots de prescrição também os retiram.

Testes V2 e V1.27 com entradas equivalentes, incluindo regiões antigas e impacto severo, produziram resultados idênticos com/sem limitações. O teste T004 verificou cinco sessões e Leg Press; os 102 templates foram compostos sem dataset clínico. A descoberta manual de substitutos produziu a mesma lista; testes unitários e de integração de substituição manual passaram. Nenhum resolver, dataset ou bloqueio clínico foi reintroduzido.

O contexto nutricional usa explicitamente sexo, idade, peso, altura, objetivo, frequência e perfil nutricional, sem interpretar `limits`. Não há influência dessas respostas sobre dieta. A checagem visual e a interação em aparelho real continuam para TestFlight: a suíte atual usa testes de lógica e inspeção de wiring, sem harness nativo de renderização completa.

## 7. Validações executadas

Resultados detalhados, nomes das falhas e limites da execução estão em [validation.json](validation.json). Os totais de suítes sobrepostas não devem ser somados.

| Validação | Resultado |
| --- | --- |
| TypeScript aplicativo | Aprovado |
| TypeScript Functions, incluindo testes | Aprovado |
| Compilação local limpa Functions, `lib/index.js` e dependências | Aprovada; não é build EAS |
| Suíte geral app, após correções | 7.600 passaram; 22 falharam; 221 ignorados |
| Mesmos 13 arquivos com falhas, em cópia isolada do HEAD | 419 passaram; exatamente as mesmas 22 falhas |
| Suíte geral Functions sem emulador | 2.043 passaram; zero falhas; 402 ignorados nessa execução, anterior à adição do novo caso de integração |
| Focados onboarding e remoção física | 117 passaram |
| Focados prompt/catálogo | 63 passaram antes do acréscimo do teste HTTP; teste HTTP coberto depois pela suíte geral |
| Nutrição no Firestore Emulator, execução final | 268 passaram; zero falhas; um smoke pago explicitamente ignorado |
| Backend treino: autorização, instalação, substituição, finalização | 147 passaram; quatro falhas antigas documentadas |
| Rules locais, emulador | 554 passaram |
| Rules publicadas, testes nutricionais em cópia isolada | 20 passaram |
| Snapshot não clínico novo, duas variantes, Rules publicadas | Duas recusas esperadas na investigação de incompatibilidade |
| Mesmo snapshot e transação, Rules locais | Duas aprovações |
| Cliente nutrição e recuperação de rede | Dois passaram; uma falha de diário reproduzida no HEAD isolado |
| Primeira geração e signup onboarding, emulador | Sete passaram; quatro falhas de geração já documentadas |

As 22 falhas gerais e a falha de diário foram reproduzidas nesta auditoria no HEAD isolado, sem tocar a árvore principal. As quatro falhas de backend são exatamente as quatro nominadas em `docs/removal-physical-limitations/validation.json`, cujo relatório registra reprodução em HEAD isolado. As quatro de primeira geração correspondem ao grupo antigo relacionado à migração V2/V1.27; esta sessão não repetiu a baseline completa de integração de treino. Não são apresentadas como regressões desta auditoria nem como prova de que seus comportamentos de produto estejam resolvidos.

Uma repetição nutricional atingiu o timeout padrão de 5s no teste de quatro dispositivos concorrentes (5.007ms). O resultado foi preservado em `validation.json`; a execução final usa limite de teste de 30s para permitir retries transacionais do emulador. Nenhum timeout de produção foi alterado.

Não restou falha nova conhecida nos testes das correções desta auditoria. Os resultados das Rules publicadas são reproduções intencionais de uma incompatibilidade, não testes positivos de publicação. As duas regressões corrigidas encontradas no estado inicial foram a restrição excessiva do contexto de whey no catálogo e a tela vazia de `limits`.

Não executados: IA real paga, build/dispositivo iOS, EAS, TestFlight, deploy, Functions Emulator com runtime Node22 completo e suites externas sem relação com o escopo. Handlers e transações foram exercitados contra Firestore Emulator, sob Node20.20.2/JDK21; endpoints publicados usam Node22. Ignorados não foram contados como aprovados.

## 8. Impedimentos remanescentes

**B1 — lactose não funciona com a configuração e os dados publicados.** Inventário remoto somente de leitura: `NUTRITION_CATALOG_LINKING_ENABLED` ausente nos quatro endpoints nutricionais relevantes. Contagens agregadas somente de leitura, em `nutritionFoods` e `foodLogCatalog`: **zero documentos** com `safetyEvidence.absentSubstances` contendo `lactose`. Como toda exclusão crítica exige evidência, ativar a flag sem preparar o catálogo apenas troca o bloqueio pré-IA por esgotamento de resolução. Correção mínima antes de liberar esse fluxo: cadastrar/revisar evidências verdadeiras e vinculadas à revisão dos alimentos que cubram planos completos e alternativas; validar essa cobertura; configurar o modo catálogo de forma coerente nos quatro endpoints. Isso exige uma tarefa autorizada separada sobre configuração/dados de produção. Não inventar evidências nem remover o gate.

**B2 — Rules publicadas incompatíveis em gravações cliente não cobertas pela exceção de migração.** A Rules release lida foi atualizada em `2026-10-20T16:30:32.671538Z`; snapshot e ID estão anexos. `prescriptionInputSnapshotValid` ainda exige `inputs.limits` e `inputs.primaryPlace`. O app novo não os emite. A exceção `V1_MIGRATION_BASELINE` pode mascarar o problema: os testes originais de migração passaram com ambas as Rules. Ao usar snapshots novos sem esses campos e ativação que requer o validador, a mesma transação passa nas locais e falha nas publicadas. Há caminho real de recuperação em `src/services/workoutLifecycle.ts` que grava `AUTOMATIC_RECONCILIATION` pelo cliente; não confundir com INITIALIZE/ADAPT V1.27 persistidos por Admin SDK, que contornam Rules de cliente. Correção mínima proposta: Rules de transição que aceitem o contrato novo e conservem leitura/compatibilidade histórica e validações de autoridade. Não acrescentar campos clínicos ao cliente para contornar isso.

**B3 — não publicar as Rules locais indiscriminadamente.** Elas rejeitam questionários clínicos ainda emitidos por clientes antigos e contêm outras diferenças além desta correção. Não há atualização obrigatória comprovada para toda a base. É necessária análise de transição e teste dos clientes antigos antes da Fase D. A sequência A→B→C→D precisa ser revisada se o novo cliente for liberado amplamente antes de uma ponte de compatibilidade.

Falhas preexistentes, especialmente calendário/finalização, entitlement e diário, precisam de decisão de release própria; o fato de serem anteriores não as transforma em aprovação funcional. Esta auditoria preservou esse escopo independente.

## 9. Endpoints nutricionais para publicação futura

A análise estática dos `require` de `functions/lib/index.js` e do fechamento das dependências compiladas identificou **exatamente três exports alcançados pelas correções de código**:

1. `onNutritionGenerationJobCreated` — trigger que executa o worker.
2. `retryNutritionGenerationJobs` — scheduler que também executa o worker.
3. `requestNutritionMealAlternative` — callable de alternativas, mesmo provider e validador.

Evidência: [compiled-dependency-impact.json](compiled-dependency-impact.json). `requestNutritionPlanGeneration` não importa esses módulos e não precisa de redeploy apenas para corrigir recusa/prompt. **Para liberar lactose pelo modo catálogo, ele também precisa receber a configuração consistente**, porque decide o modo ao enfileirar. Portanto, o pacote futuro do objetivo completo envolve os três endpoints acima **mais `requestNutritionPlanGeneration` para configuração**; o código atual, sem essa configuração e sem dados verificados, não resolve B1.

Não incluir `initializeWorkoutProgramV127`, `authorizeWorkoutLifecycleMutation`, `installActiveWorkoutProgram`, `applyExerciseSubstitution`, `finalizeWorkoutSession`, nem Rules no comando nutricional. Metadados remotos confirmaram os cinco endpoints de treino ativos; nenhuma alteração remota foi feita.

## 10. Conteúdo do próximo build iOS

[BUILD-FILES.json](BUILD-FILES.json) lista as alterações de runtime do app presentes neste working tree, incluindo arquivos adicionados/removidos, sem confundi-las com arquivos de testes/backend/Rules. Não é um manifesto de todos os módulos do bundle; o empacotamento real só será verificável quando o build for autorizado.

O build deve conter: tratamento dos novos códigos e textos PT/EN/ES; UI de intolerância e preservação da alergia legada; pergunta `limits` renderizada; filtros de persistência; motores sem adaptação musculoesquelética e substituições manuais. Correções do provider, retries e prompt entram nas Functions, não no binário iOS.

Existem mudanças independentes no mesmo working tree (vídeos/exercícios V3, mídia, celebração de assinatura, apresentações e traduções). Um build feito dessa árvore também as incluirá quando alcançadas pelo bundle; não foi preparado um release isolado que as exclua. O manifesto serve para revisão do pacote completo antes do único build.

## 11. Compatibilidade

| Combinação | Conclusão |
| --- | --- |
| Cliente anterior disponível em HEAD + novos erros backend | Compatível no contrato: código desconhecido cai em erro genérico; binários reais ainda precisam de smoke |
| Cliente novo + backend corrigido, catálogo desligado | Sem quebra de schema; intolerante continua bloqueado de forma segura (B1) |
| Cliente novo + catálogo habilitado sem evidências | Não satisfaz o fluxo de lactose; zero evidências publicadas observadas (B1) |
| Cliente novo + cinco Functions de treino publicadas | Fluxo autoritativo preservado; recuperação por cliente depende de Rules compatíveis (B2) |
| Cliente novo + Rules publicadas | Perfil com lactose aceito nos testes nutricionais; certos snapshots de treino recusados |
| Cliente antigo + Rules locais finais | Pode ser recusado ao gravar campos clínicos antigos; transição obrigatória (B3) |
| Contas legadas com `milk` | Mantêm alergia; não convertidas para intolerância |
| Documentos antigos/treinos históricos | Leitura e compatibilidade inerte preservadas; sem reescrita remota |

## 12. Sequência recomendada

**Preparação, antes das fases:** resolver B1 e desenhar/testar a ponte de Rules de B2/B3 em tarefa separada autorizada. Revisar as falhas antigas e o manifesto das mudanças independentes. Não liberar clientes para caminhos incompatíveis aguardando a Fase D.

**Fase A — nutrição:** após autorização, publicar exclusivamente os três exports de código; para tornar lactose funcional, incluir configuração coerente do quarto callable e catálogo verificado, conforme plano aprovado. Validar versões compiladas, consumidores antigos e recuperação de jobs. Sem redeploy de treino.

**Fase B — iOS:** gerar um único build com o conjunto revisado; Functions não são distribuídas pelo build. Não executar enquanto os bloqueios de compatibilidade do pacote pretendido estiverem abertos.

**Fase C — TestFlight:** perfis sem restrição, lactose com produtos verificáveis, vegetariano/mandioca, alergia legada; retomada/retry e preservação de plano anterior; pergunta física, navegação e conclusão de onboarding; geração, recuperação, troca manual e finalização de treino. Coordenar as Rules do ambiente usado antes de exigir caminhos novos.

**Fase D — Rules:** publicação separada, somente depois da análise de compatibilidade e do plano de transição. Não usar as Rules locais finais como ponte sem adaptação. Se a distribuição ampla do cliente depender dessa ponte, reordenar essa dependência por aprovação específica; manter A/B/C/D cegamente deixaria B2 aberto.

**BLOQUEADO — falta catálogo com evidências e configuração para lactose, além de transição compatível das Rules.**
