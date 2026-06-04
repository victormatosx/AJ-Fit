# Lógica de Variação de Treinos

## 1. Objetivo deste documento

Definir a lógica oficial de geração de novos treinos.

Definir:

* regras de variação
* limites de alteração
* preservação da estrutura
* atualização automática
* solicitação manual de novos treinos

Este documento não define a seleção inicial de treinos.

A seleção inicial é tratada em documento específico.

---

# 2. Objetivo da variação

A variação existe para criar:

```txt
Sensação de novidade
```

sem comprometer a qualidade do treino.

---

## Objetivo principal

O usuário deve perceber que está evoluindo.

A variação não existe para gerar treinos aleatórios.

---

# 3. Princípios obrigatórios

Toda variação deve preservar:

* objetivo do treino
* frequência semanal
* divisão do treino
* lógica muscular
* estrutura principal

---

## Proibido

* gerar treinos aleatórios
* alterar objetivo principal
* alterar frequência semanal
* alterar divisão do treino

---

# 4. Tipos de geração

Existem duas formas de gerar um Novo Treino:

---

## Atualização automática

Ocorre aproximadamente a cada:

```txt
60 dias
```

---

## Solicitação manual

Disponível:

* após 30 dias do início do treino atual
* uma vez a cada 30 dias

---

# 5. Conceito de Novo Treino

Um Novo Treino representa uma nova versão do treino do usuário.

O treino anterior permanece armazenado para histórico.

---

# 6. Atualização automática

Objetivo:

Representar evolução natural da jornada.

---

## Intensidade da mudança

Aproximadamente:

```txt
60%
```

dos exercícios podem variar.

---

# 7. Solicitação manual

Objetivo:

Atender necessidade de renovação percebida pelo usuário.

---

## Intensidade da mudança

Aproximadamente:

```txt
70%
```

dos exercícios podem variar.

---

# 8. Estrutura preservada

Toda variação deve preservar:

* frequência semanal
* tipo de treino
* divisão principal
* fase atual

---

## Exemplo

```txt
Upper Lower 4x
```

continua:

```txt
Upper Lower 4x
```

---

# 9. Ordem muscular

A ordem dos grupos musculares deve permanecer consistente.

---

## Exemplo

```txt
Peito
Peito
Costas
Costas
Ombros
```

pode mudar exercícios.

Mas não deve alterar a sequência principal dos grupos musculares.

---

# 10. Ordem dos exercícios

A ordem dos exercícios pode variar parcialmente.

---

## Objetivo

Aumentar percepção de novidade.

---

# 11. Substituição de exercícios

Todo exercício pode possuir substituições válidas.

Não existem exercícios obrigatórios.

---

## Seleção

A substituição é escolhida aleatoriamente entre as opções válidas.

---

# 12. Regras das substituições

Toda substituição deve preservar:

* grupo muscular principal
* objetivo do exercício
* padrão de estímulo

---

# 13. Equipamentos

São permitidas substituições entre:

* barra
* halter
* máquina
* cabos

desde que previamente aprovadas.

---

# 14. Exercícios compostos e isoladores

Não é permitido substituir exercícios fora da lista oficial de substituições.

Toda substituição deve ser previamente cadastrada.

---

# 15. Quantidade de exercícios

A quantidade total de exercícios pode:

```txt
Diminuir 1
Manter
Aumentar 1
```

em relação ao treino anterior.

---

# 16. Séries

A quantidade de séries deve ser preservada.

---

## Objetivo

Manter consistência da progressão.

---

# 17. Histórico de cargas

O histórico de cargas nunca deve ser reiniciado.

---

## Regra

Se um exercício permanecer presente:

o histórico continua normalmente.

---

# 18. Mudança de fase

Mudança prevista:

```txt
Adaptativo
↓
Avançado
```

---

## Regra

A mudança pode alterar completamente a estrutura do treino.

Ambas as fases são pré-definidas.

---

# 19. Repetição de exercícios

Exercícios podem reaparecer em versões futuras.

---

## Exemplo

```txt
Treino A
Supino Barra

Treino B
Supino Máquina

Treino C
Supino Barra
```

---

# 20. Repetição de treinos

O sistema não deve gerar o mesmo treino em versões consecutivas.

---

## Objetivo

Evitar sensação de repetição.

---

# 21. Preferências do usuário

Quando o usuário escolhe uma substituição durante a execução:

a preferência vale apenas para o treino atual.

---

## Regra

A escolha não altera permanentemente futuras gerações.

---

# 22. Ativação do novo treino

O novo treino não substitui imediatamente o treino atual.

---

## Fluxo

1. gerar novo treino
2. apresentar resultado
3. solicitar confirmação
4. ativar novo treino

---

# 23. Histórico de versões

Toda nova geração cria uma nova versão do treino.

---

## Objetivo

Preservar rastreabilidade.

---

# 24. Quantidade de versões

Não existe limite de versões.

O processo é contínuo.

---

# 25. Critério de sucesso

Uma variação é considerada válida quando:

* preserva a lógica do treino
* gera percepção de novidade
* evita repetição imediata
* mantém consistência da evolução

---

# 26. Pedido para o Agente de Treinos

Definir:

* algoritmo de variação
* regras de sorteio
* validação das substituições
* versionamento dos treinos
* preservação do histórico

Respeitando todas as regras deste documento.
