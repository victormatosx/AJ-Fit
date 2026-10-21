> Registro histórico: o sistema musculoesquelético e as políticas clínicas V3/legacy descritos aqui foram descontinuados. Não são contratos atuais. Ver [remoção definitiva](../removal-physical-limitations/REPORT.md).

# Etapa 3 — implementação local parcial, com ativação impedida

A V3 **não está concluída nem pronta para homologação global**. O dataset e os pontos de integração dos motores puros foram implementados e testados localmente. Permanecem consumidores sem contexto autoritativo unificado e falta autorização persistente das sessões. A política padrão continua `legacy`. Não basta trocar essa constante para publicar a V3 com segurança.

Nenhum deploy, commit, push, publicação Firebase/Firestore ou acesso de escrita a dados reais foi executado. Os testes de integração utilizaram somente Firestore Emulator. Nenhum exercício incompleto foi ativado. Os arquivos das etapas anteriores foram preservados.

## Fonte, identidade e importação

Fonte editorial: `AJ_Fit_Substituicoes_4_Abas_REVISADA_V3.xlsx`, preservada sem alteração. A extração offline em `scripts/importSubstitutionsV3.py` lê as quatro abas operacionais e a aba de condicionais. Nomes são resolvidos exclusivamente contra os nomes completos dos catálogos reais, com normalização Unicode, espaços e caixa. Não há aproximação textual, criação de ID, nem tentativa de substituir uma variante por outra.

O artefato `dataset.json` guarda identidade SHA-256 da planilha, versão `ajfit-substitutions-v3.0.0`, SHA-256 do payload, identidades e linha/aba de origem de cada relação. O teste recalcula os dois hashes. Identidades conhecidas incluem catálogo operacional, atividades canônicas e os 41 rascunhos, sem inserir rascunhos no catálogo operacional.

| Conteúdo | Quantidade |
| --- | ---: |
| Contextos editoriais | 556 |
| Relações principais | 1.156 |
| Academia comuns | 421 |
| Casa comuns | 213 |
| Limitações academia | 361 |
| Limitações casa | 161 |
| Condicionais isoladas e inativas | 139 |
| Contextos `REVISAR` bloqueados | 26 |
| Contexto sem substituição aceita | 1 |
| Listas comuns explicitamente vazias | 16 |
| Exercícios em rascunho preservados e inativos | 41 |

Não há autossubstituições, duplicações dentro do mesmo contexto, IDs desconhecidos ou prioridades fora de 1–3 nas relações principais. As prioridades clínicas são extraídas pela ordem das linhas de cada grupo da planilha. As oito relações envolvendo atividades canônicas não são promovidas artificialmente ao tipo de exercício resistido.

## Arquitetura implementada

`src/workoutPrescription/substitutionPolicyV3.ts` é a fonte compartilhada de descoberta e autorização editorial. O script de sincronização existente copia esse mesmo módulo e o JSON para o backend. Não foi criado outro algoritmo de equivalência ou outro catálogo operacional.

A seleção V3 consulta exclusivamente o contexto de academia/casa e comum/limitação correspondente. Ausência de regra, lista explicitamente vazia, revisão e nenhuma alternativa aceita permanecem distinguíveis no dataset. Nenhum desses casos autoriza expansão por família. As 139 condicionais não participam das listas principais; seu texto não constitui condição verificável nem aprovação de segurança.

O mecanismo recebe `policy: 'v3'` apenas nos pontos preparados para ensaio local. Sem seleção explícita, utiliza a política `legacy`. O algoritmo legado de descoberta/ordenação continua como padrão.

A ordem das candidatas V3 elegíveis é editorial, inclusive em evolução de ciclos. Não se aplica reordenação por dificuldade, família, similaridade, novidade, ID ou alfabeto. Uma opção indisponível é removida sem preencher a vaga com alternativas externas à lista. Se nenhuma passar, os contratos existentes retornam ausência de candidata; a evolução mantém o exercício atual.

Com múltiplas limitações, o motor exige autorização em todas as listas ativas e segurança terminal em todas as regiões. Se as listas discordarem sobre a ordem relativa das candidatas da interseção, o contexto fica sem alternativas até revisão editorial. Não foi inventada uma precedência clínica entre regiões. A exigência editorial em todas as regiões é conservadora e contribui para a perda de cobertura medida abaixo.

Os validadores existentes continuam verificando finalidade, equipamento, disponibilidade, duplicação e perfis aprovados. Perfil ausente, inválido ou pendente não é interpretado como segurança. Nenhum perfil clínico foi modificado. No caminho V3 clínico também se exige o critério de mecânica já usado na substituição manual, mantendo a exceção existente de variante explicitamente declarada. Isso bloqueia quatro ocorrências adicionais de pullover com elástico → puxada com elástico, que precisariam de autorização específica de equivalência/dose. Nenhuma exceção nova foi concedida.

