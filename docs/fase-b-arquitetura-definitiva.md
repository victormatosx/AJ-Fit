# Fase B — arquitetura definitiva, sem compatibilidade legada

Preparado em 22/10/2026 no worktree `.worktrees/wt-treinos`
(branch local `integra-treinos`). **Nada publicado.**

## Decisão que mudou

O AJ Fit está em **pré-lançamento, sem usuários externos**. Os aparelhos
internos podem ser atualizados ou reinstalados. Logo, **não há compatibilidade
operacional a preservar com binários antigos** — e a tolerância transitória
que eu havia implementado em 21/10 deixou de ter finalidade.

Ela foi removida. As Rules recusam o contrato clínico aposentado em definitivo.

## O que ficou nas Rules

```
&& !request.resource.data.answers.keys().hasAny(['limits', 'limitationImpact'])
&& !request.resource.data.answers.get('specialConditions', []).hasAny(['musculoskeletal_limitation'])
```

A recusa vale para **escrita nova**. O que já está gravado continua legível e
utilizável — essa fronteira é o único resquício de "compatibilidade" que
sobrou, e ela não é legado: é integridade de histórico.

| Operação | Resultado |
|---|---|
| Questionário novo com `limits` / `limitationImpact` / `musculoskeletal_limitation` | **recusado** |
| Questionário já gravado com esses campos | **legível** |
| Execução nova com `substitutionPolicySnapshot` | **recusada** |
| Execução já gravada com o metadado | **legível e finalizável**; valor imutável |
| Questionário no formato atual, piloto ou não | **aceito** |
| Outras condições especiais (lipedema, pós-cirúrgico…) | **aceitas** — só a clínica musculoesquelética saiu |

## Resíduos da arquitetura antiga: nenhum

Varredura do código de produção (`src` e `functions/src`, excluindo testes):

| símbolo | ocorrências |
|---|---|
| `limitationResolver` | 0 |
| `musculoskeletalLimitationV127` | 0 |
| `canonicalMusculoskeletalLimitationV127` | 0 |
| `substitutionPolicyV3` | 0 |
| `limitationDataset` | 0 |
| `localLimitationCatalog` | 0 |
| `generationPolicy` | 0 |
| `MUSCULOSKELETAL_NO_SUBSTITUTE` | 0 |
| `NO_SAFE_CONFIGURATION` | 0 |

O guardião automático do Victor (`physicalLimitationsRemoved.test.ts`) percorre
as duas árvores de produção e falha se qualquer um desses símbolos voltar.
7/7 passando.

**Atualização (22/10):** a pergunta foi removida também da coleta. Até então
ela ainda existia como estado local de onboarding — `specialConditions`
oferecia `musculoskeletal_limitation` e, ao marcá-la, o passo `limits`
aparecia com rótulos nos três idiomas; apenas a gravação era descartada. Agora
não existe mais passo, opção, rótulo nem `Quiz['limits']`, e a sequência do
funil tem 48 passos (era 49). Saíram com ela duas coisas que haviam ficado
inalcançáveis: a inferência que ressuscitava a opção a partir de um `limits`
legado e o gate de validação `limitations_required`, que nenhuma tela restante
poderia satisfazer.

As camadas que **leem, descartam ou toleram** o dado permanecem intactas —
`sanitizeAnswersForEngine`, `prescriptionInputs`, o `limits?: unknown`
read-only de `PersistedQuizAnswers` e a tolerância das Rules a snapshots
históricos. Documentos antigos seguem legíveis; novas gravações seguem
recusadas.

## Dados históricos a preservar

Nenhuma migração é necessária. O `DATA-CLEANUP.md` do Victor é explícito: a
aplicação ignora os campos retirados, e a limpeza é opcional, com autorização
separada.

O que **precisa continuar funcionando**, e está coberto:

1. **Questionários antigos** com campos clínicos — legíveis; o normalizador os
   filtra na leitura.
2. **Programas antigos** com `limitationDatasetVersion`, `limitationDatasetHash`
   e `versions.limitationResolver` — continuam válidos; os campos são ignorados.
3. **Execuções `IN_PROGRESS` com `substitutionPolicySnapshot`** — continuidade
   só-leitura em `exerciseSubstitution.ts:202`: a troca já materializada é
   mantida, validada por disponibilidade/equipamento/duplicidade, e a sessão
   **pode ser finalizada**. Esse é o caso que não pode ser perdido numa
   eventual limpeza futura.

## Testes

| Suíte | Resultado |
|---|---|
| TypeScript app + functions | limpos |
| **Firestore Rules** | **621/621** |
| **Contrato clínico aposentado (novo)** | **17/17** |
| **Functions completo** | **2097 passando, 0 falhas** |
| Prescrição e substituições | 544/544 |
| Questionário (onboarding + schema + answers) | 152/152 |
| Piloto, Chama, aderência, rotação | 781/781 |
| Jotinha e rotação (telas) | 76/76 |
| `workoutLifecycle` (functions) | 96/96 |
| Paridade de aderência cliente/backend | 11/11 |
| App completo | 8254 passando, 18 falhas **pré-existentes** |

As 18 falhas são os mesmos 10 arquivos que já falhavam na `main` (RestOverlay,
Live Activity, EditProfile, assinatura). Zero regressões novas.

## Sequência de publicação

Sem usuários externos, a ordem fica mais simples do que a versão de 21/10 —
não há mais janela de adoção a respeitar.

| # | Etapa | Depende de | Reversível |
|---|---|---|---|
| 1 | **Cinco Functions** juntas | — | ✅ pacote `00019-jut` salvo |
| 2 | **Rules finais** | 1 | ✅ segundos (`798fd0d9`) |
| 3 | **Build interno** e reinstalação nos aparelhos | 2 | ❌ mas sem impacto externo |
| 4 | Verificação em produção, só leitura | 3 | — |
| 5 | Limpeza histórica dos campos | 4 | autorização separada |

**Functions antes das Rules:** o backend novo tolera dados antigos; as Rules
novas recusam escrita antiga. Publicar as Rules primeiro deixaria uma janela
em que o app interno ainda em execução não consegue gravar.

**As cinco juntas:** `authorizeMutation.ts` importa o motor compartilhado.
Publicar uma sozinha recria o descompasso que já bloqueou esta tarefa antes.

**Build por último e sem pressa:** como os dispositivos são internos, a
reinstalação é coordenada, não uma corrida contra a frota.

## Rollback

| Camada | Procedimento | Tempo |
|---|---|---|
| Functions | republicar as cinco a partir de `fonte-publicada.zip` (revisão `00019-jut`) | minutos |
| Rules | reapontar o release para `798fd0d9` | segundos |
| App interno | reinstalar o build anterior | manual |

Para reverter só o piloto, sem deploy: `workoutPilotEnrollment/{uid}` →
`enabled: false`.

## Configuração de produção

| Variável | Situação | Ação |
|---|---|---|
| `NUTRITION_PLAN_SNAPSHOT_ENABLED` | `"true"` nas 5 Functions publicadas desde 19/10 13:05 | **preservar** — kill switch lido só por `mutateNutritionDiaryV1` |
| `NUTRITION_PLAN_SNAPSHOT_PILOT_UIDS` | `""` em 2 Functions antigas | **vestigial** — zero leituras no código integrado |

O `functions/.env` é ignorado pelo Git e não existe nesta máquina. Sem ele o
deploy remove a variável da Function publicada — inerte para
`authorizeWorkoutLifecycleMutation`, que não a lê, mas é uma alteração de
configuração a não causar por acidente.
