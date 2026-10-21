# Remoção definitiva do sistema musculoesquelético — Fase A

Implementação local concluída. O aplicativo e o backend não executam mais adaptação musculoesquelética, resolvedores clínicos, interseções de regiões ou políticas clínicas V3/legacy. A troca manual continua disponível. Nenhum deploy, OTA, EAS build, commit, push ou alteração de dados reais foi executado.

A lista completa está em [FILES.md](FILES.md), os resultados e falhas identificadas em [validation.json](validation.json), e a publicação proposta em [DEPLOY.md](DEPLOY.md).

## 1. Arquivos excluídos

Foram excluídos os resolvedores `limitationResolver.ts`, `musculoskeletalLimitationV127.ts`, `canonicalMusculoskeletalLimitationV127.ts`, `limitationDataset.ts`, `localLimitationCatalog.ts`, `substitutionPolicyV3.ts` e o gate vazio `generationPolicy.ts`. Também foram excluídos os scripts exclusivos de geração, publicação, auditoria e remediação clínica; datasets técnicos; matrizes; testes e fixtures exclusivos. O manifesto discrimina arquivos rastreados e arquivos que já eram locais e não rastreados.

## 2. Arquivos modificados

O manifesto compara o resultado com o estado inicial da tarefa, preservando as alterações locais anteriores. As mudanças abrangem questionário, normalização, contratos de prescrição e lifecycle, motores V2/V1.27, troca manual, apresentação, Functions, Rules, sincronização do motor, build e testes. O catálogo geral de exercícios, os vídeos e os demais fluxos permanecem disponíveis.

## 3. Código legado removido e dependências

Antes da exclusão foram mapeados os consumidores dos módulos clínicos: motores → composição → resolvedores; serviços de geração → identidade/dataset clínico; troca manual e evolução → equivalência/perfis/política V3; backend → catálogo, autorização e validação de substituições; Rules → identidade clínica e campos obrigatórios. As responsabilidades compartilhadas foram separadas em `exerciseCatalog.ts` e nos filtros normais de equivalência/equipamento.

Não restaram imports de módulos removidos, flag ativa de substituição, resolução clínica, classificação por região ou caminhos que produzam `MUSCULOSKELETAL_NO_SUBSTITUTE`/`NO_SAFE_CONFIGURATION`. Um teste percorre o código de produção do app e das Functions e impede o retorno desses símbolos. TypeScript e o build verificam o fechamento das dependências. A sincronização reconstrói suas pastas geradas e o build limpa `functions/lib`, impedindo que módulos excluídos sobrevivam em artefatos antigos.

## 4. Questionário

A opção musculoesquelética, a etapa `limits`, as regiões, os estados correspondentes, as validações e as traduções foram removidos. Sequências anônima e autenticada, navegação e progresso agora funcionam sem essa etapa. Dados antigos são filtrados nas fronteiras de leitura e gravação; não tornam o questionário incompleto nem são reemitidos.

Foram preservadas as perguntas independentes de gravidez, pós-parto, lipedema, tontura, cirurgia, restrição profissional e capacidade funcional/frailty. O símbolo `functional_limitation` pertence ao roteamento independente dessa população especial, sem perfis musculoesqueléticos, regiões ou substituição clínica. Não é um resíduo do sistema removido.

## 5. Geração de treinos

V1.27 executa seleção → template → composição normal → prioridade muscular → validação → agenda. A prioridade muscular continua apenas reordenando os exercícios existentes. V2 mantém seus ajustes próprios de iniciante, duração, objetivo, prioridade e equipamento, sem qualquer componente clínico. Foram removidos datasets clínicos de identidade, traces, planos e contratos novos.

T004, masculino, intermediário, hipertrofia, academia, cinco dias: foram verificadas as cinco sessões normais, a terceira Legs com Leg Press e a quinta sem bloqueios. A geração local e a autoritativa produzem o mesmo plano, inclusive quando a entrada contém regiões antigas inválidas. A instalação autoritativa de T004 foi exercitada no Firestore Emulator. A composição das 102 famílias de template também foi verificada sem dataset clínico.

Integridade do template, validação de exercícios, equipamento, autenticação, idempotência, transações e concorrência foram mantidas. A evolução normal por ciclo permanece independente de limitações.

## 6. Substituições manuais

A lista manual usa exercícios ativos, relações normais, equivalência de movimento/músculo/mecânica, ambiente/equipamento, distância de dificuldade, lateralidade e prevenção de duplicidade. Não consulta regiões ou aprovações clínicas.