A dose permanece a do slot, como nos motores atuais. Não há autorização para atravessar finalidade ou mecânica e manter a mesma dose por mera vontade editorial. Compatibilidade específica de intensidade, progressão e unidade nas relações hoje rejeitadas ainda exige revisão; esta entrega não certifica as 700 relações como clinicamente aprovadas para todos os usos.

## Situação dos consumidores

| Consumidor | Implementado localmente | Lacuna antes de ativar |
| --- | --- | --- |
| Descoberta e ordem manual | Política opcional V3 e lista exclusiva | Receber política e contexto autoritativos da sessão |
| Preview manual | Catálogo com perfis existentes quando ensaiado em V3 | Unificar snapshot de respostas e identidade do catálogo com servidor |
| Validação direta do backend | Política opcional e membership editorial antes de aceitar | Callable ainda não carrega uma política global versionada nem pin de sessão |
| Preferências permanentes | Mesmo filtro editorial; preferência inválida não é apagada nem trocada por terceira opção | Admissão autoritativa na criação, cache/offline e pin de sessão |
| Composição v1.27 | `substitutionPolicy` opcional, motor clínico compartilhado | Propagar política autorizada na geração/persistência, com compatibilidade de clientes |
| Composição legada v2 | Contexto V3 opcional; fallback de equipamento limitado à lista editorial | Homologar todos os chamadores e identidade de contexto |
| Resolvedores clínicos | Lista editorial, interseção, prioridade, perfis e disponibilidade | Resolver bloqueios editoriais/clínicos sem liberar rascunhos |
| Evolução/rotação pura | Pool exclusivo e ordem editorial | Serviços cliente/servidor ainda têm diferenças de catálogo/perfis e equipamento |
| Retomada/finalização | Comportamento legado preservado | Servidor ainda revalida contra catálogo corrente; falta autorização persistente |
| Execuções sem `programInstanceId` | Comportamento anterior preservado | Aplicação manual do servidor continua sem suporte autoritativo para esse caso |

Essas lacunas estão representadas em `V3_ACTIVATION_BLOCKERS`. `validateSubstitutionPolicyActivation` recusa a ativação mesmo com hash, catálogo e protocolo coincidentes enquanto houver bloqueios. Esse validador é uma preparação local, **não um serviço completo de controle global ou de rollback em produção**. Nenhuma configuração remota foi criada ou lida para ativar V3.

## Relações elegíveis e bloqueadas

A auditoria reproduzível está em `integrity-report.json`, com **cada uma das 1.156 relações**, origem, prioridade, motivos anteriores e motivos V3. É uma simulação isolada com catálogo local revisado, sessão sem colisões e contexto de equipamentos v1.27 existente. Não presume inventário real de usuários legados.

| Classificação da simulação | Relações |
| --- | ---: |
| Passam pelos gates locais no contexto isolado | 700 |
| Bloqueadas | 456 |
| Bloqueadas por dependência de rascunho, como origem ou destino | 223 |
| Bloqueadas que já integravam as 221 rejeições anteriores | 221 |
| Outras bloqueadas: oito atividades canônicas e quatro diferenças de mecânica | 12 |

As três últimas linhas particionam as 456 bloqueadas. Motivos individuais podem se sobrepor: 129 ocorrências têm destino em rascunho e 120 têm origem em rascunho. O JSON registra também rejeições de finalidade, papel/mecânica, equipamento e perfil ausente.

As **221/221 incompatibilidades anteriores continuam bloqueadas**. Foram tratadas por categorias verificáveis, sem afrouxar equivalência ou inventar aprovação clínica. O JSON permite revisão individual por linha da planilha. Exemplos de categorias: troca entre empurrar e fly; extensão de joelho e agachamento; hinge e flexão de joelho; mudança de estabilização de tronco; diferenças de papel e equipamento.

Os 41 IDs preparados anteriormente são dependências conhecidas, mas continuam ausentes dos catálogos operacionais usados nos motores. Nenhuma alteração de vídeos ou perfis desses exercícios foi feita nesta etapa. Suas relações poderão ser reavaliadas quando estiverem ativos e aprovados; o dataset não precisa ser reescrito para isso.

**Relações V3 disponibilizadas a usuários nesta etapa: zero.**

## Reexecução dos 102 templates

O script `scripts/auditSubstitutionsV3.ts` executa os 102 templates sem limitações, com cada região isolada e com todas as 127 combinações não vazias, nos dois modos. Não grava nem modifica templates ou programas instalados.

