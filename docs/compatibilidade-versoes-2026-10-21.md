# Compatibilidade entre versões — Fase B

Preparado em 21/10/2026, no worktree `.worktrees/wt-treinos`
(branch local `integra-treinos`). **Nada publicado.**

---

## O problema

Este projeto **não tem OTA**: `expo-updates` não está no `package.json` e
`app.json` não declara `updates` nem `runtimeVersion`. Publicar o backend não
atualiza o binário de ninguém — atualizar exige novo build, submissão à loja e
o usuário aceitar a atualização. Dias ou semanas, não minutos.

Durante essa janela, **duas versões do app gravam ao mesmo tempo**.

O cliente das lojas envia `answers.limits`, `answers.limitationImpact` e
`musculoskeletal_limitation` dentro de `specialConditions`. O cliente novo
descarta os três na fronteira de gravação (`questionnaireAnswers.ts`). As
Rules integradas recusavam esses campos na criação do questionário — o que
impediria o usuário da versão antiga de concluir o onboarding, sem ter como
se atualizar antes de ser bloqueado.

## A solução: tolerar, não reabilitar

`firestore.rules`, criação de `users/{uid}/questionnaires/{id}`:

```
&& (!request.resource.data.answers.keys().hasAny(['limits'])
     || (request.resource.data.answers.limits is list
         && request.resource.data.answers.limits.size() <= 8
         && request.resource.data.answers.limits.toSet().hasOnly([
              'knee','hip','back','shoulder','elbow','wrist','ankle_foot','other','none'
            ])))
&& (!request.resource.data.answers.keys().hasAny(['limitationImpact'])
     || request.resource.data.answers.limitationImpact is string)
```

Três coisas importam nessa formulação:

1. **Nada volta a ler esses campos.** Os resolvedores clínicos continuam
   removidos; a prescrição ignora o que chegar ali. Tolerar uma gravação não é
   reativar uma lógica.
2. **É mais restrito que o estado publicado hoje.** As Rules que estão no ar
   (`798fd0d9`) não impõem restrição nenhuma ao conteúdo de `answers` na
   criação — apenas `answers is map`. A tolerância acima fecha tipo, tamanho e
   domínio de regiões, então a transição *aumenta* a segurança em relação a
   produção, em vez de abrir espaço.
3. **É removível.** Quando a adoção da versão nova tornar o bloqueio seguro,
   essas duas condições voltam a ser as recusas que a Fase A escreveu.

### O que NÃO foi relaxado

A recusa de `substitutionPolicySnapshot` na criação de execução
(`allow create: if !request.resource.data.keys().hasAny([...])`) **fica como
está**. O cliente V3 nunca foi distribuído — nenhum app instalado envia esse
campo — então afrouxar ali ampliaria permissão sem necessidade. Execuções
históricas que já o carregam seguem editáveis, com o valor imutável.

---

## Matriz de compatibilidade

Provada no Emulator (`firestore-tests/versionCompatibility.rules.test.ts`,
18 testes) e pelas suítes das Functions.

### App × Rules

| Cenário | Rules **publicadas hoje** | Rules **da Fase A, sem transição** | Rules **transitórias** |
|---|---|---|---|
| App da loja, conta **com** limitação | ✅ | ❌ **onboarding bloqueado** | ✅ |
| App da loja, conta **sem** limitação | ✅ | ✅ | ✅ |
| App novo, qualquer conta | ✅ | ✅ | ✅ |
| Conta do piloto, app da loja | ✅ | ❌ | ✅ |
| Conta do piloto, app novo | ✅ | ✅ | ✅ |
| Região inventada em `limits` | ✅ *(aceita — sem validação)* | ❌ | ❌ **recusa** |
| `limits` com 9 itens | ✅ *(aceita)* | ❌ | ❌ **recusa** |
| `limitationImpact` como objeto | ✅ *(aceita)* | ❌ | ❌ **recusa** |
| Execução nova com metadado V3 | ✅ | ❌ | ❌ **recusa** |
| Execução histórica com metadado V3, valor inalterado | ✅ | ✅ | ✅ |
| Execução histórica, tentando mudar o valor | ❌ | ❌ | ❌ |

### App × Functions

| Cenário | Comportamento com o backend da Fase A |
|---|---|
| App da loja lê programa **antigo** (com campos clínicos) | ✅ campos ignorados; programa continua válido |
| App da loja gera programa novo | ✅ prescrição normal, sem camada clínica |
| App novo lê programa antigo | ✅ idem |
| **Execução `IN_PROGRESS` iniciada antes da atualização**, com troca V3 materializada | ✅ `exerciseSubstitution.ts:202` mantém a troca por continuidade só-leitura; valida disponibilidade, equipamento e duplicidade, e **permite finalizar** |
| Conta do piloto, aderência | ✅ dias distintos treinados; 70% preservado |
| Conta fora do piloto, aderência | ✅ regra anterior, byte a byte |
| Troca manual, qualquer versão | ✅ 289 relações comuns preservadas da planilha V3 |

