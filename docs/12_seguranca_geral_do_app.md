# Segurança Geral do App

## 1. Objetivo deste documento

Definir diretrizes gerais de segurança do sistema.

Definir regras para:

* autenticação
* autorização
* armazenamento de dados
* assinaturas
* acesso aos recursos
* proteção contra abuso

Este documento estabelece princípios de segurança obrigatórios para todo o projeto.

---

# 2. Princípios gerais

A segurança deve priorizar:

* proteção dos dados do usuário
* integridade das informações
* proteção da receita do produto
* simplicidade operacional
* redução de fraudes

---

# 3. Regra fundamental

O cliente não é fonte de verdade.

Nenhuma regra crítica deve depender exclusivamente do aplicativo.

Toda validação crítica deve ocorrer através de sistemas confiáveis.

---

# 4. Fontes oficiais de verdade

## Assinaturas

Fonte oficial:

```txt
RevenueCat
```

---

## Usuários

Fonte oficial:

```txt
Firebase Authentication
```

---

## Dados do sistema

Fonte oficial:

```txt
Firestore
```

---

# 5. Autenticação

Métodos permitidos:

* email e senha
* Google
* Apple

---

## Regras

Toda operação autenticada exige usuário válido.

O sistema não deve permitir acesso anônimo.

### Verificação de e-mail

Para usuários que possuam o provider `password`, o acesso ao aplicativo
principal exige que o Firebase Authentication informe
`User.emailVerified === true`.

O guard central aplica a regra em toda mudança/restauração de sessão:

```txt
usuário autenticado
+ provider password
+ emailVerified false
→ fluxo obrigatório de verificação de e-mail
```

A confirmação no cliente sempre executa `User.reload()` antes de reler o
estado. A interface, o Firestore, o AsyncStorage e o armazenamento seguro não
podem criar ou persistir uma confirmação paralela. Google/Apple não recebem
exceção baseada no nome do provider: o valor de `emailVerified` continua vindo
do Firebase, e o bloqueio obrigatório se aplica apenas quando `password` está
entre os providers vinculados.

O primeiro e-mail é enviado uma vez após o cadastro por e-mail/senha. Novos
envios dependem de ação explícita do usuário, sem polling ou envio automático
no mount, e respeitam o rate limit do Firebase (`auth/too-many-requests`).

---

# 6. Sessões

O usuário pode permanecer autenticado em múltiplos dispositivos.

O usuário pode utilizar Android e iPhone simultaneamente.

Não existe, hoje, infraestrutura de sessão nomeada/identificável por
dispositivo (sem tabela de sessões, sem revogação individual, sem
`refreshToken` correlacionado a um device record). Ver §6.1 para a
consequência disso na tela de Segurança.

---

## 6.1 Tela de Segurança (`SecurityScreen`) — princípio geral

> **A UI de segurança nunca pode sugerir uma capacidade que a arquitetura de
> backend/autenticação não aplica de fato.** Se uma informação não tem uma
> fonte de verdade real e identity-scoped, ela não aparece — não é
> aproximada, não é enfeitada com um placeholder "bonito".

`src/screens/SecurityScreen.tsx` é somente leitura sobre estado que já existe
em outro lugar; a tela não é uma segunda fonte de verdade para nada.

### O que aparece e de onde vem

| Linha exibida | Fonte de verdade | Observações |
|---|---|---|
| Alterar senha (linha só aparece condicionalmente) | `linkedProviders` do `AuthContext`, via `PASSWORD_PROVIDER_ID` (`src/lib/authProviders.ts`) | Regra: aparece **apenas** se `password` estiver em `user.providerData`. Não há heurística por "como o usuário entrou agora" — é sempre o estado atual de `providerData`. |
| Método(s) de acesso — Google / Apple / E-mail e senha | `getReauthenticationProviders(user)` (`src/lib/authProviders.ts`), lido direto de `user.providerData` | Suporta múltiplos providers vinculados simultaneamente (ex.: `password` + `google.com`) sem esconder nenhum atrás de "um usuário = um provider". Nada é vinculado/desvinculado nesta tela — é somente leitura. |
| Último login | `user.metadata.lastSignInTime` (Firebase Auth), via `parseLastSignInTime`/`describeLastSignIn` (`src/lib/lastSignIn.ts`) | Ver semântica exata abaixo. Se o campo estiver ausente ou não puder ser parseado, a linha inteira é omitida — nunca aparece um valor inventado ou "carregando" permanente. |
| Excluir conta | Inalterado — abre `DeleteAccountScreen` via a mesma prop `onOpenDeleteAccount` que já existia | Nenhuma lógica do orchestrator/reauth/revogação foi tocada. |