| Cenário | Política legada, linha de base reproduzida | V3 isolada |
| --- | ---: | ---: |
| Sem limitações | 102/102 | 102/102 |
| Uma limitação | 629/714 | 99/714 |
| Combinações não vazias | 8.932/12.954 | 303/12.954 |

A simulação V3 perde 530 composições com região isolada e 8.629 no conjunto completo; não apresentou melhorias de cobertura. Detalhes por combinação e IDs dos templates que deixam de compor constam no JSON. As causas incluem cobertura editorial estrita, dependências inativas, interseção das listas e incompatibilidades preservadas. **Essas perdas impedem ativação global.** Não foram escondidas mediante fallback por família ou relaxamento de segurança.

| Região isolada | Legado | V3 isolada |
| --- | ---: | ---: |
| Joelho | 98 | 6 |
| Quadril | 98 | 6 |
| Coluna | 92 | 6 |
| Ombro | 79 | 3 |
| Cotovelo | 79 | 25 |
| Punho | 85 | 47 |
| Tornozelo/pé | 98 | 6 |

## Testes e verificações

Resultados e nomes das falhas estão em `verification.json`.

- TypeScript do aplicativo e do backend: passaram.
- Suíte completa do aplicativo: 7.888 passaram, 44 falharam, 228 foram ignorados. As mesmas 44 falhas por arquivo/nome já estavam na execução anterior; nenhuma falha nova nessa comparação. Um teste de ffmpeg opcional não foi habilitado nesta etapa.
- Verificação final direcionada: 122 testes passaram em oito arquivos, incluindo integridade e preservação de comportamento. Inclui integridade V3, legado manual/equipamento, evolução, preview e preservação dos rascunhos.
- Suíte completa do backend: 2.022 passaram, zero falhas, 391 ignorados.
- Firestore Emulator: 146 passaram e cinco falharam em quatro arquivos. Reexecução dos mesmos arquivos em `git archive HEAD`: 144 passaram e as mesmas cinco falharam; diferença de duas aprovações corresponde aos testes V3 adicionados. O teste puro adicional final compara preview e backend para todos os contextos operacionais e IDs candidatos com o mesmo catálogo/contexto. Isso não é aprovação da admissão global V3.
- ESLint global (`npm run lint`): falhou com 48 erros e 474 avisos. Os 48 erros em `src`/`App.tsx` também existem na cópia limpa de HEAD. ESLint dos arquivos TypeScript alterados: zero erros e oito avisos. Não foi aplicado autofix fora do escopo.
- O JDK padrão 17 não passa no preflight; o emulador foi executado com o JDK 21 já instalado, limitado ao comando. Não houve alteração da configuração Java global.
- Catálogo antigo e 41 rascunhos: testes de integridade e fingerprint passaram. Novos testes verificam que o ensaio V3 não modifica os templates nem altera o resultado legado subsequente.
- Não testados/aprovados: iPhone, V3 global real, protocolo entre versões, autorização persistente de sessões, rollback de sessões V3, sincronização offline posterior e execução sem instância sob V3.

As cinco falhas do emulador são expectativas antigas de intervalo de condicionamento, bloqueio musculoesquelético de inicialização v1.27, semântica de adaptação v2 e duas expectativas de calendário fixo na finalização. Não foram corrigidas alterando regras fora do escopo.

## Integridade de dados e usuários

Nenhum treino atribuído, histórico, carga, série, cronograma ou preferência real foi lido para escrita ou alterado. Nenhuma migração de dados foi executada. Os testes usam fixtures e documentos locais do emulador. Os 102 templates, o catálogo seed, o dataset de perfis, a identidade dos exercícios existentes e os cadastros em rascunho não foram modificados.

A materialização de preferências continua ocorrendo apenas ao criar uma execução; retomar uma execução não chama novamente essa rotina. Uma preferência não elegível no ensaio V3 permanece registrada, e a sessão usa o exercício prescrito em vez de inventar uma terceira opção.

A preservação atual decorre de a política continuar legada e de não haver migração. **Não é evidência de que uma futura mudança global preserve autorizações antigas.** O pin de autorização continua pendente e é bloqueio explícito. Não há alegação de aprovação de finalização/offline após ativação ou rollback V3.

## Arquivos desta etapa

Criados:

- `src/workoutPrescription/substitutionPolicyV3.ts`
- `src/workoutPrescription/__tests__/substitutionPolicyV3.test.ts`
- `scripts/importSubstitutionsV3.py`
- `scripts/auditSubstitutionsV3.ts`
- `docs/substitutions-v3/dataset.json`
- `docs/substitutions-v3/integrity-report.json`
- `docs/substitutions-v3/verification.json`
- `docs/substitutions-v3/report.md`

