> Registro histórico: o sistema musculoesquelético e as políticas clínicas V3/legacy descritos aqui foram descontinuados. Não são contratos atuais. Ver [remoção definitiva](../removal-physical-limitations/REPORT.md).

# AJ Fit — Etapa 3: relatório de integridade e preservação

## Confirmações diretas (verificadas, não estimadas)

| Afirmação | Verificação |
|---|---|
| Nenhum treino/execução/programa real foi modificado | Nenhuma escrita em Firestore foi realizada nesta etapa ou na etapa anterior auditada (confirmado: nenhum commit/push/deploy; o único processo Firebase executado foi um emulador Firestore local, iniciado e encerrado, sem referência ao projeto `ajfit-2f321`). |
| Nenhum histórico ou carga foi alterado | Nenhum arquivo de `src/services/workoutExecutions.ts`, `src/workoutExecution/`, ou qualquer caminho de persistência de séries/cargas foi tocado além de uma assinatura de função aditiva (`manualSubstitutionCatalogFor(policy)` em vez de uma constante fixa) que, com a flag desativada, resolve para exatamente o mesmo `MANUAL_SUBSTITUTION_CATALOG` de antes. |
| Nenhuma preferência permanente foi apagada | `resolvePermanentSubstitutionsForSession` preserva o comportamento legado byte a byte quando chamada sem `policy` (equivalente a `'legacy'`); testado explicitamente nesta etapa (`does not delete invalid legacy preferences or replace them with another candidate`) e na correção (`applies a valid, editorially-authorized preference` só roda sob `policy:'v3'` explícito). |
| Nenhum exercício incompleto foi ativado | Os 41 rascunhos permanecem com `status:'draft'`, as 3 disponibilidades `false` e as 7 regiões `pending` — confirmado por leitura direta do arquivo e por teste dedicado nesta etapa, que também prova que uma relação do dataset com exceção editorial aceita **continua bloqueada** quando o alvo é um rascunho. |
| A V3 permanece desativada | `ACTIVE_SUBSTITUTION_POLICY` em `src/workoutPrescription/substitutionPolicyV3.ts` está hardcoded como `'legacy'`. Busca exaustiva (`grep -rn "'v3'"`) em `src/`, `functions/src/` e `scripts/` confirma que **nenhum ponto de chamada de produção** passa `policy:'v3'`/`substitutionPolicy:'v3'` — só aparece em arquivos de teste e no script de auditoria `scripts/auditSubstitutionsV3.ts` (uma ferramenta offline, não executada em runtime do produto). |
| O comportamento anterior continua funcional | Suíte completa do app: 44 falhas — **as mesmas 16 arquivos** já documentados como pré-existentes nas Etapas 2/2.1, nenhuma falha nova. Suíte completa do backend: 0 falhas. `npm run typecheck` limpo nos dois workspaces. Teste dedicado (`never activates V3 when substitutionPolicy is omitted`) comprova saída idêntica entre "omitido" e "`'legacy'` explícito" para os 102 templates. |
| `V3_ACTIVATION_BLOCKERS` impede ativação automática | `validateSubstitutionPolicyActivation` sempre retorna pelo menos os 4 bloqueadores fixos (`SESSION_AUTHORIZATION_SNAPSHOTS_NOT_MIGRATED`, `AUTHORITATIVE_CLIENT_CONTEXT_NOT_UNIFIED`, `MIXED_CLIENT_CAPABILITY_HANDSHAKE_NOT_IMPLEMENTED`, `NATIVE_AND_OFFLINE_HOMOLOGATION_PENDING`), mesmo quando dataset/protocolo/catálogo coincidem perfeitamente — testado explicitamente. Nenhuma combinação de dados faz essa função retornar lista vazia. |

## O que foi corrigido nesta etapa (não é uma regressão, é uma correção de pendência identificada na auditoria)

A auditoria anterior identificou que **120 exceções editoriais documentadas** (comentários de célula na planilha V3) não haviam sido importadas pelo script original, fazendo com que ~18 relações aprovadas editorialmente fossem incorretamente tratadas como não-aprovadas pelos validadores genéricos. Isso foi corrigido com um mecanismo de exceção nomeado e auditável (`exceptionAccepted` + `editorialExceptionScopeV3`), nunca com relaxamento global. O efeito observável:

- `isolatedEligible` subiu de 700 para 718 relações (+18, exatamente o número de exceções genuinamente recuperáveis — 120 exceções encontradas, 102 delas já eram elegíveis sem precisar da exceção, 8 permanecem bloqueadas por serem relações para/de um dos 41 rascunhos).
- Nenhum outro número de segurança mudou: equipamento, disponibilidade operacional, perfil de limitação por região e bloqueio de rascunho continuam idênticos.

## Limitações explícitas desta entrega (não estimativas — pendências reais)

- `LIMITATION_PROFILE_MISSING` (50 ocorrências) é uma divergência **pré-existente**, já documentada na auditoria original (`ajfit_substituicoes_auditoria_relatorio.md`, item 2: "Preview manual sem perfis"). Esta etapa não a resolve — resolvê-la está fora do escopo autorizado ("não modificar regras de negócio fora do escopo").
- 203 das 221 ocorrências originalmente rejeitadas permanecem bloqueadas. Isso é o resultado correto e esperado de exigir autorização editorial explícita — não uma falha desta implementação.
- A simulação de cobertura (102/117/321 vs. baseline 102/629/8.932) é um resultado **isolado e local** (sem Firestore, sem emulador, sem app real), executado pelos mesmos pontos de entrada puros (`composeTemplateV127`, `evaluateManualSubstitutionCandidate`) usados em produção, mas sem aprovação visual em iPhone/Android.

## Resultado da suíte (números exatos, não aproximados)

| Workspace | Arquivos | Testes passaram | Testes falharam | Testes ignorados |
|---|---:|---:|---:|---:|
| App (`npx vitest run`) | 632 (594 passaram, 16 falharam, 22 ignorados) | 7.900 | 44 | 228 |
| Functions (`npx vitest run`) | 186 (156 passaram, 30 ignorados) | 2.022 | 0 | 391 |

As 44 falhas do app correspondem exatamente a estes 16 arquivos, todos pré-existentes e documentados antes desta etapa: `src/lib/__tests__/iosRestActivityStructure.test.ts`, `src/lib/__tests__/premiumEntitlementPrecedence.test.ts`, `src/lib/__tests__/workoutLogicIntact.test.ts`, `src/loadProgress/__tests__/loadProgressWiring.test.ts`, `src/scheduleEngine/__tests__/scheduleRefreshState.test.ts`, `src/screens/__tests__/editProfileFixedLayout.test.ts`, `src/screens/__tests__/healthIntegrationScreenStructure.test.ts`, `src/screens/__tests__/migratedScreensLifecycle.test.ts`, `src/screens/__tests__/paywallRedesignStructure.test.ts`, `src/screens/__tests__/premiumCommercialContextFase6.test.ts`, `src/screens/__tests__/restOverlayNextExerciseStructure.test.ts`, `src/state/__tests__/restLiveActivityIntegrationStructure.test.ts`, `src/theme/__tests__/sharedComponentsTheme.test.ts`, `src/workoutPrescription/__tests__/canonicalV127SubstitutionMapUnification.test.ts`, `src/workoutPrescription/__tests__/musculoskeletalFullCoverageV127.test.ts`, `src/workoutPrescription/__tests__/spineHomeClosureV127.test.ts`.

## Restrições obrigatórias — confirmação de cumprimento

- V3 não ativada: confirmado (`ACTIVE_SUBSTITUTION_POLICY = 'legacy'`).
- Nenhuma publicação no Firebase: confirmado (nenhuma escrita remota em nenhum momento desta etapa).
- Nenhum dado real modificado: confirmado.
- Os 41 exercícios não foram ativados: confirmado.
- Nenhum commit ou push: confirmado (`git status` mostra apenas alterações no working tree, nenhum commit criado).
- Nenhum deploy: confirmado.
- Nenhuma regra fora do escopo foi alterada sem justificativa: a única exceção é `scripts/syncPrescriptionEngineToFunctions.cjs`, que ganhou 2 linhas para incluir os novos arquivos V3 na lista já existente de sincronização — mesmo mecanismo usado por todo o resto do motor compartilhado, sem alterar o que já era sincronizado.
