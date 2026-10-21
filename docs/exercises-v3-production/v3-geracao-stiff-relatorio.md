> Registro histórico: o sistema musculoesquelético e as políticas clínicas V3/legacy descritos aqui foram descontinuados. Não são contratos atuais. Ver [remoção definitiva](../removal-physical-limitations/REPORT.md).

> **Caso do iPhone confirmado:** masculino/hipertrofia/intermediário/5 dias/academia/joelho seleciona **T004**, não T093. A geração continua bloqueada por perfil ausente e insuficiência editorial de destinos distintos. Diagnóstico e testes exatos em [v3-geracao-stiff-iphone-t004-relatorio.md](v3-geracao-stiff-iphone-t004-relatorio.md). As referências a respostas ainda não fornecidas abaixo descrevem apenas o estado da investigação anterior.

# Falha de geração V3 no iPhone — Stiff com Halteres

**Resultado: defeitos técnicos corrigidos localmente; bloqueios sem configuração segura preservados. O treino que falhou no iPhone não pode ser declarado liberado.** Nenhum deploy, build do aplicativo, OTA, commit, push ou alteração de dados reais foi executado nesta correção. V3 permanece globalmente ativa.

As respostas do questionário do teste físico não foram fornecidas até o fechamento. Foram solicitadas limitação, ambiente, sexo, objetivo, nível, frequência, equipamentos e eventual template. O código de erro sozinho **não identifica univocamente o template nem a região**. Este relatório distingue a reprodução comprovada das informações ainda não confirmadas do aparelho.

## 1. Causa raiz comprovada e reprodução

`src/workoutPrescription/musculoskeletalLimitationV127.ts` produz:

```text
MUSCULOSKELETAL_NO_SUBSTITUTE:<sessionIndex>:<originalRuntimeId>
```

O índice **2 é a terceira sessão, começando em zero**. Não é o identificador de uma limitação. `composeTemplateV127` propaga o bloqueio; antes desta correção `engineV127` o transformava indiscriminadamente em `INVALID_CONFIGURATION`. A UI interpretava esse status como erro técnico transitório e oferecia nova tentativa.

Reprodução exata do reason code, pelo serviço real `prepareWorkoutProgramLocally` → roteador ativo → seleção → composição:

| Campo | Reprodução comprovada |
|---|---|
| Template | **T093**, adaptação inicial, academia, quatro dias |
| Nível | BEGINNER / `level: beginner` |
| Limitação | **Joelho** (`knee`) |
| Original | `dumbbell-stiff-leg-deadlift` — Stiff com Halteres |
| Sessão | Índice 2 |
| Segurança do original | Perfil `approved`, região joelho **adapt**, não terminal segura |
| Alternativa primária de joelho/academia | `stiff-leg-deadlift-machine` — Stiff Máquina |
| Rejeição | **LIMITATION_PROFILE_MISSING** |
| Equipamento | Halteres na origem; máquina no candidato. A academia permite ambos; equipamento não causa esta rejeição |
| Resultado anterior | `INVALID_CONFIGURATION` + reason code exato |
| Resultado local corrigido | `NO_SAFE_CONFIGURATION` + mesmo reason code e diagnóstico de cada candidato; sem programa parcial |

**T093/joelho é uma reprodução do erro informado, não uma identificação presumida do questionário do proprietário.** Antes da correção, a enumeração local reproduziu esse reason code em 4.471 combinações template×regiões, distribuídas por 39 templates. As mesmas 4.471 ocorrências permanecem na enumeração depois da correção: nenhuma passou a ser aceita sem solução aprovada.

O Stiff possui `adapt` em joelho, quadril, coluna, ombro e tornozelo/pé; cotovelo é `not_applicable` e punho é `compatible`. Preservar o original só é permitido se **todas** as regiões ativas forem terminais seguras. Em joelho não é permitido. O motor não pode assumir segurança por ser um exercício já presente no template.

## 2. Planilha original e dataset

A planilha foi lida diretamente como XLSX/XML, incluindo as abas primárias e condicionais. Seu SHA-256 continua idêntico a `sourceSha256` do dataset. Nenhuma célula, relação, perfil ou aprovação foi alterada.

