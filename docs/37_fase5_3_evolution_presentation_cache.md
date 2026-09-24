# Fase 5.3 — Cache visual seguro da Evolution

## A. Estado inicial

- Árvore canônica: `/Users/lucaslima/AJ-Fit`.
- Branch: `perf-consolidation`.
- HEAD inicial: `ef49387`.
- Alteração preexistente preservada e excluída do trabalho: `firestore-debug.log`.
- A documentação versionada do Expo 56 foi consultada antes da implementação.
- Antes da mudança, a Home montava a área da Evolution vazia/loading e só ocupava o layout quando o `SUMMARY_READY` atual chegava.

Baseline real, iPhone 17 Pro Simulator (iOS 26.5), development build, cinco encerramentos e relançamentos do processo:

- `home_mount → evolution_first_useful_content`: 4.076, 7.758, 3.664, 12.315 e 4.563 ms; mediana 4.563 ms, mínimo 3.664 ms, máximo 12.315 ms.
- `home_mount → evolution_authoritative_ready`: 4.595, 9.079, 4.417, 12.774 e 5.246 ms; mediana 5.246 ms, mínimo 4.417 ms, máximo 12.774 ms.
- A entrada tardia do bloco foi confirmada visualmente.

## B. Arquitetura do cache

Foi criado `EvolutionSummaryPresentationCache`, uma projeção local de apresentação independente do domínio. A leitura ocorre em um effect separado do reconcile remoto; nenhuma leitura de AsyncStorage é aguardada antes de iniciar ou continuar o trabalho autoritativo.

O cache alimenta o caminho visual existente `SUMMARY_READY`, identificado por `source: 'CACHE'`. O summary atual da sessão usa o mesmo ViewModel com `source: 'CURRENT_SESSION'`. Não foi criado um segundo ViewModel nem uma segunda regra de evolução.

Durante refresh, qualquer ViewModel anteriormente acionável é reduzido temporariamente ao mesmo `SUMMARY_READY` sem ações. O card continua ocupando o layout, mas ações antigas não sobrevivem ao início do refresh.

## C. Schema

Schema persistido, versão 1:

```ts
{
  schemaVersion: 1;
  uid: string;
  programInstanceId: string;
  updatedAt: number;
  summary: {
    activeLevel: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
    cycleNumber: number;
    proximity: 'BUILDING' | 'ON_TRACK' | 'READY' | null;
    activeDays: number | null;
    sessionsCompleted: number | null;
    adherenceQuality: 'BELOW_TARGET' | 'GOOD' | 'HIGH' | null;
  };
}
```

A validação é estrita, inclusive para chaves extras. JSON inválido, versão desconhecida, timestamp inválido, UID divergente, `programInstanceId` divergente ou campos inválidos são ignorados. Não há TTL: `updatedAt` existe para diagnóstico e o snapshot representa o último resultado autoritativo conhecido.

## D. UID isolation

A chave física é `ajfit:evolution-summary-presentation:v1:<uid>` e o UID também é validado dentro do payload. Writes são serializados por UID e um UID bloqueado pelo logout não pode ser ressuscitado por write assíncrono tardio.

No logout, o cache do UID de saída é removido em paralelo ao `profilePresentationCache`, depois que o estado de usuário em memória já foi limpo. A exclusão de conta também remove o cache. A política escolhida é, portanto, limpeza no logout: B nunca lê A e um novo login de A começa com miss até uma nova confirmação autoritativa.

## E. Program identity

A identidade escolhida é `programInstanceId`, proveniente do snapshot de programa ativo que já chega ao `AppShell` antes do reconcile completo da Evolution. Ela prova a instância ativa, ao contrário de nível, template ou versão isolados.

O hook só tenta ler quando essa identidade é conhecida. O payload precisa conter exatamente o mesmo `programInstanceId`. Em mismatch, o registro antigo de um único slot por UID é ignorado e removido. A identidade do summary pintado também é guardada em memória; ao mudar a instância, o ViewModel antigo deixa de ser retornado imediatamente, e gerações assíncronas antigas não podem efetuar commit visível.