**Nenhum programa antigo é invalidado e nenhuma execução em andamento fica
impossível de finalizar.** Esse era o risco maior e está coberto por código
explícito, não por acaso.

---

## Testes

| Suíte | Resultado |
|---|---|
| **Compatibilidade entre versões (novo)** | **18/18** |
| Firestore Rules (completo) | **622/622** |
| TypeScript app + functions | limpos |
| Functions (completo) | **2097 passando, 0 falhas** |
| App (completo) | 8254 passando, 18 falhas **pré-existentes** |
| Questionário legado + remoção (app) | 23/23 |
| `workoutLifecycle` (functions) | 96/96 |
| Paridade de aderência | 11/11 |

As 18 falhas do app são os mesmos 10 arquivos que já falhavam na `main`
(RestOverlay, Live Activity, EditProfile, assinatura). Zero regressões novas.

---

## Sequência de publicação

A ordem documentada pelo Victor coloca as Rules finais no passo 5. Ela é
segura **desde que** o passo 5 só aconteça depois da adoção — e é exatamente
aí que a transição entra, para que o passo 5 não precise esperar para o
backend poder ir ao ar.

| # | Etapa | Depende de | Risco | Reversível? |
|---|---|---|---|---|
| 1 | **Rules transitórias** | nada | baixo — é mais restrito que hoje | ✅ segundos |
| 2 | **Cinco Functions** juntas | 1 | médio — motor compartilhado | ✅ pacote salvo |
| 3 | Verificação em produção, só leitura | 2 | nenhum | — |
| 4 | **Build e distribuição do app** | 2 | médio | ❌ **irreversível** |
| 5 | Aguardar adoção | 4 | — | — |
| 6 | **Rules finais** (retiram a tolerância) | 5 | alto se antecipado | ✅ segundos |
| 7 | Limpeza histórica dos campos | 6 | separado, exige autorização | — |

**Por que as Rules transitórias vêm primeiro:** elas são compatíveis com as
duas versões do cliente, então podem ir ao ar antes do backend sem quebrar
nada. Isso desacopla o passo 2 da distribuição do app.

**Por que as cinco Functions vão juntas:** `authorizeMutation.ts` importa
`limitationResolver` diretamente, e o motor de prescrição é compartilhado.
Publicar uma sozinha recria o descompasso que já nos bloqueou.

**Por que o passo 6 não pode ser antecipado:** é o único ponto sem volta para
o usuário que ainda não atualizou. Reverter as Rules é rápido, mas enquanto
estiverem no ar esse usuário não conclui onboarding.

### Estratégia para o passo 6

Três caminhos, em ordem de preferência:

1. **Esperar adoção medida.** Publicar as Rules finais quando a telemetria
   mostrar que a versão antiga caiu abaixo de um limiar acordado. Não exige
   código novo. É o caminho natural, porque os campos tolerados são inertes.
2. **Versão mínima exigida.** Bloquear o app antigo com uma tela de "atualize
   para continuar" antes de publicar as Rules finais. Exige implementar o
   mecanismo — hoje não existe nada disso no código.
3. **Nunca retirar.** Deixar a tolerância permanente. Custo: duas condições a
   mais nas Rules, sem efeito funcional.

Recomendo (1), com (3) como alternativa aceitável. (2) só se houver outro
motivo para forçar atualização.

---

## Rollback

| Camada | Procedimento | Tempo |
|---|---|---|
| Rules | reapontar o release para `798fd0d9` (`PATCH` com `updateMask=rulesetName`) | segundos |
| Functions | republicar as cinco a partir de `fonte-publicada.zip` (revisão `00019-jut`) | minutos |
| App | **sem rollback** — um build distribuído não volta | — |

É por isso que o app vem **depois** do backend e as Rules finais **depois** do
app: as duas camadas reversíveis protegem a irreversível.

Se for preciso reverter por causa do piloto especificamente, o caminho mais
barato não é deploy nenhum: desativar a inscrição
(`workoutPilotEnrollment/{uid}` → `enabled: false`) é a gravação de um
documento.

---

## Configuração de produção

| Variável | Situação | Ação |
|---|---|---|
| `NUTRITION_PLAN_SNAPSHOT_ENABLED` | `"true"` nas 5 Functions publicadas desde 19/10 13:05 | **preservar** — kill switch booleano, lido só por `mutateNutritionDiaryV1` |
| `NUTRITION_PLAN_SNAPSHOT_PILOT_UIDS` | `""` em 2 Functions antigas | **vestigial** — zero leituras no código integrado |

O `functions/.env` é ignorado pelo Git e não existe nesta máquina. Sem ele, o
deploy remove `NUTRITION_PLAN_SNAPSHOT_ENABLED` da Function publicada. É
inerte para `authorizeWorkoutLifecycleMutation` (não lê a variável), mas é uma
alteração de configuração que não se deve causar por acidente.
