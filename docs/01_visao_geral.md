# Visão Geral do Sistema

## 1. Objetivo do projeto

Desenvolver um aplicativo mobile de treino focado em evolução contínua, constância e baixa fricção.

O sistema deve entregar direcionamento claro para o usuário através de treinos pré-definidos e progressão por fases.

O aplicativo deve reduzir fadiga de decisão e simplificar a execução do treino.

---

## 2. Problema que o sistema resolve

Grande parte dos usuários possui dificuldade em:

* escolher um treino adequado
* manter constância
* organizar evolução
* adaptar treino à rotina
* permanecer treinando por longos períodos

A maioria dos aplicativos exige decisões demais do usuário.

O sistema AJ Fit busca reduzir complexidade operacional e facilitar continuidade.

---

## 3. Tese central do produto

O diferencial do sistema não é gerar infinitos treinos.

O diferencial é:

* direcionar corretamente
* simplificar execução
* reduzir dúvidas
* manter consistência
* criar sensação contínua de evolução

---

## 4. Estrutura dos treinos

O sistema trabalha com treinos pré-definidos armazenados no banco de dados.

O sistema não gera treinos livres na versão inicial.

A lógica do sistema seleciona treinos com base nas respostas do questionário do usuário.

Os critérios exatos de seleção serão definidos em documentação específica.

Critérios inicialmente considerados prioritários:

* limitações
* sexo
* frequência semanal
* experiência
* idade

---

## 5. Estrutura da experiência

O usuário recebe direcionamento pronto.

O treino é fechado.

O sistema deve minimizar excesso de escolhas.

Cada exercício pode possuir substituições pré-definidas.

As substituições devem:

* trabalhar o mesmo grupo muscular
* manter estímulo semelhante
* preservar a lógica do treino

As substituições existem para casos como:

* indisponibilidade de equipamento
* desconforto com exercício
* preferência individual
* limitações específicas

O usuário não possui liberdade total de edição do treino.

Alterações estruturais devem acontecer através de solicitação de novo treino.

---

## 6. Progressão do usuário

O sistema trabalha com evolução contínua.

O usuário evolui por fases.

Mudanças de treino acontecem periodicamente.

O sistema não reinicia jornadas.

---

## 7. Público-alvo inicial

Foco inicial:

* praticantes de musculação
* iniciantes
* intermediários
* usuários que treinam entre 3 e 6 vezes por semana
* pessoas que desejam direcionamento simples

---

## 8. Objetivo de negócio

Prioridades principais:

* retenção mensal
* crescimento de assinaturas
* recorrência de uso
* aumento de frequência de treino

---

## 9. Comportamentos que o sistema deve incentivar

O sistema deve incentivar:

* abertura recorrente do aplicativo
* execução frequente de treinos
* constância semanal
* continuidade da assinatura

---

## 10. Conteúdo disponível no sistema

A versão inicial possui:

* vídeos de execução de exercícios
* notificações de lembrete
* acompanhamento de evolução

---

## 11. Histórico do usuário

O sistema deve permitir acompanhamento de:

* cargas registradas manualmente
* frequência de treino
* evolução física
* medidas corporais
* fotos de progresso

O sistema não define cargas automaticamente.

---

## 12. Plataformas

O sistema será desenvolvido inicialmente para:

* Android
* iOS

---

## 13. Funcionamento offline

O sistema deve funcionar offline.

Sincronização ocorre quando houver conexão disponível.

Offline first é requisito obrigatório.

---

## 14. Identidade do produto

O sistema deve transmitir:

* simplicidade
* clareza
* evolução
* performance
* sensação premium

---

## 15. Escopo inicial

Primeira versão:

* onboarding
* questionário inicial
* assinatura
* autenticação 
* seleção de treino
* execução de treino
* histórico básico
* funcionamento offline
* sincronização
* vídeos de execução
* atualização de fases
* notificações

---

## 16. Fora do escopo inicial

Não faz parte da primeira versão:

* rede social
* feed
* marketplace
* integração com wearables
* gamificação avançada
* geração livre de treino por IA
* coach virtual completo

---

## 17. Evolução futura prevista

Futuras versões poderão incluir:

* IA coach
* geração personalizada de treinos
* adaptação automática
* recomendações inteligentes

Esses recursos não fazem parte da arquitetura inicial obrigatória.

---

## 18. Riscos conhecidos

Principais riscos:

* aumento excessivo de escopo
* complexidade do sistema offline
* baixa retenção após teste gratuito
* excesso de customização
* perda de simplicidade operacional

---

## 19. Premissas do projeto

Premissas obrigatórias:

* o sistema será modular
* o sistema será evolutivo
* os treinos serão pré-definidos inicialmente
* toda etapa exige validação humana
* IA auxilia desenvolvimento, não decisões autônomas

---

## 20. Critério de sucesso inicial

A primeira versão será considerada bem-sucedida se:

* usuários iniciarem treinos rapidamente
* o sistema funcionar offline corretamente
* sincronização ocorrer sem perda de dados
* usuários retornarem frequentemente ao aplicativo
* a experiência permanecer simples e consistente

---

## 21. Pedido para o Agente Arquiteto

Analise esta visão geral.

Identifique:

* riscos técnicos
* gargalos
* simplificações possíveis
* inconsistências
* dependências críticas
* riscos de escalabilidade

Proponha uma estrutura inicial coerente com os objetivos do projeto.
