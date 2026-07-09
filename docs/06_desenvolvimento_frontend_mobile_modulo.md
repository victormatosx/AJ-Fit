# Desenvolvimento Frontend Mobile por Módulo

## 1. Objetivo deste documento

Definir os módulos do aplicativo mobile.

Definir responsabilidades de cada módulo.

Definir fluxos de navegação.

Definir regras de experiência do usuário.

Este documento não define layout visual.

Este documento define comportamento esperado da aplicação.

---

# 2. Tecnologias

Aplicativo desenvolvido com:

* React Native
* Expo
* Firebase
* RevenueCat

O aplicativo deve atender:

* Android
* iOS

---

# 3. Princípios do frontend

Toda implementação deve priorizar:

* simplicidade
* velocidade
* clareza
* consistência
* baixa fricção

O usuário deve conseguir iniciar um treino com o menor número possível de interações.

---

# 4. Objetivo principal do aplicativo

O principal objetivo da interface é incentivar:

```txt
Iniciar Treino
```

Toda navegação deve favorecer este comportamento.

---

# 5. Estrutura geral da experiência

A experiência do usuário é composta por cinco pilares:

* descoberta
* execução
* evolução
* progressão
* retenção

---

# 6. Módulo de apresentação inicial

Responsável por apresentar o produto antes do questionário.

---

## Estrutura

Uma única tela contendo:

* proposta do aplicativo
* benefícios principais
* imagens ilustrativas
* fluxo visual simplificado

---

## Objetivo

Preparar o usuário para iniciar o questionário.

---

# 7. Módulo de onboarding

Responsável por:

* coleta de informações
* definição do perfil do usuário
* seleção do treino recomendado

---

## Estrutura

O questionário deve utilizar:

* uma pergunta por tela
* navegação em etapas
* possibilidade de voltar respostas anteriores

---

## Persistência

As respostas devem permanecer salvas localmente até a conclusão do processo.

O usuário pode sair do aplicativo e continuar posteriormente.

---

## Fluxo

1. apresentação inicial
2. questionário
3. seleção do treino recomendado
4. resumo do treino recomendado
5. criação de conta
6. assinatura
7. exibição do treino inicial

---

# 8. Módulo de recomendação de treino

Responsável por apresentar o resultado do questionário.

---

## Informações exibidas

O usuário deve visualizar apenas:

* nome do treino
* frequência semanal
* objetivo
* plano de evolução

---

## Informações ocultas

Não exibir:

* exercícios
* estrutura detalhada
* lista completa do treino

O treino completo só é liberado após criação de conta e assinatura.

---

# 9. Módulo de autenticação

Responsável por:

* cadastro
* login
* recuperação de senha
* login social (Google e Apple)
* vinculação de provedores (account linking)

---

## Métodos permitidos

* email e senha
* Google
* Apple

## Regras de implementação

* Lógica de autenticação centralizada em serviços (`socialAuth`,
  `providers/*`), nunca espalhada nas telas. As telas chamam
  `signInWithProvider(provider)` — sem `if` específico por provedor.
* Estados obrigatórios em toda ação: loading, sucesso, erro e cancelamento
  (o cancelamento do sheet nativo não exibe erro).
* Botões sociais respeitam a plataforma: Apple apenas em iOS (quando
  disponível); Google em iOS/Android. Não aparecem na web.
* Account linking: ao detectar e-mail já usado por outro método, exibir painel
  orientando o usuário a entrar com o método existente para vincular — mantendo
  o mesmo UID e todos os dados.
* Perfil exibe os métodos de login vinculados (Google / Apple / E-mail-Senha),
  a partir de `linkedProviders`. Estrutura preparada para desvincular no futuro.
* Social auth exige dev/EAS build (não funciona no Expo Go).

---

# 10. Módulo de assinatura

Responsável por:

* iniciar teste gratuito
* restaurar compra
* exibir status da assinatura

---

## Regras

A assinatura é obrigatória.

Não existe modo gratuito.

O teste gratuito possui duração de 7 dias.

O usuário deve cadastrar método de pagamento antes da ativação do teste.

---

# 11. Dashboard principal

Responsável por ser a tela inicial do aplicativo.

---

## Objetivo

Conduzir o usuário para iniciar o próximo treino.

---

## Informações previstas

* próximo treino
* frequência recente
* sequência atual
* peso
* percentual de gordura
* evolução física
* atalhos rápidos

---

## Prioridade visual

A ação principal da tela deve ser:

```txt
Iniciar Treino
```

---