| Ambiente / região | Relações primárias para Stiff com Halteres, na ordem editorial | Situação |
|---|---|---|
| Academia / joelho | **Stiff Máquina** | Perfil musculoesquelético ausente; bloqueado |
| Academia / quadril | Mesa Flexora; Cadeira Flexora | Candidatos sujeitos a perfil, equipamento e não duplicidade no contexto completo |
| Academia / coluna | Mesa Flexora; Cadeira Flexora | Mesmas validações independentes |
| Academia / ombro | Stiff Máquina; Mesa Flexora | Máquina sem perfil; Mesa pode estar ocupada por outro slot obrigatório |
| Academia / tornozelo/pé | Mesa Flexora; Cadeira Flexora | Mesmas validações independentes |
| Casa / joelho | **REVISAR — sem alternativa com carga compatível com a limitação** | Zero relações automáticas aprovadas |
| Casa / quadril | Flexão de Joelhos com Elástico; Flexão de Joelho Sentada com Elástico | Exigem equipamento e perfil seguro |
| Casa / coluna | Flexão de Joelhos com Elástico; Flexão de Joelho Sentada com Elástico | Mesmas validações independentes |
| Casa / ombro | Flexão de Joelhos com Elástico | Pode estar ocupada por outro slot, sem segunda alternativa aprovada |
| Casa / tornozelo/pé | Flexão de Joelho Sentada com Elástico; Flexão de Joelho Deslizante | A segunda exige `slider`, fora do kit doméstico operacional atual |

Referências exatas da planilha: academia-comuns linha 85; casa-comuns linha 47; limitações-academia linhas 55–63; limitações-casa linhas 31–38. As listas comuns incluem Barra/Smith/Máquina na academia e Unilateral/Terra/Sumô em casa, **mas não autorizam esses pares para uma limitação ativa**.

A aba `Alternativas Condicionais`, linhas 32–37 e 91–96, contém Dobradiça de Quadril e/ou Ponte de Glúteos. O texto exige uma regra futura para público adaptado; continuam `pending_conditions`. Ser iniciante não verifica nem aprova automaticamente essas condições. Não foi restaurado o antigo `hip-hinge-drill` do perfil legado para contornar a planilha.

No caso ombro há reproduções adicionais do mesmo erro por `LIMITATION_CANDIDATE_VISITED`: a alternativa autorizada já está em outro slot. Isso não significa que toda colisão seja bug. Uma busca completa precisa demonstrar que há uma alocação sem duplicidade para **todos** os exercícios. Para os casos reproduzidos com o reason code exato do Stiff não há programa completo seguro nas regras atuais.

## 3. Por que o programa inteiro é bloqueado

O template tem slots obrigatórios e a composição v1.27 não permite omiti-los. Falha em um deles impede o programa completo, evitando a instalação de uma prescrição incompleta ou insegura. Esse bloqueio é necessário quando inexiste solução aprovada.

Alternativas arquiteturais verificadas:

- **Outro template com o mesmo perfil:** a seleção exige ambiente, frequência, população/nível e, quando aplicável, sexo/objetivo. Remover o template selecionado e executar novamente o seletor nos outros 101 não encontra alternativa elegível em nenhum dos 102 perfis. Não foi alterado sexo, população, objetivo, nível ou número de dias para forçar outra seleção.
- **Outra configuração dentro do mesmo template:** agora é feita uma busca completa das alternativas já aprovadas, preservando todos os slots e sua ordem/dose.
- **Original seguro:** permanece como primeira opção quando seu perfil confirma segurança em todas as regiões ativas. Origem `adapt`, `avoid`, `pending`, ou sem perfil não é liberada como original seguro.
- **Sem configuração completa segura:** permanece bloqueado, sem programa, com diagnóstico e classificação não transitória.

## 4. Defeitos técnicos corrigidos

### Alocação gulosa

O compositor anterior confirmava o primeiro candidato de cada slot sem verificar o efeito sobre os seguintes. Podia consumir o original seguro ou a única alternativa aprovada de outro slot e declarar uma indisponibilidade falsa.

