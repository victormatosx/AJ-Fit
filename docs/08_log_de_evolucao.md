# Log de Evolução

## 1. Objetivo deste documento

Registrar a evolução do projeto.

Registrar decisões.

Registrar alterações aprovadas.

Registrar pendências.

Registrar divergências.

Registrar eventos importantes do desenvolvimento.

Este documento é a fonte oficial de histórico do projeto.

---

# 2. Regras gerais

Toda decisão relevante deve ser registrada.

Nenhuma decisão importante deve existir apenas em conversas temporárias.

O log deve refletir a evolução real do projeto.

---

# 3. Quem pode registrar entradas

Podem registrar entradas:

* humano coordenador
* agente PO
* agente arquiteto
* agente backend
* agente frontend
* agente QA
* demais agentes autorizados

---

## Regra obrigatória

Toda entrada deve informar:

* data
* responsável
* categoria
* descrição

---

# 4. Categorias oficiais

## [DECISÃO]

Decisões aprovadas.

---

## [REQUISITO]

Novos requisitos aprovados.

---

## [IMPLEMENTAÇÃO]

Mudanças técnicas relevantes.

---

## [CORREÇÃO]

Correções importantes.

---

## [PENDENTE]

Informações aguardando decisão humana.

---

## [QUESTIONAMENTO]

Possíveis inconsistências identificadas.

---

## [CONFLITO]

Contradições entre documentos.

---

## [BLOQUEIO]

Impossibilidade de execução.

---

## [DESCARTADO]

Ideias avaliadas e rejeitadas.

---

# 5. Estrutura obrigatória das entradas

Modelo:

```txt id="iw7k6j"
Data:
Responsável:
Categoria:

Descrição:

Impacto:

Próxima ação:
```

---

# 6. Registro de decisões

Toda decisão aprovada deve registrar:

* o que foi decidido
* motivo da decisão
* impacto esperado

---

# 7. Registro de requisitos

Todo requisito novo deve registrar:

* requisito
* origem
* documentos impactados

---

# 8. Registro de implementação

Alterações relevantes devem registrar:

* módulo afetado
* alteração realizada
* motivo

---

# 9. Registro de correções

Correções devem registrar:

* problema encontrado
* causa identificada
* solução aplicada

---

# 10. Registro de pendências

Pendências devem registrar:

* informação ausente
* responsável esperado
* impacto da ausência da decisão

---

# 11. Registro de conflitos

Conflitos devem registrar:

* documentos envolvidos
* descrição da contradição
* necessidade de validação humana

---

# 12. Registro de bloqueios

Bloqueios devem registrar:

* causa
* impacto
* condição necessária para desbloqueio

---

# 13. Registro de itens descartados

Toda ideia descartada deve registrar:

* proposta original
* motivo do descarte

---

# 14. Ordem das entradas

As entradas devem ser registradas em ordem cronológica.

A entrada mais recente deve permanecer no topo do arquivo.

---

# 15. Restrições

Não registrar:

* discussões irrelevantes
* opiniões sem impacto
* alterações temporárias
* informações duplicadas

---

# 16. Leitura obrigatória

Todos os agentes devem consultar este documento antes de iniciar uma tarefa.

A leitura deve focar nas entradas relevantes para a atividade atual.

---

# 17. Exemplo de entrada

```txt id="ht4v7m"
Data: 2026-05-29
Responsável: Humano Coordenador
Categoria: [DECISÃO]

Descrição:
Definido uso do RevenueCat para gerenciamento de assinaturas.

Impacto:
Integração obrigatória com App Store e Google Play.

Próxima ação:
Criar documentação específica de billing.
```

---

# 18. Primeiras entradas do projeto

Data: 2026-07-11
Responsável: Agente Segurança + Agente Arquiteto + Agente Frontend + Agente QA
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Auditoria completa de encerramento da persistência de login (arquitetura,
segurança, limpeza de código, performance, memory leaks, fluxo de
autenticação, conformidade com 12_seguranca_geral_do_app.md). Ver relatório
completo entregue ao humano coordenador na mesma data.

