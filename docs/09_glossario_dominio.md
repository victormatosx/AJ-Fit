# Glossário do Domínio

## 1. Objetivo deste documento

Definir os termos oficiais utilizados no projeto.

Garantir consistência entre:

* documentação
* agentes
* desenvolvimento
* testes

Todos os agentes devem utilizar os termos definidos neste documento.

---

# 2. Regras gerais

Os termos definidos aqui são a linguagem oficial do projeto.

Nenhum agente deve criar sinônimos sem aprovação.

Novos termos devem ser adicionados ao glossário antes de serem utilizados oficialmente.

---

# 3. Usuário

Pessoa que utiliza o aplicativo.

Pode possuir:

* conta
* assinatura
* treino ativo
* histórico
* evolução física

---

# 4. Questionário

Conjunto de perguntas respondidas pelo usuário.

Utilizado para selecionar o treino mais adequado.

O questionário é a principal fonte de entrada para definição do treino inicial.

---

# 5. Treino

Estrutura organizada de exercícios atribuída ao usuário.

Representa o plano atualmente executado.

---

# 6. Tipo de Treino

Categoria estrutural do treino.

Exemplos:

* Full Body
* Upper Lower
* Push Pull Legs
* Glúteos e Posteriores

---

# 7. Treino do Usuário

Versão do treino atribuída ao usuário.

Representa a instância efetivamente executada.

É baseada em um template oficial do sistema.

---

# 8. Template de Treino

Modelo oficial armazenado pelo sistema.

Utilizado como base para criação dos treinos dos usuários.

O usuário nunca executa diretamente um template.

---

# 9. Novo Treino

Nova versão do treino do usuário.

Pode surgir por:

* solicitação do usuário
* atualização automática do sistema

O resultado final é sempre um novo treino.

---

# 10. Fase

Etapa de evolução do usuário dentro de um tipo de treino.

Fases disponíveis inicialmente:

* Adaptativo
* Avançado

---

# 11. Exercício

Movimento individual presente em um treino.

Pode possuir:

* imagem
* vídeo
* instruções
* substituições válidas

---

# 12. Substituição de Exercício

Troca controlada de um exercício por outro previamente aprovado.

A substituição deve:

* preservar grupo muscular
* preservar objetivo
* preservar estímulo principal

---

# 13. Sessão de Treino

Execução de um treino realizada pelo usuário.

Possui:

* início
* conclusão
* exercícios executados

---

# 14. Série

Unidade de execução de um exercício.

Exemplo:

```txt
Supino Reto

Série 1
Série 2
Série 3
```

---

# 15. Carga

Peso registrado pelo usuário durante a execução de uma série.

---

# 16. Histórico de Cargas

Registro histórico das cargas utilizadas pelo usuário.

Permite acompanhamento da evolução de desempenho.

---

# 17. Evolução Física

Conjunto de informações corporais registradas pelo usuário.

Exemplos:

* peso
* medidas
* percentual de gordura
* fotos

---

# 18. Fotos de Evolução

Imagens registradas pelo usuário para acompanhamento visual da evolução física.

---

# 19. Percentual de Gordura

Estimativa calculada a partir de protocolos de dobras cutâneas.

Não representa diagnóstico médico.

---

# 20. Assinatura

Permissão de acesso ao aplicativo.

Gerenciada através do RevenueCat.

---

# 21. Teste Gratuito

Período inicial de acesso liberado antes da cobrança da assinatura.

Duração inicial:

```txt
7 dias
```

---

# 22. Usuário Sem Assinatura

Usuário sem acesso ativo ao aplicativo.

Exemplos:

* assinatura expirada
* assinatura cancelada
* pagamento não aprovado

---

# 23. Usuário Inativo

Usuário que deixou de utilizar o aplicativo por determinado período.

Utilizado para ações de reengajamento.

Não está relacionado à assinatura.

---

# 24. Dashboard

Tela principal do aplicativo.

Responsável por apresentar:

* próximo treino
* evolução
* métricas
* atalhos principais

---

# 25. Funcionamento Offline

Capacidade do aplicativo operar sem conexão com internet.

---

# 26. Sincronização

Processo de envio e atualização dos dados locais para o servidor.

Executado quando houver conexão disponível.

---

# 27. RevenueCat

Plataforma responsável pelo gerenciamento de:

* assinaturas
* renovações
* cancelamentos
* restauração de compras

É a fonte oficial de verdade para status de assinatura.

---

# 28. Cloud Function

Função executada no backend para processar regras de negócio que não devem depender do aplicativo.

---

# 29. Fonte de Verdade

Sistema responsável pela informação oficial de determinado domínio.

Exemplo:

```txt
Assinaturas → RevenueCat
```

---

# 30. Agente

Participante do sistema multiagente responsável por executar tarefas específicas dentro do projeto.

Os agentes não possuem autonomia total sobre o sistema.

---

# 31. Humano Coordenador

Responsável final pelas decisões do projeto.

Possui autoridade sobre todos os agentes.

Toda decisão relevante exige validação humana.

---

# 32. Divergência

Situação onde existe:

* ambiguidade
* conflito
* ausência de informação
* bloqueio técnico

A divergência deve ser registrada no log de evolução.

---

# 33. Documentação Oficial

Conjunto de arquivos aprovados que representam a fonte de verdade do projeto.

Nenhum agente pode ignorar documentação oficial aprovada.
