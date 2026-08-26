# Visão Geral do Sistema

## 1. Objetivo do projeto

Desenvolver um aplicativo mobile de treino focado em evolução contínua, constância e baixa fricção.

O sistema deve entregar direcionamento claro através de treinos pré-definidos, execução simples e acompanhamento de evolução.

O aplicativo deve reduzir fadiga de decisão e facilitar a continuidade do usuário.

---

## 2. Problema que o sistema resolve

Grande parte dos usuários possui dificuldade em:

- escolher um treino adequado
- manter constância
- organizar evolução
- acompanhar progresso físico
- permanecer treinando por longos períodos

A maioria dos aplicativos exige decisões demais do usuário.

O AJ Fit busca reduzir complexidade operacional e facilitar continuidade.

---

## 3. Tese central do produto

O diferencial do sistema não é gerar infinitos treinos.

O diferencial é:

- direcionar corretamente
- simplificar execução
- reduzir dúvidas
- manter consistência
- criar sensação contínua de evolução

---

## 4. Estrutura dos treinos

O sistema trabalha com treinos pré-definidos armazenados no banco de dados.

O sistema não gera treinos livres na versão inicial.

A lógica do sistema seleciona treinos com base nas respostas do questionário.

Critérios inicialmente considerados prioritários:

- limitações
- sexo
- frequência semanal
- experiência
- idade

Os critérios exatos serão definidos em documentação específica.

---

## 5. Estrutura da experiência

O usuário recebe direcionamento pronto.

O treino é fechado.

O sistema deve minimizar excesso de escolhas.

Cada exercício pode possuir substituições pré-definidas.

As substituições devem:

- trabalhar o mesmo grupo muscular
- manter estímulo semelhante
- preservar a lógica do treino

As substituições existem para:

- indisponibilidade de equipamento
- desconforto com exercício
- preferência individual
- limitações específicas

O usuário não possui liberdade total de edição do treino.

Alterações estruturais devem acontecer através de solicitação de novo treino.

---

## 6. Progressão e atualização dos treinos

O sistema trabalha com evolução contínua.

O usuário não reinicia jornadas.

Revisões futuras pertencem ao Progression Engine e não usam 60/90 dias como
timer único. Meses/~3 meses são apenas referência de ciclo.

A atualização não gera um treino livre novo.

A atualização ocorre por variação controlada.

A variação controlada pode:

- trocar exercícios por substituições pré-definidas
- alterar ordem dos exercícios
- preservar o estímulo principal
- manter coerência do treino

---

## 7. Fases de treino

Não há templates distintos por fase de experiência. O iniciante recebe um
modifier temporário nas semanas 1 e 2; intermediário e avançado partem do
template-base. Evolução posterior é responsabilidade do Progression Engine.

---

## 8. Público-alvo inicial

Foco inicial:

- praticantes de musculação
- iniciantes
- intermediários
- usuários que treinam entre 3 e 6 vezes por semana
- pessoas que desejam direcionamento simples

---

## 9. Objetivo de negócio

Prioridades principais:

- retenção mensal
- crescimento de assinaturas
- recorrência de uso
- aumento de frequência de treino

---

## 10. Comportamentos que o sistema deve incentivar

O sistema deve incentivar:

- abertura recorrente do aplicativo
- execução frequente de treinos
- constância semanal
- continuidade da assinatura

---

## 11. Conteúdo disponível no sistema

A versão inicial possui:

- vídeos de execução de exercícios
- notificações de lembrete
- acompanhamento de evolução
- calculadora de dobras subcutâneas

---

## 12. Histórico do usuário

O sistema deve permitir acompanhamento de:

- cargas registradas manualmente
- frequência de treino
- evolução física
- medidas corporais
- fotos de progresso
- estimativas de percentual de gordura

O sistema não define cargas automaticamente.

---

## 13. Calculadora de dobras subcutâneas

O usuário poderá inserir medidas de dobras subcutâneas.

O sistema calculará automaticamente uma estimativa de percentual de gordura corporal.

O resultado deve ser tratado como estimativa, não como diagnóstico médico.

O método de cálculo será definido em documentação específica.

---

## 14. Plataformas

O sistema será desenvolvido inicialmente para:

- Android
- iOS

---

## 15. Funcionamento offline

O sistema deve funcionar offline.

Sincronização ocorre quando houver conexão disponível.

Offline first é requisito obrigatório.

---

## 16. Identidade do produto

O sistema deve transmitir:

- simplicidade
- clareza
- evolução
- performance
- sensação premium

---

## 17. Escopo inicial

Primeira versão:

- onboarding
- questionário inicial
- assinatura
- autenticação
- seleção de treino
- execução de treino
- substituição de exercícios
- histórico básico
- funcionamento offline
- sincronização
- vídeos de execução
- atualização periódica de treino
- notificações
- calculadora de dobras subcutâneas

---

## 18. Fora do escopo inicial

Não faz parte da primeira versão:

- rede social
- feed
- marketplace
- integração com wearables
- gamificação avançada
- geração livre de treino por IA
- coach virtual completo

---

## 19. Evolução futura prevista

Futuras versões poderão incluir:

- IA coach
- geração personalizada de treinos
- adaptação automática
- recomendações inteligentes

Esses recursos não fazem parte da versão inicial.

---

## 20. Riscos conhecidos

Principais riscos:

- aumento excessivo de escopo
- complexidade do sistema offline
- baixa retenção após teste gratuito
- excesso de customização
- perda de simplicidade operacional
- usuário perceber repetição excessiva nos treinos
- cálculo corporal ser interpretado como diagnóstico

---

## 21. Premissas do projeto

Premissas obrigatórias:

- o sistema será modular
- o sistema será evolutivo
- os treinos serão pré-definidos inicialmente
- a variação dos treinos será controlada
- toda etapa exige validação humana
- IA auxilia desenvolvimento, não decisões autônomas

---

## 22. Documentos específicos necessários

Devem existir documentos próprios para:

- lógica de seleção de treinos
- lógica de variação de treinos
- segurança geral do app
- calculadora de dobras subcutâneas

---

## 23. Critério de sucesso inicial

A primeira versão será considerada bem-sucedida se:

- usuários iniciarem treinos rapidamente
- o sistema funcionar offline corretamente
- sincronização ocorrer sem perda de dados
- usuários retornarem frequentemente ao aplicativo
- a experiência permanecer simples e consistente
- a variação dos treinos gerar percepção de continuidade
- o acompanhamento de evolução for fácil de usar

---

## 24. Pedido para o Agente Arquiteto

Analise esta visão geral.

Identifique:

- riscos técnicos
- gargalos
- simplificações possíveis
- inconsistências
- dependências críticas
- riscos de escalabilidade

Proponha uma estrutura inicial coerente com os objetivos do projeto.