Ações concretas desta entrada:
- Removidos todos os logs de depuração temporários (`[BOOT]`, `[AUTH]`,
  `[ROUTER]`) de `App.tsx`, `src/state/AuthContext.tsx` e
  `src/screens/SplashScreen.tsx`, junto dos comentários "TEMPORARY
  DIAGNOSTIC" associados.
- Mantida a correção comportamental encontrada na entrada anterior
  (2026-07-11, splash animation sem cleanup): `sequence.stop()` no cleanup do
  `useEffect` de `SplashScreen.tsx`, e a guarda `screenRef.current ===
  'splash'` em `App.tsx` antes de aplicar o `onDone` do splash.
- Nenhuma mudança na criptografia, no `secureAuthStorage.ts` ou no
  `firebase.ts` — auditoria de segurança não encontrou desvio de boas
  práticas que justificasse alteração (AES-256-GCM, IV aleatório por
  operação, chave em Keychain/Keystore via expo-secure-store, limpeza no
  logout já cobertos pela implementação de 2026-07-09).

Impacto:
Código de produção sem logs de depuração. Nenhuma dívida técnica nova
identificada nesta auditoria além das já registradas (offline-first do
Firestore, pendente desde 2026-07-04).

Próxima ação:
Nenhuma ação de código pendente. Validação manual do humano coordenador
(cold start Android/iOS, e-mail/senha e Google) permanece recomendada antes
de publicação.

---

Data: 2026-07-11
Responsável: Agente Frontend
Categoria: [CORREÇÃO]

Descrição:
Correção da auditoria anterior (2026-07-09, entrada abaixo): a conclusão de
que a persistência do Firebase era a causa raiz estava incompleta. A
persistência de fato funciona (confirmado por log real: sessão restaurada,
decriptada, `onAuthStateChanged` com uid correto). O defeito real estava no
roteamento inicial em `App.tsx`.

Causa raiz:
`SplashScreen` (`src/screens/SplashScreen.tsx`) inicia uma animação de
1.8s (`Animated.sequence`, `useNativeDriver: true`) que chama `onDone` ao
terminar, mas o `useEffect` que a inicia não tinha função de limpeza — a
animação nativa continuava rodando mesmo após o componente desmontar. Em
cold start autenticado: `RootNavigator` (`App.tsx`) renderiza `SplashScreen`
assim que `initializing` vira `false` (tela ainda é `'splash'`, valor
inicial); no mesmo ciclo de efeitos, o bootstrap de `App.tsx` (linha ~62,
versão anterior) já troca a tela para `'app'` porque o usuário existe,
desmontando o `SplashScreen`. Sem cleanup, a animação iniciada nesse
`SplashScreen` já desmontado continua e, ~1.8s depois, chama o `onDone`
antigo (`() => setScreen('onboarding')`), sobrescrevendo `'app'` por
`'onboarding'` — o usuário via a Home por um instante e depois "voltava"
para o onboarding público, mesmo autenticado.

Solução aplicada:
- `src/screens/SplashScreen.tsx`: a sequência de animação agora é capturada
  em variável; o `useEffect` retorna um cleanup que chama `.stop()`,
  impedindo que `onDone` dispare após o unmount.
- `App.tsx`: reforço defensivo no roteador — o `onDone` do `SplashScreen`
  agora consulta uma `ref` (`screenRef`) com a tela atual e ignora a
  transição para `'onboarding'` se a tela já não for mais `'splash'` (guarda
  contra qualquer race futura do mesmo tipo, sem uso de timeout artificial).
- Logs temporários `[BOOT]`/`[AUTH]`/`[ROUTER]` com timestamp adicionados em
  `App.tsx`, `AuthContext.tsx` e `SplashScreen.tsx` para validação manual.
  Mantidos até validação humana (não remover nesta entrada).

Impacto:
Nenhuma mudança na criptografia/persistência (fora de escopo desta correção,
confirmada funcional na entrada anterior). Usuário autenticado em cold start
não deve mais "saltar" de volta para o onboarding público.