Foi adicionada busca determinística por sessão, **exclusivamente para V3**. O pool de cada slot vem do resolvedor central existente; original seguro primeiro, demais candidatos na ordem editorial. A busca escolhe a primeira configuração completa viável e memoriza estados sem solução. Não cria relação, expande família, relaxa perfil/equipamento, omite exercício ou troca template.

Exemplo real antes bloqueado: **T002 / academia / cotovelo**, na sessão de puxadas. Rosca Direta Barra W consumia Rosca Martelo; a Rosca Martelo original ficava sem lugar. A configuração aprovada completa usa Rosca Martelo com Elástico para a Barra W e preserva a Rosca Martelo segura no seu próprio slot. A configuração é gerada e persistida pelo callable real no emulador.

Foram recuperadas **66 configurações**, todas de limitação individual, em 45 templates: 30 de cotovelo, 34 de punho e duas de ombro. Relações editoriais permanecem exatamente as mesmas.

### Classificação e diagnóstico

A ausência de composição segura na V3 agora retorna **`NO_SAFE_CONFIGURATION`**, mantendo os reason codes e o trace completo de limitações. A UI reutiliza a mensagem localizada existente de treino indisponível e não oferece retry técnico. Contratos históricos explicitamente legacy mantêm o comportamento anterior.

O dispatcher autoritativo do backend continua rejeitando com `failed-precondition` e agora inclui os reason codes e o trace em `details`. Isso preserva template, regiões, slots e rejeições na resposta, sem instalar plano inseguro. Não há nova validação clínica inventada no backend.

**A correção da classificação não é apresentada como recuperação do caso do Stiff.** Ela corrige o diagnóstico e evita que três tentativas idênticas sejam apresentadas como solução para falta de conteúdo aprovado.

## 5. Matriz e outros cenários

Script reproduzível, somente local:

```sh
npx tsx scripts/validateV3InitialGeneration.ts
```

Resultado completo: [v3-geracao-stiff-matriz.json](v3-geracao-stiff-matriz.json). V3 global real, sem override; 102 templates × 128 combinações (incluindo nenhuma região), academia/casa.

| Verificação | Resultado |
|---|---:|
| Composição sem limitações | 102/102 |
| Limitação individual | **258/714** (antes 192/714) |
| Combinações não vazias completas | **470/12.954** (antes 404/12.954) |
| Configurações recuperadas sem novas relações | **66** |
| Combinações com bloqueio legítimo preservado | **12.484** |
| Comparações com oráculo independente de alocação | **13.056/13.056 concordam** |
| Geração pelo roteador real, por cenário | **572 sucessos e 12.484 NO_SAFE_CONFIGURATION; zero outros erros** |
| Pares de geração com inventário vazio/preenchido | **13.056 pares idênticos** |
| Resolvedor com executabilidade restrita ao peso corporal | 274 APPLIED / 12.782 BLOCKED |
| Templates alternativos com mesmo perfil de seleção | **0** |

O oráculo usa caminhos aumentantes de emparelhamento, diferentes da busca ordenada do compositor. Confere a existência de solução sobre relações aprovadas e candidatos seguros. Cada configuração aceita também foi verificada quanto a número de slots, âncora original, autorização editorial dos substitutos, equipamento e segurança de todas as regiões ativas. A regressão numérica V3 foi atualizada **depois** dessa prova independente; o legado continua 629/714 e 8.932/12.954.

**Equipamentos:** o contrato atual de geração v1.27 não usa `answers.equipment`; a pergunta foi removida e a prescrição assume o kit do ambiente (`unrestrictedEquipmentContext`). Essa decisão anterior não foi alterada nesta correção. Por isso inventário vazio/preenchido produz o mesmo resultado no fluxo real. A compatibilidade e a indisponibilidade de equipamento foram verificadas separadamente no resolvedor/compositor injetando executabilidade restrita: por exemplo, o Stiff com limitação de quadril em casa aceita a Flexão de Joelhos com Elástico quando o elástico existe e bloqueia quando não existe. O teste não chama equipamento inexistente de disponível.