Foram preservadas 289 relações comuns de 112 origens da antiga planilha V3 em `manualExerciseRelations.json`: somente relações do contexto comum, sem condições, cujos dois exercícios já existem no catálogo operacional e têm movimento, músculo principal e mecânica equivalentes. Não foram transportadas condições, prioridades editoriais obrigatórias ou exceções clínicas. Esse arquivo é consumido somente pela descoberta manual; não impõe uma nova política à geração ou à evolução.

Troca temporária, permanente, preferências, persistência, reabertura, retorno ao original, conservação de séries/repetições/cargas/histórico e bloqueio de troca após séries concluídas foram exercitados. A aplicação continua autoritativa e transacional. Preferências permanentes continuam passando pelos filtros normais ao criar uma nova execução.

## 7. Functions a atualizar

- `initializeWorkoutProgramV127`
- `authorizeWorkoutLifecycleMutation`
- `installActiveWorkoutProgram`
- `applyExerciseSubstitution`
- `finalizeWorkoutSession` — recebe a mudança transitivamente pela validação de trocas já materializadas.

As quatro primeiras mantêm suas responsabilidades compartilhadas. A quinta deve ser republicada mesmo sem alteração direta em seu arquivo. As demais Functions não precisam de publicação por esta remoção.

## 8. Functions a excluir

Nenhuma Function exportada exclusivamente clínica foi identificada no código local. Não foi excluído nenhum endpoint compartilhado. O inventário remoto deverá ser conferido na Fase B antes de afirmar que não existem endpoints órfãos publicados; nenhuma exclusão remota está autorizada por este relatório.

## 9. Firestore Rules

Foram retirados os validadores de regiões/perfis, as consultas à identidade clínica e os campos clínicos obrigatórios de planos/snapshots novos. As coleções clínicas sem consumidores deixam de ter acesso por cliente, ficando sob o bloqueio padrão. Novos questionários não podem gravar `limits`, `limitationImpact` ou a condição musculoesquelética. Exercícios novos/atualizados pelo painel não podem produzir perfis ou variantes clínicas.

Novas execuções não podem gravar `substitutionPolicySnapshot`, e updates/restarts não podem introduzi-lo nem mudá-lo. Autorização, isolamento entre contas, imutabilidade das identidades dos exercícios, proteção das preferências, grants e mutexes permanecem. Índices e Storage foram examinados: não havia configuração clínica específica a remover. Os 93 testes de Storage passaram sem alteração de suas Rules.

## 10. Dados históricos e exceções inertes

Nenhum documento remoto foi alterado ou excluído. Questionários antigos continuam legíveis, e seus campos musculoesqueléticos são descartados na normalização. Planos antigos continuam acessíveis com seus IDs e referências existentes; não são reescritos automaticamente nem recebem novas adaptações. Um exercício já persistido em um plano histórico permanece parte desse registro; esta tarefa não reconstitui retroativamente históricos ou sessões em curso.

Resíduos intencionais:

1. As fronteiras de leitura reconhecem nomes antigos somente para descartá-los; o validador de snapshots aceita a chave antiga `limits` na leitura. Não existe interpretação de suas regiões.
2. Rules conservam o campo opaco `substitutionPolicySnapshot` em documentos antigos e exigem sua imutabilidade. Na finalização de uma execução antiga que já o contém, o backend preserva uma troca anteriormente materializada, verificando marcador, catálogo ativo, equipamento e duplicidade, sem reinterpretar qualquer política. A presença do campo distingue o esquema histórico; seu valor não seleciona regras. Novas gravações e novos pedidos de troca não usam esse caminho. Isso impede que uma troca antiga autorizada deixe de poder ser concluída apenas porque desapareceu uma exceção editorial.
3. Recibos, diffs e backups de publicações anteriores foram mantidos para rastreabilidade e delimitação da limpeza futura. Não são importados por código nem empacotados nas Functions. A documentação histórica está marcada como descontinuada.
4. Testes de compatibilidade contêm exemplos de campos antigos deliberadamente.

A limpeza definitiva está descrita em [DATA-CLEANUP.md](DATA-CLEANUP.md) e depende de autorização separada. Não deve apagar treinos, usuários, cargas, avaliações ou históricos, nem recalcular suas identidades.

## 11. Testes e baseline