Testes feitos:
- `npx tsc --noEmit` sem erros.
- Aguardando validação manual do humano coordenador: fechar o app
  completamente, reabrir, e confirmar que a Home permanece estável (sem
  voltar para onboarding) mesmo após os ~1.8s da janela de risco.

Próxima ação:
Humano coordenador validar manualmente em dispositivo (Android e iOS) e
confirmar remoção dos logs temporários.

---

Data: 2026-07-09
Responsável: Agente Segurança
Categoria: [CORREÇÃO]

Descrição:
Auditoria da persistência de login (relato: usuário deslogava ao fechar e
reabrir o app, tanto por e-mail/senha quanto por Google).

Problema encontrado:
A implementação de persistência criptografada registrada na entrada abaixo
(2026-07-09, "Persistência de login criptografada em repouso") havia sido
adicionada ao `package.json`/`app.json` (`expo-secure-store`) sem que os
projetos nativos `android/`/`ios/` (gerados localmente, fora do controle de
versão) fossem reconstruídos. O dev client instalado no dispositivo não
possuía o módulo nativo `expo-secure-store` compilado. Toda vez que
`initializeAuth` tentava usar a persistência criptografada, a checagem
interna `_isAvailable()` do Firebase Auth (que grava/lê um valor de teste via
`secureAuthStorage`) falhava silenciosamente, e o Firebase caía para
persistência em memória sem lançar nenhum erro visível — a sessão nunca
sobrevivia ao fechamento completo do app. Isso não é um bug de lógica: o
código de `src/lib/secureAuthStorage.ts` e `src/lib/firebase.ts` está correto
(API do `expo-crypto` AES e do `expo-secure-store` conferida contra o código
nativo instalado).

Causa raiz:
Build nativo desatualizado — dependência nova adicionada sem `expo prebuild`/
rebuild do dev client.

Diagnóstico:
Instrumentação temporária (logs `[authDiag]`) foi adicionada em
`secureAuthStorage.ts`, `firebase.ts` e `AuthContext.tsx`, além de um módulo
de auto-teste isolado (`authPersistenceDiagnostics.ts`, removido após a
confirmação) que exercitava SecureStore, o roundtrip AES e o contrato
`_isAvailable()`/`_set`/`_get` do Firebase de forma independente. Após rodar
`npx expo run:android` (reconstrução completa do dev client), dois cold
starts reais (fechar totalmente o app e reabrir) mostraram a sessão sendo
lida do `AsyncStorage`, decriptada com sucesso e `onAuthStateChanged`
disparando com o `uid` correto — sem nenhum erro na cadeia.

Solução aplicada:
Nenhuma alteração de código foi necessária. A instrumentação temporária foi
revertida (código voltou ao estado da entrada de implementação anterior).
Rollback da camada de criptografia foi avaliado e descartado — não há
evidência de defeito nela.

Impacto:
Nenhuma pendência de código aberta. Este documento agora registra
explicitamente que **qualquer nova dependência nativa (SDK Expo) exige rebuild
do dev client (`npx expo run:android` / `npx expo run:ios`, ou novo build
EAS) antes de validar em dispositivo** — `android/`/`ios/` são gerados e não
acompanham automaticamente mudanças em `package.json`/`app.json`.

Testes feitos:
- `npx tsc --noEmit` sem erros após reverter a instrumentação.
- Cold start real (app fechado via app switcher e reaberto) validado 2x após
  `npx expo run:android`, com sessão de e-mail/senha persistindo.
- Logout (`signOutUser`) não foi alterado nesta entrada; segue limpando a
  sessão via `clearSecureAuthSession` (ver entrada anterior).

Próxima ação:
Humano coordenador validar também o cold start com login Google (mesma
camada de persistência, risco residual baixo) e num build iOS.

---

Data: 2026-07-04
Responsável: Agente Backend + Agente Frontend
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Autenticação social (Google e Apple) para produção (dev/EAS build).
- Firebase JS SDK mantido; login social via `signInWithCredential` (Google:
  @react-native-google-signin/google-signin; Apple: expo-apple-authentication
  + nonce SHA-256 com expo-crypto).
