# Fase 3 — persistência e cache seguro

## Stack e decisão

- Branch `main`, HEAD inicial `b63b8d0bc36dd3b452abb45d071808673891051e`.
- Expo `~56.0.20`, React Native `0.85.3`, Firebase JS `12.15.0`.
- Auth usa `secureAuthStorage`; Firestore usa `getFirestore(app)` com cache de memória. AsyncStorage `2.2.0` e SecureStore já estão instalados.
- Persistência global Firestore: **C — não suportada** no React Native pelo Firebase JS SDK, apesar dos exports `initializeFirestore`, `persistentLocalCache` e `persistentSingleTabManager` nos typings. A tabela oficial do Firebase marca Cloud Firestore em React Native como suportado **exceto persistence**. `src/lib/firebase.ts` permaneceu intacto.
- Fontes: [Expo SDK 56](https://docs.expo.dev/versions/v56.0.0/), [AsyncStorage no SDK 56](https://docs.expo.dev/versions/v56.0.0/sdk/async-storage/), [ambientes do Firebase JS SDK](https://firebase.google.com/docs/web/environments-js-sdk).

## Profile e questionnaire

Antes: Auth resolve UID, `loadUserState` lê `users/{uid}` e o último questionário em paralelo, com retry. O profile usa transação para migração de esquema. `resolvePremiumGate` espera resolução remota do questionário, preferências, estado de assinatura e prontidão de treino. Edição de perfil faz `updateUserProfile` e `refreshProfile`; onboarding grava e recarrega. Logout zera o reducer; exclusão de conta chama o shutdown local.

Depois: uma projeção versionada por UID em AsyncStorage pode mostrar **nome** e **última meta/dias** durante o carregamento. A leitura local corre em paralelo às leituras Firestore. Resultado remoto substitui a projeção e a grava em disco. Falha/corrupção local equivale a miss. O gate continua a usar apenas `profile` e `questionnaire` remotos. O erro offline mostra a última informação de apresentação e mantém o botão de retry; retornar ao app após abrir ajustes de rede dispara nova leitura. Treino não abre sem as confirmações exigidas.

Campos **não** copiados: email, nascimento, altura, peso, restrições/triagens médicas, foto, role, subscription, entitlement, marcador comercial, QA mode, timestamps de servidor, tokens e qualquer dado de lifecycle. Nenhum campo do cache é aceito em mutações ou decisões de acesso. A projeção no AsyncStorage não é segredo; se o produto passar a considerar meta/dias de treino sensíveis, retirar esses campos ou migrar o armazenamento em uma fase específica.

Formato: `{schemaVersion:1, uid, cachedAt, profile:{name}|null, questionnaire:{goal,days}|null}`. A leitura valida esquema, UID, tipos, enum de meta, intervalo de dias e timestamp. A chave inclui UID. Estado exposto pelo contexto também exige correspondência do UID; geração de leitura impede resposta tardia de outra identidade. Operações de disco por UID são enfileiradas e remoção bloqueia escritas antigas.

| Evento | Cache | Ação |
| --- | --- | --- |
| Primeira instalação | ausente | leitura remota normal |
| Cold start do mesmo UID | válido | apresentação imediata, revalidação remota |
| Resultado remoto mais novo | antigo | substituir memória e disco |
| Edição do nome confirmada | válido | write-through do nome; `refreshProfile` depois |
| Novo questionário confirmado | válido | write-through de meta/dias; `refreshProfile` depois |
| Logout | qualquer | zerar apresentação imediatamente; remover chave do UID |
| Troca de UID | outro usuário | não expor projeção nem estado remoto do UID anterior |
| Exclusão de conta aceita | qualquer | remover chave no shutdown local |
| Cache inválido ou esquema incompatível | inválido | descartar e buscar remoto |
| Erro de rede | válido | mostrar apenas apresentação; gate continua fechado |

## Catálogo e histórico

`EXERCISES_SEED` embute 116 exercícios em aproximadamente 75 KB de fonte e serve a maior parte das telas sem leitura. Há dois caminhos remotos distintos:

- `loadExerciseCatalogForLimitations` lê identidade/hash, todos os 116 documentos e a identidade novamente, com validação de hash. É parte da prescrição e do lifecycle; servir uma cópia stale nessa fronteira mudaria uma decisão crítica. Não foi cacheado.
- `loadExerciseExecutionMedia` busca apenas IDs da sessão para vídeos. Não há `catalogVersion` confiável cobrindo alterações de mídia pelo painel; persistir sem invalidação adequada traria vídeos obsoletos. Não foi cacheado.

O histórico não foi cacheado: o escopo seguro ficou concentrado em profile/questionnaire e a auditoria mostrou que o catálogo remoto participa de prescrição crítica.

## Medição e limites

`EXPO_PUBLIC_PERF_TRACE=1` em DEV registra marcas sem UID ou payload. Cinco cold starts com cache no iPhone 17 Pro Simulator deram medianas: `auth_ready` 1162 ms desde o epoch JS, cache pronto 1238 ms, profile remoto 2565 ms, Home montada 4129 ms, Today pronto 8774 ms, Evolution pronta 9205 ms. `auth → cache` 73 ms; `auth → remoto` 1403 ms; `Home mount → Today` 4623 ms; `Home mount → Evolution` 5066 ms. `home_today_ready` só é marcado após a agenda sair do estado transitório `PROGRAM_NOT_AVAILABLE`. Estes valores provam apresentação antes da rede, **não** ganho de montagem da Home. Não existe série pós-Fase 2 comparável neste checkout para calcular delta ou porcentagem. O epoch é do módulo JS, não do toque no ícone.

O Simulator carregou o bundle atual pela porta 8082 e a Home autenticada abriu. Um Metro independente na porta 8081 pertence a outro worktree. Não foram realizados login novo, edição de dado de conta, troca para segundo UID, desligamento de rede, início/finalização de treino ou medição de primeira instalação em aparelho. Esses cenários permanecem sem validação manual nesta sessão. Testes unitários cobrem miss, hit, corrupção, esquema, UID, stale/remoto mais novo, write-through e remoção. O reducer de identidade existente cobre respostas tardias. `npm test` tem quatro falhas preexistentes fora do escopo (Paywall/theme/subscription); os arquivos responsáveis não foram alterados nesta fase.