### Semântica exata de "Último login"

`user.metadata.lastSignInTime` é o timestamp do **sign-in** mais recente
resolvido pelo Firebase Authentication — não é "última atividade no app" nem
"última requisição". Por isso o rótulo na UI é **"Último login"**, nunca
"Último acesso" (que sugeriria atividade recente). A formatação
(hoje/ontem/data) usa `Intl.DateTimeFormat` com `i18n.resolvedLanguage`,
igual ao padrão já usado em `SubscriptionCenterScreen` — nenhum idioma nem
fuso horário é hardcoded.

### O que foi removido e por quê

"Dispositivo atual", "Gerenciar dispositivos" e "Histórico de segurança"
existiam apenas como UI estática (`onPress: () => {}`), sem nenhuma fonte de
dados real por trás. Foram removidos por violarem o princípio acima.

* **Gerenciamento de dispositivos** só é uma feature de segurança legítima se
  o usuário puder identificar sessões individuais e revogá-las
  individualmente. Isso exige um registro de sessão por dispositivo (device
  id, plataforma, IP aproximado, último uso) e um caminho de revogação real
  (invalidar refresh tokens daquele device especificamente) — nenhum dos
  dois existe hoje. Requisito para implementar corretamente no futuro: uma
  coleção Firestore (ou equivalente) de sessões por UID, escrita no
  sign-in/refresh, com Rules que restrinjam leitura/escrita ao próprio dono,
  e uma Cloud Function ou fluxo de revogação real de token.
* **Histórico de segurança** exigiria um audit log de eventos de segurança
  (login, troca de senha, exclusão de conta, tentativas
  malsucedidas) persistido de forma identity-scoped e imutável do lado do
  cliente. Hoje existem apenas logs operacionais (`logInfo`/`logWarn`, ver
  §18) que não são security event logs nem estão expostos ao usuário.
  Requisito para implementar corretamente no futuro: uma coleção de eventos
  de segurança gravada por Cloud Functions (nunca pelo cliente diretamente,
  para não permitir forjar o próprio histórico), com Rules somente-leitura
  para o dono.

Nenhuma das duas é implementada nesta rodada — nem com uma versão
simplificada — porque uma versão cosmética delas é pior que não tê-las: cria
a impressão de uma capacidade de segurança (identificar/revogar um
dispositivo específico, auditar o que aconteceu na conta) que não existe de
fato.

---

# 7. Autorização

Todo usuário pode acessar apenas seus próprios dados.

Nenhum usuário pode:

* visualizar dados de terceiros
* alterar dados de terceiros
* acessar recursos administrativos

---

# 8. Painel administrativo

Todos os administradores possuem o mesmo nível de acesso.

---

## Permissões

Administradores podem:

* visualizar usuários
* visualizar métricas
* visualizar cupons
* exportar dados autorizados

---

## Restrições

Administradores não podem visualizar:

* fotos de evolução
* informações privadas não necessárias

---

# 9. Fotos de evolução

As fotos de evolução são privadas.

Somente o proprietário da conta pode acessá-las.

---

## Armazenamento

As imagens devem ser armazenadas no Firebase Storage.

O acesso deve ser protegido por regras de segurança.

Fotos de perfil seguem o mesmo princípio: ficam em
`users/{userId}/profile/avatar`, aceitam apenas `image/*` até 5 MB e somente o
proprietário autenticado pode ler ou escrever pelo SDK. O Firestore armazena
a URL em `profile.photoURL` e o timestamp servidor de cache em
`profile.photoVersion`, que só pode mudar junto com a URL. A regra aceita exclusivamente o objeto
`avatar` nesse diretório, inclusive para exclusão física.

---

# 10. Exclusão de conta

Ao solicitar exclusão:

* conta é marcada para remoção
* dados permanecem armazenados por 90 dias

---

## Após 90 dias

Remover definitivamente:

* conta
* dados
* fotos
* histórico
* registros relacionados

---

## Recuperação

Não existe recuperação após solicitação de exclusão.

---

# 11. Assinaturas

Toda validação de assinatura deve utilizar o RevenueCat.

---

## Regra obrigatória

Em caso de divergência:

```txt
RevenueCat vence.
```

---

## Firestore

O Firestore armazena apenas uma cópia operacional do status da assinatura.

---

# 12. Funcionamento offline da assinatura