Modificados:

- `src/workoutPrescription/manualSubstitutionResolver.ts`
- `src/workoutPrescription/manualSubstitutionCatalog.ts`
- `src/workoutPrescription/limitationResolver.ts`
- `src/workoutPrescription/musculoskeletalLimitationV127.ts`
- `src/workoutPrescription/compositionV127.ts`
- `src/workoutPrescription/composition.ts`
- `src/prescriptionEvolution/equivalence.ts`
- `src/prescriptionEvolution/cycleEvolution.ts`
- `src/services/exerciseSubstitutionCandidates.ts`
- `src/services/workoutExecutions.ts`
- `functions/src/workoutLifecycle/exerciseSubstitution.ts`
- `functions/src/workoutLifecycle/__tests__/exerciseSubstitution.test.ts`
- `scripts/syncPrescriptionEngineToFunctions.cjs`

As cópias geradas e ignoradas do motor no backend foram sincronizadas pelo script existente. A modificação de `ExerciseGif.tsx` e os arquivos de vídeos/cadastros V3 anteriores já existiam no início desta etapa; não fazem parte desta implementação. O log rastreado do emulador foi restaurado ao conteúdo inicial após os testes.

## Continuação necessária e publicação futura

1. Revisar os 456 bloqueios, as 26 revisões e as prioridades em interseções. Para as 221 incompatibilidades, aprovar apenas exceções específicas com evidência de finalidade, intensidade, unidade e dose, ou manter bloqueadas. Testar cada autorização; não alterar globalmente `purposePreserved`.
2. Concluir mídia demonstrativa e revisão dos sete perfis dos 41 rascunhos. Mantê-los inativos até validação completa. Implementar tratamento explícito das atividades canônicas sem transformá-las em exercícios resistidos fictícios.
3. Unificar o contexto autoritativo de preview, aplicação, preferências e evolução: mesmas respostas da instância, ambiente, regra de inventário por versão e identidade de catálogo/perfis. Não usar o questionário mais recente num lado e o snapshot da instância no outro. Preservar a diferença de equipamento v1.27/legado.
4. Implementar admissão de sessão pelo servidor e autorização persistente protegida pelas regras. O registro deve vincular usuário, execução, encarnação/reinício, slot/âncora, destino, política, hash do catálogo/perfis e dose. Nunca aceitar um pin apenas porque o cliente o enviou. Autorizar preferências na admissão e novas trocas na transação do servidor, sem mudar exercícios com séries realizadas.
5. Definir compatibilidade para sessões anteriores sem pin e execuções sem `programInstanceId`, inclusive offline. Conservar versões anteriores dos validadores/datasets necessários à autorização; não revalidar uma sessão já autorizada apenas contra a nova política global. Não autorizar arbitrariamente marcadores enviados por clientes antigos.
6. Implementar protocolo de capacidade cliente/backend e carregamento da política global versionada. Clientes antigos devem continuar numa política compatível ou impedir novas operações incompatíveis com orientação de atualização, preservando a conclusão das sessões existentes. Remover os bloqueios de ativação apenas com cobertura end-to-end.
7. Homologar admissão, aplicação, preferências, retomada, evolução, finalização e sincronização offline nos dois motores e em versões diferentes. Testar usuário novo, usuário antigo, sessões iniciadas antes/depois da troca e todos os 102 templates novamente. Resolver ou aceitar formalmente as falhas preexistentes; não rotular suíte vermelha como aprovada.
8. Homologar no iPhone, incluindo execução em andamento e áudio/mídia dos exercícios futuramente aprovados. Publicar cliente, backend, regras e identidades de catálogo de forma coordenada, primeiro com V3 desligada. Conferir hashes e cobertura antes de solicitar ativação expressa.

Rollback futuro deve trocar a política de **novas admissões** para a versão legada, mantendo o registro de versões e as autorizações de sessões já iniciadas. Não deve apagar exercícios, regenerar programas, desfazer cargas nem remover preferências. Esse rollback persistente ainda precisa ser implementado e testado junto com a admissão acima. No estado entregue, a V3 nunca é selecionada automaticamente; o teste de alternância isolada confirma somente que o motor legado continua determinístico e sem mutação após ensaio V3.

Não é necessária migração destrutiva de treinos. Será necessária evolução aditiva do protocolo/autorização e publicação coordenada; alterar apenas Firestore não resolve. **A próxima ação técnica é concluir essas integrações pendentes, não ativar este artefato.**