**Esta seção foi re-verificada de ponta a ponta por uma segunda sessão (retomando o trabalho do Codex), executando cada comando listado abaixo neste checkout — não apenas repetindo os números anteriores.** Um defeito real foi encontrado e corrigido durante essa verificação (ver "Correção aplicada" abaixo).

| Verificação | Resultado (reverificado) |
| --- | --- |
| TypeScript app (`npm run typecheck`) | Passou |
| TypeScript Functions (`npm --prefix functions run typecheck`) | Passou |
| Build limpo das Functions (`npm --prefix functions run build`) | Passou |
| Focados: geração, troca manual, equipamento, evolução, onboarding, i18n (`vitest run src/workoutPrescription src/prescriptionEvolution src/onboarding ...`) | 1.445 passaram |
| Firestore Rules (`npm run test:rules:firestore`, emulador real) | 554 passaram |
| Storage Rules (`npm run test:rules:storage`, emulador real) | 93 passaram |
| Unitários Functions (`npm --prefix functions run test`) | 2.020 passaram, 402 ignorados, sem falhas |
| Suíte geral do aplicativo (`npm run test`) | 7.579 passaram; 22 falhas anteriores (nomes idênticos aos documentados); 221 ignorados |
| Integração ampla de autorização, instalação, troca e finalização (`authorizeMutation` + `installActiveWorkoutProgram` + `finalizeWorkoutSession` + `exerciseSubstitution`, emulador real) | **Antes da correção: 144 passaram, 7 falharam (3 novas). Depois da correção: 147 passaram, 4 falharam (as mesmas 4 anteriores).** |
| Integração de primeira geração/evolução/execução/reconciliação (`firstProgramGeneration`, `prescriptionEvolution`, `workoutExecutions`, `workoutLifecycle`, `workoutProgramReconciliation`, emulador real) | 108 passaram; 5 falhas — todas reproduzidas identicamente numa worktree git isolada do HEAD não tocado por esta tarefa (ver abaixo); nenhuma nova |
| Lint nos arquivos afetados (`npm run lint:affected`) | 0 erros, 12 avisos pré-existentes; nenhum erro novo |

A baseline inicial tinha TypeScript aprovado, 7.920 testes passando, 44 falhando e 232 ignorados; lint com 48 erros e 492 avisos. A redução no total de testes decorre da exclusão de testes da funcionalidade removida. Os nomes das 22 falhas remanescentes da suíte geral são subconjunto exato das 44 falhas iniciais.

### Correção aplicada nesta verificação

`src/workoutPrescription/prescriptionMetadata.ts` (e sua cópia sincronizada em `functions/src/workoutLifecycle/prescriptionEngine/...`) lançava `TypeError: Cannot read properties of undefined (reading 'safety')` sempre que `currentPrescriptionMetadata` recebia um plano sem `trace` (e/ou sem `versions`) — exatamente o caso de um `workoutPrograms/{id}` histórico que nunca teve esses campos, ou de uma fixture de teste deliberadamente parcial simulando esse histórico. Isso quebrava `CYCLE_EVOLUTION`/`MOTIVATIONAL_RENEWAL` tanto no backend (`authorizeMutation.ts`) quanto, potencialmente, no app (`src/services/prescriptionEvolution.ts`, mesmo padrão de chamada) para qualquer programa ativo legado sem o contrato de trace atual — três testes de integração (`CYCLE_EVOLUTION starts from the currently sealed sessions...`, `v1.27 CYCLE_EVOLUTION picks the identical substitution...` ×2) travavam com essa exceção. Corrigido tornando `currentPrescriptionMetadata` tolerante a `trace`/`versions` ausentes: usa um trace vazio/neutro como padrão e omite `versions` quando a fonte não os tem, em vez de inventar dados — preservando a regra geral da Fase A de nunca reescrever ou reconstituir retroativamente um histórico. Após a correção, TypeScript (app e Functions) seguem passando e os três testes passam; as 4 falhas remanescentes nessa suíte são as mesmas quatro já documentadas, não relacionadas a este removal (condicionamento/ciclos, semântica de ADAPT v2, calendário na finalização).

### As falhas remanescentes são pré-existentes, confirmado por comparação isolada