- Camada centralizada e agnóstica de provedor: `src/services/socialAuth.ts` +
  `src/services/providers/{google,apple}.{native,web}.ts` (split de plataforma;
  web fica sem imports nativos). Telas chamam `signInWithProvider(provider)`,
  sem ifs por provedor.
- Primeiro login social provisiona `users/{uid}` (e questionário só se houver
  respostas reais). Reuso de `ensureUserProvisioned` (checa existência —
  nunca duplica/sobrescreve). Listener continua somente-leitura.
- Account Linking: `auth/account-exists-with-different-credential` →
  `fetchSignInMethodsForEmail` → reautenticação + `linkWithCredential`
  (mesmo UID, dados preservados). Cobre Email↔Google↔Apple.
- AuthContext expõe `linkedProviders`; ProfileScreen lista métodos vinculados.
- app.json: plugins google-signin (iosUrlScheme) + expo-apple-authentication,
  `ios.usesAppleSignIn`, `googleServicesFile` (iOS/Android), client IDs em
  `extra`.

Impacto:
Login Google/Apple funcional em build nativa, sem duplicação de usuários.
Nenhum `addDoc` em `users`. Web permanece compilável (stubs de plataforma).

Próxima ação:
Ver [PENDENTE] de configuração de console/credenciais abaixo.

---

Data: 2026-07-04
Responsável: Agente Arquiteto
Categoria: [DECISÃO]

Descrição:
Mantido o Firebase JS SDK (sem migrar para @react-native-firebase). Login social
usa credenciais nativas + `signInWithCredential`, padrão suportado do JS SDK em
React Native. Arquivos de plataforma (.native/.web) evitam imports nativos no
bundle web; tipos resolvidos por `.d.ts` (Metro resolve o arquivo de plataforma).

Impacto:
Menor disrupção. A pendência de offline-first do Firestore em RN permanece
independente desta decisão.

Próxima ação:
Nenhuma imediata.

---

Data: 2026-07-04
Responsável: Agente Backend
Categoria: [PENDENTE]

Descrição:
Configuração externa necessária (não código) para o login social funcionar:
- Firebase Console → habilitar provedores Google e Apple; manter "uma conta por
  e-mail"; avaliar proteção de enumeração de e-mail (afeta
  `fetchSignInMethodsForEmail` usado no account linking).
- Apple Developer: Sign In with Apple, Service ID; credenciais no EAS.
- Build: requer dev/EAS build (não Expo Go) para validar em dispositivo.

Impacto:
Sem essa configuração o fluxo social não completa em runtime. Verificação em
dispositivo real fica pendente.

Próxima ação:
Humano coordenador configurar console/credenciais e rodar em dev build.

---

Data: 2026-07-04
Responsável: Agente Backend + Agente Frontend
Categoria: [CORREÇÃO]

Descrição:
Corrigida condição de corrida na criação do documento do usuário.
Problema: a criação era feita dentro do listener `onAuthStateChanged` via
`ensureUserProfile` (padrão check-then-act não atômico: getDoc → setDoc). O
listener dispara múltiplas vezes no cadastro (criação da conta + updateProfile
do displayName), executando a criação mais de uma vez. Com o documento chaveado
por uid (setDoc) isso gerava escrita redundante; com id gerado (subcoleção)
geraria documentos duplicados.
Causa: creation dentro de fluxo reativo disparado N vezes, sem atomicidade.
Solução: a criação passou a ser um fluxo único em `signUp` (writeBatch atômico:
documento principal + questionário inicial), executado exatamente uma vez. O
listener tornou-se somente-leitura (carrega perfil + questionário no estado
global), com guarda de sequência para descartar leituras obsoletas. Nenhum uso
de `addDoc` na coleção `users` (sempre `doc(db,'users',uid)` + `setDoc`).

Impacto:
Elimina definitivamente a duplicação. `ensureUserProfile`/`createUserProfile`
removidos; `provisionNewUser` é a única função de criação.

