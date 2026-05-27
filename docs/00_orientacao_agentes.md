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
2. `09_glossario_dominio.md`
3. arquivos específicos da tarefa atual
4. 08_log_de_evolucao.md` (últimas entradas relevantes)

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

---

### 3.6 Linguagem obrigatória

Os agentes devem:

* escrever de forma objetiva
* evitar explicações longas
* evitar linguagem emocional
* evitar marketing
* evitar redundância

---

### 3.7 Termos do domínio

Os agentes devem utilizar apenas termos definidos em:
`09_glossario_dominio.md`

Novo termo exige proposta de adição ao glossário.

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
* glossário

Cada arquivo possui responsabilidade única.

---

## 5. Fluxo operacional

O fluxo obrigatório do sistema é:

1. Definição de visão e escopo
2. Definição de requisitos
3. Modelagem técnica
4. Contratos de API
5. Desenvolvimento por módulos
6. Testes
7. Registro de evolução
8. Validação humana
9. Próximo ciclo

Nenhum agente pode inverter esta ordem sem autorização humana.

---

## 6. Protocolo de divergência

Quando um agente identificar:

* ambiguidade
* conflito
* inconsistência
* impossibilidade técnica
* ausência de informação

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

O sistema não gera treinos livres.

Os treinos são pré-definidos e armazenados no banco de dados.

A lógica do sistema seleciona treinos existentes com base no questionário do usuário.

---

### 7.2 Alterações de treino

Nenhum agente pode:

* inventar treino
* alterar exercícios sem autorização
* modificar lógica de seleção sem documentação aprovada

---

### 7.3 Experiência do usuário

Toda implementação deve priorizar:

* clareza
* velocidade
* simplicidade
* consistência
* baixa fricção

---

### 7.4 Offline first

O sistema deve funcionar offline.

Sincronização ocorre quando houver conexão disponível.

Nenhum agente pode propor solução dependente de internet constante sem justificativa explícita.

---

### 7.5 Progressão contínua

O sistema trabalha com evolução contínua.

O usuário não reinicia sua jornada.

Mudanças de treino ocorrem por fases.

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
4. `04_contratos_de_api.md`
5. documentos de módulo
6. tarefas temporárias

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