# 12. Navegação principal

A aplicação deve possuir navegação simplificada.

Estrutura inicial prevista:

* início
* treino
* evolução
* perfil

A estrutura final poderá ser refinada posteriormente.

---

# 13. Módulo de treino

Responsável por:

* exibir treino ativo
* exibir exercícios
* exibir substituições disponíveis
* iniciar execução

---

## Regras

O treino ativo deve estar sempre acessível.

O usuário não deve precisar navegar por múltiplas telas para iniciar o treino.

---

# 14. Módulo de execução de treino

Responsável por:

* executar treino
* registrar séries
* registrar cargas
* controlar descanso

---

## Estrutura da execução

Fluxo esperado:

```txt
Exercício
↓
Série
↓
Descanso
↓
Próxima série
↓
Descanso
↓
Exercício concluído
↓
Próximo exercício
```

---

## Registro de carga

O registro de carga é opcional.

A carga pode ser registrada por série.

---

# 15. Módulo de descanso

Responsável por controlar o intervalo entre séries.

---

## Regras

Após conclusão de uma série:

* iniciar cronômetro automaticamente
* exibir contagem regressiva
* liberar próxima série após término

---

## Objetivo

Melhorar experiência de treino e aumentar permanência no aplicativo.

---

# 16. Módulo de exercícios

Responsável por exibir:

* nome
* imagem
* vídeo
* instruções
* substituições disponíveis

---

## Substituições

O usuário pode selecionar substituições pré-definidas.

O sistema não permite substituições livres.

---

# 17. Módulo de solicitação de novo treino

Responsável por:

* solicitar novo treino
* permitir refazer questionário

---

## Regras

Disponível apenas:

* após 30 dias do início do treino ativo
* uma vez a cada 30 dias

---

## Fluxo

1. solicitação
2. tela de geração simulada
3. progresso visual
4. espera aproximada de 10 segundos
5. exibição do novo treino
6. confirmação do usuário

---

## Ativação

O novo treino só se torna ativo após confirmação explícita.

---

# 18. Módulo de evolução física

Responsável por:

* peso
* medidas
* percentual de gordura
* fotos de progresso

---

# 19. Módulo de percentual de gordura

Responsável por:

* seleção do protocolo
* inserção das medidas
* exibição do resultado

---

## Protocolos disponíveis

* Jackson & Pollock 3 dobras
* Jackson & Pollock 7 dobras

---

# 20. Módulo de fotos de progresso

Responsável por:

* captura
* envio
* histórico
* comparação visual

---

## Regras

Limite:

```txt
4 fotos por semana
```

---

## Comparação

O sistema deve permitir comparação visual entre períodos diferentes.

Exemplo:

```txt
Antes | Depois
```

---

# 21. Módulo de conclusão de treino

Responsável por exibir recompensa imediata após o treino.

---

## Informações previstas

* treino concluído
* duração
* exercícios realizados
* mensagem de incentivo

---

## Objetivo

Reforçar sensação de progresso.

---

# 22. Módulo de progressão

Responsável por apresentar evolução do usuário.

---

## Eventos importantes

* novo treino disponível
* mudança de fase
* atualização automática do treino

---

## Experiência

Quando ocorrer evolução relevante, o sistema deve exibir telas especiais de progressão.

Exemplo:

```txt
Parabéns!

Você concluiu sua fase anterior.

Seu novo treino está pronto.
```

---

# 23. Módulo de notificações

Responsável por:

* lembretes
* reengajamento
* retorno ao aplicativo

---

# 24. Modo offline

O aplicativo deve funcionar offline.

O usuário deve conseguir:

* visualizar treino ativo
* executar treino
* registrar cargas
* consultar histórico disponível

---

## Sincronização

A sincronização deve ocorrer automaticamente quando houver conexão.

---

# 25. Estados da interface

Toda operação relevante deve possuir:

* loading
* sucesso
* erro

O usuário nunca deve ficar sem feedback visual.

---

# 26. Estados vazios

Devem existir telas específicas para:

* ausência de histórico
* ausência de fotos
* ausência de medições
* ausência de conexão

---

# 27. Tratamento de erros

Mensagens devem ser:

* simples
* objetivas
* compreensíveis

Erros técnicos não devem ser exibidos ao usuário.

---

# 28. Pedido para o Agente Frontend

Definir:

* arquitetura de navegação
* componentes reutilizáveis
* gerenciamento de estado
* estratégia offline
* sincronização
* estrutura de telas
* design system

Respeitando todas as regras deste documento.