Próxima ação:
Publicar `firestore.rules` atualizadas e validar em ambiente real.

---

Data: 2026-07-04
Responsável: Agente Arquiteto
Categoria: [DECISÃO]

Descrição:
Modelagem do questionário movida para subcoleção
`users/{userId}/questionnaires/{questionnaireId}` com campos `answers`,
`version` (>=1), `createdAt` (serverTimestamp). O documento principal do usuário
deixa de conter `questionnaire`. Resolve o [PENDENTE] anterior sobre histórico
de questionários: cada reavaliação cria um novo documento imutável; o atual é o
de `createdAt` mais recente. Documentado em 03_modelagem §12 e 04_contratos §5.

Impacto:
Histórico de questionários passa a ser preservado. Regras Firestore incluem a
subcoleção (leitura/criação só do próprio dono; documentos imutáveis).
AuthContext passa a expor `profile` e `questionnaire` (mais recente).

Próxima ação:
Ao implementar reavaliações (novo treino a cada 30/60 dias), usar
`addQuestionnaire` com `version` incremental.

---

Data: 2026-07-04
Responsável: Humano Coordenador
Categoria: [DESCARTADO]

Descrição:
Descartada a modelagem anterior com `users/{userId}.questionnaire` como campo
único no documento principal (snapshot mutável). Substituída pela subcoleção
`questionnaires`. A nota de "Escopo do campo questionnaire" em 04 §5 foi
substituída pela seção "Subcoleção de questionários".

Impacto:
O campo `questionnaire` no documento principal não deve mais ser usado.

Próxima ação:
Nenhuma — modelagem consolidada na subcoleção.

---

Data: 2026-07-04
Responsável: Humano Coordenador
Categoria: [DECISÃO]

