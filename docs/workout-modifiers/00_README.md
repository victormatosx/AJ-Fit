> Registro histórico: o sistema musculoesquelético e as políticas clínicas V3/legacy descritos aqui foram descontinuados. Não são contratos atuais. Ver [remoção definitiva](../removal-physical-limitations/REPORT.md).

# AJ Fit --- Motor de Modificadores de Treino

## 1. Objetivo

Este diretório documenta o sistema responsável por transformar um
**treino-base** da biblioteca AJ Fit em um **treino final
personalizado**.

A biblioteca T001--T090 define a estrutura inicial do treinamento. Ela
não deve tentar representar todas as combinações possíveis de nível,
equipamento, limitações, tempo disponível, preferências ou condições
especiais.

Essas adaptações pertencem à camada de **modificadores**.

Fluxo conceitual:

``` text
Dados do usuário
      ↓
Seleção do treino-base
      ↓
Identificação dos modificadores aplicáveis
      ↓
Safety Gates
      ↓
Resolução de prioridades e conflitos
      ↓
Aplicação dos modificadores
      ↓
Validação do treino resultante
      ↓
Treino final personalizado
```

O objetivo é permitir alta personalização sem multiplicar
artificialmente a quantidade de treinos-base.

O contrato simplificado de beginner, duration, priority e preservação por ordem
está em `06_NORMALIZED_DOSE_AND_SESSION_MODEL.md`. RIR, timing engine,
`slotRole` e budget semanal não pertencem à V1.

------------------------------------------------------------------------

## 2. Princípio central

Um treino-base representa uma **estrutura de treinamento**, e não uma
prescrição imutável.

Exemplo:

``` text
T001
+ iniciante
+ sessão de 45 min
+ limitação de joelho
+ academia sem determinada máquina
+ preferência por peitoral
=
treino final
```

O sistema deve modificar somente o necessário, preservando o máximo
possível da intenção do template original.

------------------------------------------------------------------------

## 3. Separação de responsabilidades

Existem três responsabilidades dentro da prescrição. Agenda e progressão são
responsabilidades externas, documentadas em `../workout-lifecycle/`.

### 3.1 Seleção

Decide **qual treino-base T001--T090 utilizar**.

Exemplos de variáveis predominantemente seletoras:

-   família de treinamento;
-   sexo/perfil-base quando aplicável;
-   ambiente;
-   frequência semanal;
-   gestação;
-   pós-parto;
-   fragilidade funcional.

### 3.2 Modificação

Decide **como adaptar o treino-base selecionado**.

Exemplos:

-   experiência;
-   tempo disponível;
-   equipamento;
-   limitação articular;
-   tolerância a impacto;
-   capacidade funcional;
-   preferência muscular;
-   recuperação.

### 3.3 Segurança

Decide **se uma regra normal de treino pode ser aplicada**.

Safety Gates e restrições de maior prioridade podem:

-   impedir determinada adaptação;
-   remover exercícios;
-   limitar intensidade;
-   exigir avaliação profissional;
-   impedir a geração de um treino quando faltarem condições mínimas de
    segurança.

Segurança nunca deve ser tratada como uma preferência.

------------------------------------------------------------------------

## 4. Arquivos principais

### `00_README.md`

Mapa geral da documentação e convenções.

### `01_ARCHITECTURE.md`

Arquitetura conceitual do motor, pipeline, contratos e invariantes.

### `02_VARIABLES_CATALOG.md`

Catálogo canônico das informações que podem influenciar seleção ou
modificação.

### `03_MODIFIERS_CATALOG.md`

Catálogo dos modificadores e padrão obrigatório para documentar cada
regra.

### `04_PRIORITY_AND_CONFLICTS.md`

Hierarquia de prioridades e regras para combinar múltiplos
modificadores.

### `05_EXERCISE_SUBSTITUTIONS.md`

Sistema de substituição de exercícios por padrão de movimento,
finalidade e motivo da troca.

### `exercise-limitations/`

Contrato e Limitation Resolver V1 implementados, inventário dos 116, 76 profiles
de política de produto, 40 ausentes fail-closed, interseção, trace e catalog
gaps. A fila de revisão profissional continua documental e não é confundida
com a aprovação conservadora de produto.

------------------------------------------------------------------------

## 5. Documentos por família

Após os documentos globais, as regras específicas devem ser documentadas
por família:

``` text
groups/
├── 01_T001-T012_HYPERTROPHY_MALE.md
├── 02_T013-T024_HYPERTROPHY_FEMALE.md
├── 03_T025-T036_STRENGTH_MALE.md
├── 04_T037-T048_STRENGTH_FEMALE.md
├── 05_T049-T060_CONDITIONING_MALE.md
├── 06_T061-T072_CONDITIONING_FEMALE.md
├── 07_T073-T078_PREGNANCY.md
├── 08_T079-T084_POSTPARTUM.md
└── 09_T085-T090_FRAILTY.md
```

Os documentos globais dizem **como o motor funciona**.

Os documentos de grupo dizem **como essas regras se manifestam naquela
família de treinos**.

------------------------------------------------------------------------

## 6. Ordem recomendada de leitura

1.  `00_README.md`
2.  `01_ARCHITECTURE.md`
3.  `02_VARIABLES_CATALOG.md`
4.  `03_MODIFIERS_CATALOG.md`
5.  `04_PRIORITY_AND_CONFLICTS.md`
6.  `05_EXERCISE_SUBSTITUTIONS.md`
7.  documento específico da família Txxx
8.  exemplos/testes de composição
9.  `../workout-lifecycle/00_README.md`
10. `../workout-lifecycle/08_PRESCRIPTION_CLOSURE_ANALYSIS.md`

------------------------------------------------------------------------

## 7. Convenções

### IDs de treino

``` text
T001 ... T090
```

### IDs de modificadores

Formato:

``` text
MOD-{DOMINIO}-{NNN}
```

Exemplos:

``` text
MOD-EXP-001
MOD-TIME-001
MOD-EQP-001
MOD-KNEE-001
```

### Prioridades

``` text
P0 = segurança absoluta
P1 = população/estado especial
P2 = limitação funcional, dor e tolerância
P3 = equipamento/viabilidade
P4 = experiência/capacidade
P5 = disponibilidade e duração
P6 = objetivo/ênfase programática
P7 = preferência
```

Quanto menor o número, maior a prioridade.

------------------------------------------------------------------------

## 8. Regra de não duplicação

Antes de criar um novo treino-base, perguntar:

> Esta diferença realmente exige outra estrutura de treinamento ou pode
> ser representada por um modificador?

Exemplos que normalmente **não** exigem biblioteca duplicada:

-   iniciante;
-   sessão curta;
-   ausência de uma máquina;
-   preferência por determinado grupo muscular;
-   necessidade de baixo impacto;
-   definição;
-   emagrecimento.

Um novo template só deve existir quando a estrutura semanal ou a
finalidade do programa realmente muda.

------------------------------------------------------------------------

## 9. Invariantes

O motor deve respeitar permanentemente:

1.  `SAFETY > ALL`.
2.  Um modificador de preferência não pode reintroduzir algo removido
    por segurança.
3.  Equipamento inexistente nunca pode permanecer no treino final.
4.  O treino final deve continuar coerente com a família selecionada.
5.  Uma substituição deve preservar, sempre que possível, o objetivo do
    exercício removido.
6.  Alta disponibilidade semanal não significa alta intensidade diária.
7.  Populações especiais não devem ser tratadas como simples variações
    estéticas.
8.  Idade cronológica isolada não equivale a fragilidade.
9.  O sistema não deve diagnosticar lesões ou condições clínicas.
10. Quando as regras não conseguirem produzir uma adaptação
    segura/coerente, o motor deve falhar de forma explícita em vez de
    improvisar.

------------------------------------------------------------------------

## 10. Estado deste documento

Este conjunto contém arquitetura conceitual e regras com estados diferentes.
Use sempre a legenda `IMPLEMENTED`, `APPROVED_NOT_IMPLEMENTED`,
`FUTURE_DESIGN` e `DECISION_REQUIRED` de
`../workout-lifecycle/00_README.md`; texto conceitual não prova execução.

O questionário da Fase 2 formaliza entradas para lipedema, tontura/vertigem e
pós-cirúrgico. Isso **não** cria novas famílias Txxx nem liga regras ao motor.
Os contratos estão em `02_VARIABLES_CATALOG.md`, os papéis em
`03_MODIFIERS_CATALOG.md`, a precedência em `04_PRIORITY_AND_CONFLICTS.md` e os
gates conceituais em `rules/SAFETY_RULES.md`. Seleção, safety, composição,
substituição pelo grafo atual, trace e snapshot local já possuem implementação,
com lacunas enumeradas em `../32_workout_prescription_engine.md`.