A fonte oficial da assinatura continua sendo o RevenueCat.

O cliente utiliza somente o cache oficial de `CustomerInfo` do RevenueCat SDK.
Não armazena entitlement em `AsyncStorage`, `SecureStore` ou Firestore para
autorizar acesso.

Se uma revalidação temporária falhar e já houver `CustomerInfo` confirmado para
o mesmo Firebase UID e para a mesma geração de identidade, esse snapshot não é
apagado nem convertido automaticamente em assinatura inativa. Se não houver
snapshot confirmado para a identidade atual, o Gate permanece fail-closed e o
AppShell não é montado.

Logout e troca de conta invalidam o snapshot em memória imediatamente. O cache
ou espelho de outro UID nunca pode ser usado como fallback.

A janela própria de 24 horas e os campos locais de verificação descritos em
versões anteriores foram substituídos na Fase 3 pela política do cache oficial
do SDK, evitando uma segunda fonte de autorização. Uma eventual exigência
futura de TTL estrito controlado pelo AJ Fit depende de decisão e implementação
separadas.

---

# 13. Cloud Functions

Cloud Functions responsáveis por regras críticas devem validar:

* autenticação
* autorização
* status da assinatura

---

## Regra

Nenhuma Cloud Function deve confiar exclusivamente em dados enviados pelo aplicativo.

---

# 14. Proteção contra abuso

O sistema deve impedir uso abusivo de funcionalidades.

---

## Exemplos

* múltiplas solicitações de novo treino
* chamadas excessivas de Cloud Functions
* tentativas de manipulação de dados

---

# 15. Rate Limiting

Funções críticas devem possuir mecanismos de limitação.

Objetivo:

* reduzir abuso
* reduzir custos
* proteger infraestrutura

---

# 16. Armazenamento local

Dados armazenados localmente devem utilizar mecanismos seguros disponíveis na plataforma.

---

## Objetivo

Reduzir exposição de dados em caso de acesso indevido ao dispositivo.

---

## 16.1 Persistência de sessão (Firebase Auth)

O Firebase JS SDK (mantido — ver decisão de 2026-07-04 no log de evolução)
não oferece persistência nativa via Keychain/Keystore em React Native; sua
única opção de persistência local é um backend do tipo `AsyncStorage`, que
não é criptografado.

Para cumprir esta seção sem migrar para `@react-native-firebase/auth`, a
sessão persistida (tokens e perfil do usuário) é criptografada com
AES-256-GCM (`expo-crypto`) antes de ser gravada no `AsyncStorage`. A chave
de criptografia é gerada uma vez por dispositivo e armazenada exclusivamente
no Keychain/Keystore via `expo-secure-store` — nunca em `AsyncStorage`.

Implementação: `src/lib/secureAuthStorage.ts`, usado por
`src/lib/firebase.ts`. Logout (`signOutUser` em `src/services/auth.ts`)
descarta a chave de criptografia, invalidando permanentemente qualquer
sessão cifrada residual.

---

# 17. Sincronização

Toda sincronização deve preservar:

* integridade
* consistência
* rastreabilidade

---

## Regra

Nenhuma sincronização pode sobrescrever dados válidos sem validação.

---

# 18. Logs de auditoria

O sistema deve registrar eventos sensíveis.

---

## Eventos mínimos

* login
* criação de conta
* exclusão de conta
* alteração de assinatura
* solicitação de novo treino
* ativação de novo treino

---

# 19. Cupons promocionais

O cupom utilizado no cadastro é informação interna.

O usuário não precisa visualizar este dado após a criação da conta.

---

# 20. Vídeos dos exercícios

Os vídeos dos exercícios podem ser públicos.

---

## Observação

Esta decisão foi adotada para simplificar a arquitetura inicial.

Pode ser revisada futuramente caso existam problemas de compartilhamento indevido.

---

# 21. Segurança de dados corporais

Dados relacionados a:

* peso
* medidas
* percentual de gordura
* fotos de evolução

devem ser tratados como dados privados do usuário.

---

# 22. Segurança por padrão

Sempre que existir dúvida entre:

```txt
Mais conveniência
```

e

```txt
Mais segurança
```

a preferência deve ser:

```txt
Mais segurança
```

desde que não comprometa significativamente a experiência do usuário.

---

# 23. Pedido para o Agente de Segurança

Definir:

* regras do Firestore
* regras do Storage
* estratégia de autenticação
* estratégia de auditoria
* proteção contra abuso
* validações das Cloud Functions

Respeitando todas as regras deste documento.