## F. Campos persistidos

- nível ativo;
- número do ciclo;
- proximidade semântica;
- dias ativos;
- sessões concluídas;
- qualidade de adesão;
- UID, `programInstanceId`, `schemaVersion` e `updatedAt`.

Esses campos são a projeção visual comum aos estados terminais, derivada somente depois da confirmação autoritativa.

## G. Campos explicitamente NÃO persistidos

- `earnedLevel`;
- pending, qualidade/decisão de promoção e contadores de defer;
- action kind, `canDefer`, CTA ou estado de ação;
- activation/adaptation state;
- lifecycle raw, origem/histórico do lifecycle ou `isHistoryComplete`;
- progression decision e metadados de autoridade;
- erro;
- documentos Firestore ou ViewModel completo.

Enquanto cacheado, `earnedLevel` é deliberadamente `null`; nenhuma alegação de promoção aparece antes do summary atual.

## H. Fluxo cold start

1. A autenticação resolve o UID.
2. O bootstrap entrega o `programInstanceId` ativo.
3. A leitura local e o reconcile remoto seguem independentemente.
4. Em hit válido, o cache vira `SUMMARY_READY/CACHE` e ocupa o layout.
5. O card permanece até o summary atual ou até um erro final; não há retorno intermediário para loading.
6. A chegada do summary atual troca os valores no mesmo espaço.
7. Apenas o terminal autoritativo pode liberar o wrapper/CTA correspondente.

## I. Fluxo authoritative update

O único ponto de write-through fica depois do commit do ViewModel terminal e de `evolution_authoritative_ready`. Ele extrai somente o summary mínimo do resultado autoritativo e persiste de forma assíncrona. Cache nunca escreve cache e `SUMMARY_READY` provisório nunca é persistido.

O primeiro relançamento sem cache confirmou o fluxo: miss 75 ms após `home_mount`, summary atual em 3.752 ms, authoritative ready em 3.991 ms; o relançamento seguinte foi hit e exibiu o valor gravado.

## J. Offline/error

Com cache válido, uma falha remota preserva o summary e adiciona `noticeUnavailable`; a faixa mostra indisponibilidade, não estado pronto. Nenhuma CTA é exposta. `evolution_authoritative_ready` e `home_evolution_ready` não são emitidos para `ERROR`/offline.

Sem cache, permanece o comportamento remoto normal de erro. O retorno da rede continua usando o reconcile canônico.

## K. Pós-treino

Ao iniciar `refreshProjection`, o summary anterior permanece no mesmo espaço, mas qualquer `EVOLUTION_READY`, `EVOLUTION_DEFERRED` ou `AUTO_ACTIVATION_NOTICE` anterior vira `SUMMARY_READY/CURRENT_SESSION`, removendo imediatamente ações obsoletas. O novo summary substitui o anterior e o cache só é atualizado no terminal autoritativo.

## L. Program change

Ativação, adaptação, geração/regeneração e evolução automática convergem na troca do `programInstanceId` ativo. A mudança invalida imediatamente o summary pintado, cancela commits tardios da geração anterior e faz o registro antigo falhar na validação de identidade. O summary de A não pode ser apresentado como B.

## M. Multiusuário

A chave, o conteúdo, a fila de writes, o bloqueio de logout e os guards assíncronos são todos isolados por UID. A política de limpeza elimina o cache de A no logout. Assim, B não vê A nem por um frame; ao voltar, A só terá cache depois de uma nova confirmação remota.

## N. Performance

Cinco cold starts com cache quente:

- `home_mount → evolution_cached_summary_visible`: 136, 92, 81, 74 e 76 ms; mediana 81 ms, mínimo 74 ms, máximo 136 ms.
- `home_mount → evolution_current_summary_visible`: 10.502, 4.423, 4.509, 3.929 e 3.833 ms; mediana 4.423 ms, mínimo 3.833 ms, máximo 10.502 ms.
- `home_mount → evolution_authoritative_ready`: 10.761, 4.843, 4.753, 4.345 e 4.318 ms; mediana 4.753 ms, mínimo 4.318 ms, máximo 10.761 ms.