Os demais bloqueios foram classificados por ausência de regra regional, REVISAR, interseção editorial vazia/conflitante, perfil ausente/pending, indisponibilidade ou impossibilidade de alocação completa. Os contadores de `blockedSlotCauses` são ocorrências de slots diagnosticados nas sessões examinadas, não novas relações ou totais de pessoas. Não houve aumento de cobertura editorial nem promoção de condicionais.

## 6. Testes executados

| Teste | Resultado |
|---|---|
| TypeScript app | Limpo |
| TypeScript Functions (com sync das fontes compartilhadas) | Limpo |
| ESLint dos arquivos desta correção | Zero erros; apenas avisos históricos no arquivo de integração já existente |
| App completo | **7.919 aprovados / 44 falhas preexistentes / 232 ignorados** |
| Comparação nominal com a baseline anterior | Mesmos 44 testes com falha, sem falhas novas |
| Backend completo | **2.028 aprovados / zero falhas / 403 ignorados** |
| Serviço real de preparação + V3 global + UI de bloqueio | **14/14** no grupo direcionado; inclui quatro testes novos do serviço |
| INITIALIZE real, Admin SDK + Firestore Emulator | **2/2**, novos cenários direcionados; os outros 96 do arquivo não foram executados nessa rodada direcionada |
| Matriz completa descrita acima | Todos os asserts passaram |

Não foi usado apenas o teste de um resolvedor isolado:

1. `prepareWorkoutProgramLocally` foi chamado com respostas completas e três tentativas iguais. Reproduz o reason code exato e retorna sem plano, com causa de perfil ausente e template T093 no trace.
2. O dispatcher real `generateAuthoritativePlan` foi exercitado no backend, sem objeto Firestore no caminho puro, conferindo o mesmo diagnóstico e a configuração recuperada T002.
3. `initializeWorkoutProgramV127Handler` foi executado contra Firestore Emulator: T093/joelho rejeitado com o reason code exato e **zero programas/instâncias/ciclos/estados criados**; T002/cotovelo persistido com a configuração aprovada completa.
4. Foram testados REVISAR em casa/joelho, preservação do original seguro, dose/identidade/quantidade de slots, não duplicidade e equipamento ausente.

Evidência consolidada: [v3-geracao-stiff-validacao.json](v3-geracao-stiff-validacao.json).

## 7. Publicação necessária e estado atual

**Nenhum deploy foi executado.** As novas correções estão somente locais. Para levá-las ao backend, será necessária autorização para compilar/publicar exclusivamente:

- `initializeWorkoutProgramV127`: composição corrigida e diagnóstico da geração inicial.
- `authorizeWorkoutLifecycleMutation`: mesma geração autoritativa utilizada por INITIALIZE/ADAPT/ativação de configurações.
- `installActiveWorkoutProgram`: geração autoritativa compartilhada na instalação/fallback.

`applyExerciseSubstitution` e Firestore Rules não precisam de alteração/publicação por este diff. Nenhum perfil ou dado real foi escrito. O aplicativo também precisará incorporar o código local corrigido pelo processo de publicação do proprietário; nenhum build/OTA foi feito nesta tarefa.

O backend hoje publicado **ainda usa o compositor anterior e o status antigo**. Um deploy dessas correções recuperaria as 66 configurações comprovadas e melhoraria o diagnóstico; **não criaria solução para o caso do Stiff sem perfil/regra aprovada**.

## 8. Veredito

**BLOQUEIO DE SEGURANÇA PRESERVADO — NÃO DECLARADO RESOLVIDO NO IPHONE.**

O erro informado foi reproduzido no fluxo real. Corrigidos localmente o falso bloqueio por alocação gulosa e a apresentação de uma indisponibilidade determinística como falha transitória. Para T093/joelho/academia, Stiff Máquina continua sem perfil aprovado; casa/joelho continua REVISAR. Não existe correção segura de código que invente essa aprovação. A identificação exata do template/região do teste físico aguarda as respostas solicitadas; os testes e resultados acima não a presumem.
