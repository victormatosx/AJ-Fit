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

---

# 6. Sessões

O usuário pode permanecer autenticado em múltiplos dispositivos.

O usuário pode utilizar Android e iPhone simultaneamente.

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

Esta regra se aplica apenas quando houver impossibilidade de validar a assinatura junto ao RevenueCat ou quando existir divergência temporária entre os dados do Firestore e do RevenueCat.

A fonte oficial da assinatura continua sendo o RevenueCat.

O objetivo desta regra é evitar bloqueios indevidos causados por falhas temporárias de sincronização ou ausência momentânea de conexão com a internet.

---

## Regra

A última validação válida da assinatura pode ser utilizada por até:

```txt
24 horas
```

desde que a última confirmação recebida do RevenueCat indique uma assinatura ativa.

---

## Aviso obrigatório

Quando estiver offline:

```txt
Você está utilizando o aplicativo sem conexão.

Conecte-se à internet até amanhã para continuar utilizando normalmente.
```

---

## Após 24 horas

O aplicativo deve exigir conexão para validar novamente a assinatura junto ao RevenueCat.

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
