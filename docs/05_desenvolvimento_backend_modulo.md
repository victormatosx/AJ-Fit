# Desenvolvimento Backend por Módulo

## 1. Objetivo deste documento

Definir os módulos de backend do sistema.

Definir responsabilidades.

Definir regras de negócio executadas no servidor.

Definir automações e integrações.

---

# 2. Tecnologias utilizadas

Backend composto por:

* Cloud Functions
* Firestore
* Firebase Authentication
* Firebase Storage
* RevenueCat

---

# 3. Princípios do backend

O backend deve:

* proteger regras de negócio críticas
* evitar manipulação indevida pelo cliente
* manter consistência dos dados
* suportar funcionamento offline
* utilizar Cloud Functions apenas quando necessário

---

# 4. Módulo de autenticação

Responsável por:

* criação de conta
* login
* recuperação de acesso
* exclusão de conta

Autenticação é realizada através do Firebase Authentication.

---

# 5. Módulo de assinatura

Responsável por:

* teste gratuito
* assinatura ativa
* cancelamento
* renovação
* restauração de compra

O RevenueCat é a fonte oficial de verdade.

---

## Regras

Em caso de divergência:

```txt
RevenueCat vence.
```

---

# 6. Módulo de questionário

Responsável por:

* armazenar respostas
* validar preenchimento
* iniciar seleção de treino

---

## Regras

O usuário pode:

* utilizar respostas existentes
* refazer o questionário

Limite:

* 1 solicitação a cada 30 dias
* apenas após 30 dias do início do treino ativo

---

# 7. Módulo de seleção inicial de treino

Cloud Function:

```txt
selectInitialWorkout
```

Responsável por:

* analisar respostas
* selecionar template adequado
* escolher primeiro treino do usuário

---

## Regras

A seleção utiliza:

* limitações
* sexo
* frequência semanal
* experiência
* idade

A lógica detalhada será definida em documento específico.

---

# 8. Módulo de geração de treino

Cloud Function:

```txt
requestNewWorkout
```

Responsável por:

* gerar nova versão do treino
* utilizar respostas atuais ou novo questionário

---

## Regras

A geração ocorre imediatamente.

O sistema deve criar uma nova instância de treino.

O treino atual permanece ativo até confirmação do usuário.

---

## Fluxo esperado

1. usuário solicita novo treino
2. sistema gera nova versão
3. sistema apresenta tela de progressão simulada
4. sistema apresenta novo treino
5. usuário confirma ativação
6. novo treino torna-se ativo

---

# 9. Módulo de atualização automática

Cloud Function:

```txt
generateWorkoutVariation
```

Responsável por evolução periódica dos treinos.

---

## Regras

A atualização ocorre aproximadamente a cada 60 dias.

A atualização cria nova versão do treino.

O sistema não gera treino livre.

---

## Alterações permitidas

* alteração da ordem dos exercícios
* utilização de substituições válidas

---

## Alterações proibidas

* criação de exercícios inéditos
* alteração da lógica principal do treino

---

# 10. Módulo de execução de treino

Responsável por registrar:

* início
* conclusão
* frequência
* histórico

---

# 11. Módulo de cargas

Responsável por registrar histórico de cargas.

---

## Regras

As cargas pertencem ao exercício.

O histórico completo deve ser preservado.

Exemplo:

```txt
Supino Reto

01/01 = 80kg
08/01 = 85kg
15/01 = 90kg
```

O sistema não define cargas automaticamente.

---

# 12. Módulo de evolução física

Responsável por:

* medidas corporais
* peso
* percentual de gordura
* fotos de progresso

---

# 13. Módulo de cálculo de percentual de gordura

Cloud Function:

```txt
calculateBodyFat
```

---

## Protocolos suportados

* Jackson & Pollock 3 dobras
* Jackson & Pollock 7 dobras

O usuário escolhe o protocolo.

O resultado é apenas uma estimativa.

---

# 14. Módulo de fotos de progresso

Responsável por:

* upload
* armazenamento
* histórico

---

## Regras

Limite:

```txt
4 fotos por semana
```

As imagens são armazenadas no Firebase Storage.

---

# 15. Módulo de notificações

Responsável por:

* lembrete de treino
* reengajamento
* retorno ao aplicativo

As notificações são automáticas.

---

# 16. Módulo de usuários inativos

Cloud Function:

```txt
processInactiveUsers
```

Responsável por identificar usuários sem atividade recente.

---

## Objetivo

Executar campanhas automáticas de retorno.

---

# 17. Módulo de origem do usuário

Responsável por registrar:

* cupom promocional
* influenciador de origem

---

## Objetivo

Controle interno.

Comissões.

Relatórios administrativos.

---

# 18. Módulo administrativo

Responsável por fornecer visualização de:

* usuários
* assinaturas
* métricas
* origem dos usuários
* cupons utilizados

---

## Restrições

O painel administrativo não altera treinos diretamente.

---

# 19. Módulo de exclusão de conta

Cloud Function:

```txt
deleteAccount
```

---

## Regras

Ao solicitar exclusão:

* conta é marcada para remoção
* dados permanecem armazenados por 90 dias

Após 90 dias:

* remoção definitiva

---

# 20. Módulo de sincronização

Responsável por:

* sincronizar alterações offline
* resolver conflitos
* garantir consistência

---

## Regras

O sistema deve priorizar:

* integridade dos dados
* ausência de perda de informações
* experiência offline first

---

# 21. Pedido para o Agente Backend

Definir:

* estrutura das Cloud Functions
* gatilhos automáticos
* cron jobs
* estratégia de sincronização
* estratégia de versionamento
* monitoramento
* tratamento de erros

Respeitando todas as regras deste documento.