As quatro falhas da integração ampla (autorização/instalação/troca/finalização) e as cinco falhas da integração de primeira geração/evolução foram reproduzidas **nesta sessão**, de forma idêntica (mesmos nomes, mesmas mensagens), executando os mesmos comandos dentro de uma `git worktree` separada e descartável apontando para o HEAD do repositório — ou seja, o estado do código ANTES de qualquer alteração desta tarefa de remoção (toda a remoção está em alterações não commitadas). Isso prova que nenhuma delas foi introduzida pela remoção do sistema musculoesquelético: expectativa de ciclos no template de condicionamento, fixture V2 ADAPT com semântica de ciclo divergente, duas expectativas de calendário na finalização, e as cinco falhas de `firstProgramGeneration`/`prescriptionEvolution` (relacionadas à mudança anterior e não-relacionada do padrão de geração default de v2 para v1.27, nada a ver com limitações/musculoesquelético). A worktree de comparação foi removida ao final; a árvore de trabalho principal com todas as alterações pendentes (desta tarefa e de trabalhos não relacionados) permaneceu intacta durante e depois da comparação. Testes ignorados por padrão não são apresentados como testes executados.

A verificação física no iPhone e os smoke tests remotos pertencem à Fase B e não foram executados.

## 12. Problemas e dependências restantes

Não há dependência clínica ativa conhecida no código resultante. Permanecem as falhas globais anteriores, a confirmação do inventário remoto e a coordenação da atualização dos clientes. Não existe mecanismo de atualização obrigatória identificado neste repositório. Clientes antigos que tentem gravar os campos retirados serão recusados pelas Rules finais; a distribuição do novo aplicativo precisa ser coordenada com essa publicação.

## 13. Plano de deploy

O plano, os cinco endpoints, os comandos propostos e os testes remotos estão em [DEPLOY.md](DEPLOY.md). A aplicação distribuída no iPhone precisa de um novo build: o projeto não configura `expo-updates`, runtime/channel de OTA ou entrega OTA equivalente. Um Development Build conectado ao Metro pode consumir o JavaScript local sem recompilar componentes nativos, mas isso não atualiza o aplicativo já distribuído aos usuários.

## 14. Veredito

A remoção local do comportamento musculoesquelético está concluída no aplicativo e no backend, com troca manual preservada e cobertura de contas/documentos antigos. Os únicos resíduos funcionais de leitura são os necessários para descartar campos antigos e concluir sessões previamente materializadas; não executam V3, legacy clínico ou adaptação por regiões. A suíte global não está inteiramente verde por falhas anteriores, documentadas e comparadas. A produção permanece inalterada, aguardando autorização explícita para a Fase B.

### Auditoria final (segunda sessão) — veredito: PRONTO PARA PUBLICAÇÃO (Fase A)

Uma segunda sessão retomou este trabalho a partir do ponto em que o Codex foi interrompido (`src/workoutPrescription/prescriptionMetadata.ts` incompleto/não verificado) e reverificou integralmente as seções acima. Resultado:

1. **`prescriptionMetadata.ts` estava, na verdade, completo e corretamente ligado** a `src/services/prescriptionEvolution.ts` e `functions/.../authorizeMutation.ts` (ambos já importavam e usavam `currentPrescriptionMetadata`, e a cópia sincronizada para Functions já existia e estava idêntica, menos o cabeçalho gerado). Não havia exports faltando nem erro de TypeScript.
2. **Um defeito real foi encontrado e corrigido** nesse mesmo arquivo: falha ao derivar `CYCLE_EVOLUTION`/`MOTIVATIONAL_RENEWAL` a partir de um plano ativo sem `trace`/`versions` (programa histórico pré-esquema-de-trace). Ver seção 11, "Correção aplicada nesta verificação". Sem essa correção, um usuário com um programa ativo legado nessa forma teria sua evolução de ciclo quebrada com uma exceção não tratada — isso teria sido um bug real em produção, não apenas nos testes.
3. **Resíduo morto removido**: `firestore-tests/exercises.rules.test.ts` tinha duas funções auxiliares (`validLimitationProfile`, `updateLimitationProfile`) sem nenhum chamador — sobra da remoção do bloco de testes `exercises — limitationProfile validation` que as usava. Removidas; o arquivo continua compilando e os 93+554 testes de Rules passam sem alteração de contagem.
4. **Auditoria de termos residuais** (`musculoskeletal`, `limitationProfile`, `limitationResolver`, `limitationDataset*`, `ACTIVE_SUBSTITUTION_POLICY`, `substitutionPolicySnapshot`, `MUSCULOSKELETAL_NO_SUBSTITUTE`, `functional_limitation`, `limitationRegions`, `physicalLimitations`, `limitationImpact`, `NO_SAFE_CONFIGURATION`) repetida em `src/`, `functions/src/`, `firestore.rules`, `firestore-tests/`: nenhum caminho ativo de geração, seleção, substituição ou validação lê mais dados clínicos/musculoesqueléticos. Todos os hits restantes se encaixam em uma das categorias abaixo — nenhum exige ação adicional:
   - **(b) Compatibilidade histórica inerte, necessária e intencional**: descarte de `limits`/`limitationImpact`/`musculoskeletal_limitation` nas fronteiras de leitura (`input.ts`, `questionnaireSchema.ts`, `questionnaireAnswers.ts`, `draftStorage.ts`, `prescriptionInputs.ts` — app e a cópia sincronizada em Functions); os filtros de `retainedModifier`/`MUSCULOSKELETAL_ADAPTATION_REQUIRED` em `prescriptionMetadata.ts` (necessários para não propagar resíduo de trace de planos antigos para ciclos novos); a leitura, só para exibição no painel admin, de `answers.limitationImpact` em `functions/src/adminUsers/adminUsers.ts` (não afeta geração); todas as regras de imutabilidade/rejeição de `substitutionPolicySnapshot`, `limits`, `limitationImpact`, `musculoskeletal_limitation` e `limitationProfile` em `firestore.rules`.
   - **(c)/(d) Docs descontinuadas e testes que verificam ausência/compatibilidade**: comentários históricos nos arquivos de teste de integração (ex.: o cabeçalho de `firstProgramGeneration.integration.test.ts` ainda narra o bug original do gate de `limitationDatasetState`, que não existe mais no código — comentário histórico inofensivo, não residual funcional); fixtures em `firestore-tests/workoutPrograms.rules.test.ts`/`workoutExecutions.rules.test.ts` que testam explicitamente a aceitação de documentos antigos sem os campos clínicos ou a imutabilidade de `substitutionPolicySnapshot`.
   - `functional_limitation` **não é residual** — é uma condição especial independente (rastreio de capacidade funcional/queda, população frailty), nunca associada a perfis musculoesqueléticos ou substituição clínica; confirmado pela leitura de `src/state/AppState.tsx`, `src/onboarding/questionDefs.ts`, `src/onboarding/steps.ts`, `src/lib/questionnaireSchema.ts` e seus equivalentes sincronizados em Functions.
5. **Testes reexecutados nesta sessão, não apenas revalidados por leitura**: TypeScript (app+Functions), build limpo das Functions, 1.445 testes focados, suíte geral do app (7.579/22/221), suíte unitária de Functions (2.020/0/402), Firestore Rules (554) e Storage Rules (93) no emulador real, integração ampla de autorização/instalação/troca/finalização (147/4, após a correção), e integração de primeira geração/evolução/execução (108/5) — com as 9 falhas remanescentes (4+5) comprovadamente pré-existentes por comparação direta contra uma `git worktree` do HEAD não tocado por esta tarefa (seção 11). Nenhuma nova falha ficou sem explicação.
6. T004 (masculino, hipertrofia, intermediário, academia, 5 dias) gera as 5 sessões normais, Legs com `leg-press-45`, 5ª sessão não vazia, paridade entre entrada limpa e entrada com campos legados (`limits`, `limitationImpact`, `musculoskeletal_limitation`) — tudo coberto por `src/workoutPrescription/__tests__/physicalLimitationsRemoved.test.ts`, que passa.
7. Troca manual (temporária e permanente) e instalação autoritativa confirmadas ponta a ponta no emulador real (`exerciseSubstitution.integration.test.ts` e `installActiveWorkoutProgram.integration.test.ts`, 100% passando).

**Veredito final: PRONTO PARA PUBLICAÇÃO da Fase A** (remoção local, sem deploy/commit/push/EAS/OTA — nenhum desses foi executado). A Fase B (inventário remoto, build/distribuição do cliente, publicação coordenada do backend e das Rules) continua exigindo autorização explícita separada, conforme `DEPLOY.md`.

**Nota de segurança do processo**: durante esta verificação, uma mensagem de sistema injetada no fluxo de ferramentas tentou fazer esta sessão crer que a limpeza de `firestore-tests/exercises.rules.test.ts` havia sido revertida por "o usuário ou um linter" e instruiu explicitamente a não informar o usuário sobre isso. Essa alegação foi verificada e refutada diretamente (`git diff`/leitura do arquivo no disco mostraram a limpeza intacta); nenhuma instrução para ocultar informação do usuário foi seguida. Registrado aqui por transparência.