Descrição:
Definido o escopo do campo `users/{userId}.questionnaire`: ele representa
apenas o questionário inicial/atual usado na criação da conta (snapshot único e
mutável, atualizado junto com `updatedAt`). NÃO é histórico definitivo de todos
os questionários do usuário. Documentado em 04_contratos_de_api.md §5 ("Escopo
do campo questionnaire").

Impacto:
Nenhum agente deve tratar o campo atual como fonte de histórico. Reavaliações ou
novo questionário sobrescrevem o valor anterior. Sem impacto em código agora.

Próxima ação:
Ver pendência técnica abaixo ([PENDENTE]) sobre a modelagem de histórico.

---

Data: 2026-07-04
Responsável: Agente Arquiteto
Categoria: [PENDENTE]

Descrição:
Falta modelagem de histórico de questionários. Quando o app implementar
evolução contínua, reavaliações periódicas ou novos questionários com
necessidade de histórico, será preciso criar uma modelagem própria, provável:

```txt
users/{userId}/questionnaires/{questionnaireId}
```

Nesse caso, `users/{userId}.questionnaire` passaria a referenciar apenas o
questionário ativo (ex.: por id), com o histórico na subcoleção.

Impacto:
Enquanto não existir, o sistema mantém apenas o último questionário. Histórico
de evolução do perfil (respostas anteriores) não é recuperável.

Próxima ação:
Definir a subcoleção e a estratégia de migração antes de habilitar reavaliações
— responsável: Agente Arquiteto + Humano Coordenador.

---

Data: 2026-07-04
Responsável: Humano Coordenador
Categoria: [DECISÃO]

Descrição:
Aprovada a expansão do contrato do usuário (04_contratos_de_api.md §5),
resolvendo o [CONFLITO] registrado anteriormente nesta data. O documento
`users/{userId}` passa a incluir campos client-owned adicionais:
`role` (default "user"), `name`, `questionnaire` (respostas do questionário
inicial) e `updatedAt`. Os campos de assinatura/treino permanecem backend-owned.

Impacto:
- O app grava `userId, role, name, email, questionnaire, createdAt, updatedAt`.
- `role` restrito a "user" pelo cliente (regras Firestore); promoção só no
  backend.
- `name` e `questionnaire` tornam-se editáveis pelo próprio usuário.
- Cadastro passa a coletar o nome; questionário é persistido no documento.
- Regras Firestore e repositório `userProfile.ts` atualizados.

Próxima ação:
Revisar/publicar `firestore.rules`. Unificar o enum de status de assinatura
(04 §11 `GRACE_PERIOD` vs 13 §22) permanece pendente.

---

Data: 2026-07-04
Responsável: Agente Backend + Agente Frontend
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Integração inicial Firebase Authentication + Firestore para o fluxo de usuário.
- Auth por e-mail/senha (cadastro, login, recuperação de senha, logout).
- Repositório `src/services/userProfile.ts` (createUserProfile, getUserProfile,
  ensureUserProfile, updateUserProfile) como única camada de acesso a
  `users/{userId}`.
- Estado global de autenticação + perfil em `src/state/AuthContext.tsx`.
- Perfil (ProfileScreen) passa a exibir dados reais (e-mail, ano de criação,
  status de assinatura quando existir).
- Proteção de rotas: telas privadas exigem usuário autenticado.
- `firestore.rules` sugerido (acesso apenas ao próprio documento; campos
  backend-owned protegidos).

Impacto:
Cadastro cria o documento mínimo do usuário. Login carrega o perfil. Módulos
seguintes (treino, assinatura) podem consumir `activeWorkoutId` e
`subscriptionStatus` quando o backend os popular.

Próxima ação:
Validação humana das regras Firestore e das divergências abaixo.

---

Data: 2026-07-04
Responsável: Agente Backend
Categoria: [DECISÃO]

Descrição:
O documento `users/{userId}` segue o contrato oficial (04_contratos_de_api.md
§5). O aplicativo grava apenas os campos client-owned: `userId`, `email`,
`createdAt` (serverTimestamp). Os campos `subscriptionStatus`,
`subscriptionProvider`, `trialEndsAt`, `subscriptionEndsAt` e `activeWorkoutId`
são backend-owned e nunca escritos pelo cliente (RevenueCat/Cloud Functions são
a fonte de verdade — 12_seguranca §3–§11).

Impacto:
Front não define status de assinatura nem treino ativo. Regras Firestore
bloqueiam escrita desses campos pelo cliente.

Próxima ação:
Implementar Cloud Function `syncSubscriptionStatus` e webhook RevenueCat para
popular os campos de assinatura.

---

Data: 2026-07-04
Responsável: Agente Arquiteto
Categoria: [CONFLITO]

Descrição:
Divergências entre a tarefa solicitada e a documentação oficial no schema do
usuário. Não foram inventados campos fora do contrato (00_orientacao §3.2):
- `displayName`/`name`, `role`, `updatedAt`, `onboardingCompleted`,
  `questionnaireCompleted`, `couponCode`: pedidos na tarefa, ausentes no
  contrato 04 §5. Não persistidos até decisão humana.
- Nome do campo de identificação: contrato usa `userId` (adotado); a tarefa
  sugeria `uid`.
- Status de assinatura: 04 §11 lista `GRACE_PERIOD`; 13 §22 lista
  `BILLING_ISSUE`/`CANCELED`. Adotado o conjunto de 13 §22 no tipo do cliente
  (não escrito pelo front). Requer unificação documental.

Impacto:
Modelo do usuário permanece aderente ao contrato. Campos adicionais dependem de
atualização do contrato antes de serem gravados.

Próxima ação:
Humano coordenador decide se o contrato 04 §5 será expandido (nome, role,
flags de onboarding, cupom) e unifica o enum de status.

---

Data: 2026-07-04
Responsável: Agente Frontend
Categoria: [PENDENTE]

Descrição:
Offline-first (02 §3.5) para Firestore não é atendido de forma durável pelo
Firebase JS SDK em React Native (persistência baseada em IndexedDB). A
integração atual usa cache em memória por sessão.

Impacto:
Leituras/escritas offline não persistem entre reinícios do app com o SDK atual.

Próxima ação:
Decidir arquitetura offline (ex.: @react-native-firebase nativo) — responsável:
Agente Arquiteto + Humano Coordenador.

---

Data: 2026-07-04
Responsável: Agente Frontend
Categoria: [PENDENTE]

Descrição:
Captura de cupom promocional no cadastro (03 §15, 13 §19) não implementada por
ausência de campo no formulário atual e de definição do campo no contrato 04 §5.

Impacto:
Origem do usuário/comissão não é rastreada no cadastro atual.

Próxima ação:
Definir UI do cupom e o campo correspondente no contrato — responsável: Agente
PO + Humano Coordenador.

---

Data: 2026-05-29
Responsável: Humano Coordenador
Categoria: [DECISÃO]

Descrição:
Definido uso de Firebase como plataforma principal de backend.

Impacto:
Uso de Firestore, Authentication, Storage e Cloud Functions.

Próxima ação:
Definir modelagem detalhada dos dados.

---

Data: 2026-05-29
Responsável: Humano Coordenador
Categoria: [DECISÃO]

Descrição:
Definido uso do RevenueCat para gerenciamento de assinaturas.

Impacto:
Assinaturas passam a utilizar App Store, Google Play e RevenueCat como fonte oficial de verdade.

Próxima ação:
Criar documentação específica de billing.

---

Data: 2026-05-29
Responsável: Humano Coordenador
Categoria: [DECISÃO]

Descrição:
Definido que os treinos serão pré-definidos e selecionados através do questionário.

Impacto:
O sistema não gera treinos livres na versão inicial.

Próxima ação:
Definir lógica de seleção de treinos.

---

Data: 2026-05-29
Responsável: Humano Coordenador
Categoria: [DECISÃO]

Descrição:
Definido funcionamento offline como requisito obrigatório.

Impacto:
Todas as decisões de arquitetura devem considerar sincronização posterior.

Próxima ação:
Definir estratégia de sincronização.

---

Data: 2026-07-09
Responsável: Agente Segurança + Agente Frontend
Categoria: [IMPLEMENTAÇÃO]

Descrição:
Persistência de login criptografada em repouso (12 §16.1).
- `src/lib/secureAuthStorage.ts` (novo): backend compatível com
  `AsyncStorage` para `getReactNativePersistence` do Firebase JS SDK. Cada
  valor é cifrado com AES-256-GCM (`expo-crypto`, `AESEncryptionKey` /
  `aesEncryptAsync` / `aesDecryptAsync`) antes de gravar no `AsyncStorage`;
  falha de descriptografia (chave corrompida/ausente) descarta o item em vez
  de derrubar o app.
- A chave de criptografia é gerada uma vez por dispositivo e armazenada só
  no Keychain/Keystore via `expo-secure-store` (nova dependência, plugin
  registrado em `app.json`), nunca no `AsyncStorage`.
- `src/lib/firebase.ts`: `initializeAuth` passa a usar `secureAuthStorage` no
  lugar do `AsyncStorage` puro.
- `src/services/auth.ts`: `signOutUser` chama `clearSecureAuthSession` após
  `signOut`, descartando a chave de criptografia no logout (defesa em
  profundidade além da limpeza própria do Firebase).
- `docs/12_seguranca_geral_do_app.md`: adicionada seção 16.1 documentando a
  decisão (Firebase JS SDK mantido — sem Keychain nativo — logo a
  criptografia é aplicada na camada de storage).

Motivo:
12 §16 exige mecanismo seguro de armazenamento local; o `AsyncStorage` puro
usado antes é texto plano, expondo tokens de sessão em caso de acesso ao
dispositivo. Migrar para `@react-native-firebase/auth` (Keychain/Keystore
nativo) foi avaliado e descartado por ora (maior escopo/risco de regressão
no login social) — decisão validada com o humano coordenador.

Impacto:
Nenhuma mudança de comportamento para o usuário (login continua persistindo
entre reinícios). Requer novo build nativo/dev client (plugin
`expo-secure-store` adicionado ao `app.json`), mesmo fluxo já necessário por
`expo-apple-authentication`.

Próxima ação:
Humano coordenador validar em dev build. Nenhuma pendência de código aberta.

```
```
