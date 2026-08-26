# Orientação para Agentes

## 1. Objetivo deste sistema

Este projeto utiliza um sistema multiagente coordenado por humano.

Os agentes possuem responsabilidades isoladas.

Nenhum agente possui autonomia total sobre o projeto.

O sistema existe para:

* reduzir ambiguidade
* aumentar consistência
* evitar retrabalho
* manter rastreabilidade
* acelerar desenvolvimento

---

## 2. Ordem obrigatória de leitura

Todo agente deve ler nesta ordem:

1. `00_orientacao_agentes.md`
2. `01_visao_geral.md`
3. `09_glossario_dominio.md`
4. `08_log_de_evolucao.md` (últimas entradas relevantes)
5. arquivos específicos da tarefa atual

Nenhum agente pode atuar sem contexto suficiente.

---

## 3. Regras universais

### 3.1 Verdade documental

Os arquivos aprovados são a fonte de verdade do projeto.

Nenhum agente pode ignorar um artefato aprovado.

---

### 3.2 Proibição de improviso

Nenhum agente pode:

* inventar requisito
* assumir comportamento
* alterar contrato implicitamente
* criar funcionalidade não solicitada
* expandir escopo sem autorização

Em caso de dúvida:

* parar execução
* abrir divergência
* aguardar validação humana

---

### 3.3 Escopo restrito

Cada agente possui:

* arquivos permitidos de leitura
* arquivos permitidos de escrita
* fronteiras explícitas

Nenhum agente altera arquivos fora do seu escopo.

---

### 3.4 Validação humana obrigatória

Nenhuma etapa avança automaticamente.

Toda etapa exige validação humana antes da próxima ativação.

---

### 3.5 Decisões técnicas

Toda decisão técnica deve:

* ser objetiva
* possuir justificativa curta
* respeitar os artefatos aprovados
* priorizar simplicidade operacional

---

### 3.6 Linguagem obrigatória

Os agentes devem:

* escrever de forma objetiva
* evitar explicações longas
* evitar linguagem emocional
* evitar marketing
* evitar redundância
* evitar ambiguidade

---

### 3.7 Termos do domínio

Os agentes devem utilizar apenas termos definidos em:
`09_glossario_dominio.md`

Novo termo exige proposta de adição ao glossário.

---

### 3.8 Controle de escopo

Nenhum agente pode:

* adicionar funcionalidades não aprovadas
* assumir futuras funcionalidades como existentes
* criar arquitetura baseada em hipóteses futuras sem necessidade atual

Funcionalidades futuras devem permanecer desacopladas da versão inicial sempre que possível.

---

## 4. Estrutura do projeto

Os documentos do projeto são organizados em camadas:

* orientação
* visão de produto
* requisitos
* modelagem
* contratos
* implementação
* testes
* evolução
* segurança
* glossário

Cada arquivo possui responsabilidade única.

---

## 5. Fluxo operacional

O fluxo obrigatório do sistema é:

1. Definição de visão e escopo
2. Definição de requisitos
3. Definição de regras de negócio
4. Modelagem técnica
5. Contratos de API
6. Desenvolvimento por módulos
7. Testes
8. Registro de evolução
9. Validação humana
10. Próximo ciclo

Nenhum agente pode inverter esta ordem sem autorização humana.

---

## 6. Protocolo de divergência

Quando um agente identificar:

* ambiguidade
* conflito
* inconsistência
* impossibilidade técnica
* ausência de informação
* expansão excessiva de escopo

o agente deve interromper a tarefa imediatamente.

---

### 6.1 Tipos de divergência

#### `[PENDENTE]`

Informação ausente que exige decisão humana.

#### `[QUESTIONAMENTO]`

Suspeita de erro em artefato aprovado.

#### `[CONFLITO]`

Contradição entre artefatos aprovados.

#### `[BLOQUEIO]`

Impossibilidade técnica de execução.

#### `[ESCOPO]`

Possível crescimento desnecessário de complexidade.

---

### 6.2 Procedimento obrigatório