| Métrica | Antes | Depois | Diferença | % |
|---|---:|---:|---:|---:|
| `home_mount → first useful content` | 4.563 ms (3.664–12.315) | 81 ms (74–136) | −4.482 ms | −98,2% |
| `home_mount → cached summary visible` | não existia | 81 ms (74–136) | — | — |
| `home_mount → current summary visible` | 4.563 ms (3.664–12.315) | 4.423 ms (3.833–10.502) | −140 ms | −3,1% |
| `home_mount → authoritative ready` | 5.246 ms (4.417–12.774) | 4.753 ms (4.318–10.761) | −493 ms | −9,4% |

Os tempos autoritativos variam com a rede e não são o ganho reivindicado. O ganho material é o conteúdo visual em mediana de 81 ms, mantendo o reconcile intacto. A captura durante o refresh confirmou o layout ocupado pelo summary, sem CTA de Evolution.

Marks DEV+PERF adicionadas, sem renomear as existentes: `evolution_cache_read_start`, `evolution_cache_hit`, `evolution_cache_miss`, `evolution_cached_summary_visible` e `evolution_current_summary_visible`. `evolution_authoritative_ready` permanece reservado à resolução autoritativa bem-sucedida.

## O. Cache miss/corruption

Cache ausente segue o fluxo remoto normal e grava após o terminal autoritativo. JSON inválido, schema desconhecido, campos extras/ausentes, UID incorreto e `programInstanceId` incorreto são ignorados sem crash; snapshots inválidos/obsoletos são removidos somente se o valor não mudou durante a validação.

## P. Testes

Cobertura adicionada para schema válido/inválido, miss, UID e ProgramInstance, write-through, CTA ausente, erro remoto com cache, refresh pós-treino, mudança de programa, resposta assíncrona tardia, corrida de logout, fila de writes e novo login do mesmo UID.

Validação final registrada na entrega:

- `npx tsc --noEmit`: passou;
- ESLint dos arquivos tocados: 0 erros; 1 warning preexistente em `AuthContext.tsx` (`authRevision` em dependencies);
- cache/Evolution focado: 87/87 passaram; contratos de UX/integração após o guard adicional: 30/30 passaram;
- testes de i18n: 670/670 passaram;
- teste isolado de `recentAuth`, que havia oscilado na primeira execução por uma fronteira de relógio: 8/8 passaram;
- `npm test` completo: 5.649 passaram, 187 skipped e somente as quatro falhas preexistentes conhecidas permaneceram (entitlement precedence, paywall structure, premium commercial context e shared-components theme).

## Q. Segurança

1. O cache participa de alguma decisão de lifecycle? **NÃO.**
2. O cache participa de progression? **NÃO.**
3. O cache pode liberar CTA? **NÃO.**
4. O cache pode ativar evolução? **NÃO.**
5. O cache pode cruzar UID? **NÃO.**
6. O cache pode cruzar ProgramInstance? **NÃO.**
7. O cache pode sobreviver a mudança de programa de forma visível? **NÃO.**
8. Offline pode parecer authoritative ready? **NÃO.**
9. O cache é escrito antes de confirmação remota? **NÃO.**

Além da ausência de CTA em `SUMMARY_READY`, `start` e `defer` verificam novamente o estado autoritativo no controller antes de chamar qualquer operação de lifecycle.

## R. Git

- Commit local: registrado na entrega.
- `firestore-debug.log`: preservado fora do commit.
- Push: não realizado.
- Deploy: não realizado.

## S. Decisão

- **EVOLUTION PRESENTATION CACHE VALIDADO: SIM**
- **GANHO PERCEBIDO MATERIAL: SIM**
- **AUTORIDADE PRESERVADA: SIM**
- **MANTER CACHE: SIM**
- **PLANO DE PERFORMANCE/UX DA HOME PODE SER ENCERRADO: SIM**