O agente deve:

1. parar execução
2. registrar divergência no `08_log_de_evolucao.md`
3. marcar o trecho relacionado
4. notificar o humano coordenador
5. aguardar decisão

Improvisar é proibido.

---

## 7. Regras específicas do projeto AJ Fit

### 7.1 Estrutura dos treinos

O sistema não gera treinos livres na versão inicial.

Os treinos são pré-definidos e armazenados no banco de dados.

A lógica do sistema seleciona treinos existentes com base no questionário do usuário.

---

### 7.2 Estrutura das fases

O contrato atual não possui templates separados por “fase adaptativa” e
“avançada”. Iniciantes usam o mesmo Txxx com Beginner Adaptation temporário nas
duas primeiras semanas; intermediários e avançados partem da base normal.

---

### 7.3 Atualização de treinos

Atualização/revisão pertence ao futuro Progression Engine. Não há timer fixo de
60 dias aprovado; calendário deve ser combinado com execução real.

A atualização ocorre através de variação controlada.

A variação pode:

* alterar ordem dos exercícios
* trocar exercícios por substituições válidas

A atualização não representa geração livre de novo treino.

---

### 7.4 Substituições de exercícios

Cada exercício pode possuir substituições pré-definidas.

As substituições devem:

* preservar o grupo muscular
* manter estímulo semelhante
* preservar coerência do treino

Nenhum agente pode tratar substituições como troca livre irrestrita.

---

### 7.5 Alterações de treino

Nenhum agente pode:

* inventar treino
* alterar exercícios sem autorização
* modificar lógica de seleção sem documentação aprovada
* criar progressão dinâmica não documentada

---

### 7.6 Experiência do usuário

Toda implementação deve priorizar:

* clareza
* velocidade
* simplicidade
* consistência
* baixa fricção

O sistema deve minimizar excesso de decisões do usuário.

---

### 7.7 Offline first

O sistema deve funcionar offline.

Sincronização ocorre quando houver conexão disponível.

Nenhum agente pode propor solução dependente de internet constante sem justificativa explícita.

---

### 7.8 Evolução contínua

O sistema trabalha com evolução contínua.

O usuário não reinicia sua jornada.

---

### 7.9 Controle de carga

O sistema não define cargas automaticamente.

O usuário registra cargas manualmente apenas para acompanhamento.

---

### 7.10 Dados físicos e corporais

O sistema pode armazenar:

* medidas corporais
* fotos de progresso
* percentual de gordura estimado
* dados de evolução física

Nenhum agente pode tratar dados corporais como diagnóstico médico.

---

### 7.11 Calculadora corporal

O sistema possui cálculo estimado de percentual de gordura através de dobras subcutâneas.

Os resultados devem ser tratados como estimativas.

---

## 8. Formato obrigatório de entrega

Toda resposta de agente deve terminar com:

```txt
RESUMO PARA VALIDAÇÃO HUMANA
```

O resumo deve conter:

* o que foi feito
* o que exige validação
* pendências
* riscos identificados
* próxima ação sugerida

---

## 9. Hierarquia de prioridade documental

Em caso de conflito entre documentos:

1. `00_orientacao_agentes.md`
2. `01_visao_geral.md`
3. `02_requisitos_e_regras_de_negocio.md`
4. `12_seguranca_geral_do_app.md`
5. `04_contratos_de_api.md`
6. documentos de módulo
7. tarefas temporárias

---

## 10. Controle de mudanças

Nenhuma decisão importante pode existir apenas no chat.

Toda decisão aprovada deve ser registrada nos arquivos oficiais do projeto.

---

## 11. Responsabilidade humana

O humano coordenador é responsável por:

* validar etapas
* resolver divergências
* aprovar decisões
* controlar escopo
* impedir complexidade desnecessária

Os agentes auxiliam o desenvolvimento.

Os agentes não substituem direção humana.

---

## 12. Assinatura obrigatória

Toda contribuição deve informar:

* nome do agente
* data
* versão do prompt
