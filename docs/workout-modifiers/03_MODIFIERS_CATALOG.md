# AJ Fit --- Catálogo Mestre de Modificadores

## 1. Objetivo

Este documento define os domínios de modificadores e o contrato que cada
modificador específico deverá seguir.

Ele não substitui os arquivos por família T001--T090. As regras
detalhadas serão adicionadas conforme cada grupo for documentado.

------------------------------------------------------------------------

# 2. Contrato obrigatório

Todo modificador deve conter:

``` markdown
## MOD-XXX-NNN — Nome

### Objetivo
Por que existe.

### Priority
P0-P7.

### Trigger
Condição exata de ativação.

### Inputs
Variáveis necessárias.

### Scope
Famílias, treinos, sessões ou padrões afetados.

### Effects
Operações permitidas.

### Protected
O que não pode alterar.

### Conflicts
Conflitos conhecidos.

### Composition
Como combina com outros modificadores.

### Validation
Condições que devem continuar verdadeiras.

### Examples
Antes/depois.
```

Nenhum modificador deve existir apenas como frase vaga.

------------------------------------------------------------------------

# 3. Domínio SAF --- Segurança

Prefixo:

``` text
MOD-SAF-xxx
```

Prioridade predominante: `P0`.

Responsabilidades:

-   bloquear regras incompatíveis;
-   aplicar restrições profissionais;
-   impedir exercícios/estímulos proibidos;
-   acionar `NEEDS_REVIEW`;
-   preservar Safety Gates.

Exemplos futuros:

``` text
MOD-SAF-001 — Professional Restriction
MOD-SAF-002 — Safety Gate Block
MOD-SAF-003 — Runtime Red Flag
```

Esses modificadores não são preferências.

------------------------------------------------------------------------

# 4. Domínio POP --- Populações especiais

``` text
MOD-POP-xxx
```

Prioridade: `P1`.

Abrange:

-   gestação;
-   pós-parto;
-   fragilidade;
-   futuramente outros cenários formalmente documentados.

Exemplos:

``` text
MOD-POP-001 — Pregnancy Stage
MOD-POP-002 — Postpartum Recovery Stage
MOD-POP-003 — Frailty Functional Adaptation
```

Podem alterar:

-   seleção de exercícios;
-   posição;
-   estabilidade;
-   volume;
-   impacto;
-   progressão;
-   apoio.

------------------------------------------------------------------------

# 5. Domínio LIM --- Limitações

Pode ser subdividido por região para facilitar auditoria:

``` text
MOD-KNEE-xxx
MOD-HIP-xxx
MOD-SHOULDER-xxx
MOD-SPINE-xxx
MOD-WRIST-xxx
MOD-ELBOW-xxx
MOD-ANKLE-xxx
```

Prioridade: `P2`.

Responsabilidades:

-   remover ou substituir movimentos incompatíveis;
-   modificar amplitude quando formalmente previsto;
-   adicionar apoio;
-   alterar impacto;
-   preservar estímulo quando possível.

Regra:

> Uma limitação não deve ser convertida automaticamente em diagnóstico.

As regras específicas deverão se basear no que a pessoa relata que não
consegue/tolera e em restrições profissionais disponíveis.

------------------------------------------------------------------------

# 6. Domínio FUNC --- Capacidade funcional

``` text
MOD-FUNC-xxx
```

Prioridade: `P2-P4`, conforme regra.

Exemplos:

``` text
MOD-FUNC-001 — Low Functional Capacity
MOD-FUNC-002 — Very Low Functional Capacity
MOD-FUNC-003 — Balance Support Required
MOD-FUNC-004 — Reduced Impact Tolerance
```

Pode alterar:

-   complexidade;
-   apoio;
-   unilateralidade;
-   duração;
-   densidade;
-   seleção de exercício;
-   cardio.

------------------------------------------------------------------------

# 7. Domínio EQP --- Equipamento

``` text
MOD-EQP-xxx
```

Prioridade: `P3`.

Exemplos:

``` text
MOD-EQP-001 — No Barbell
MOD-EQP-002 — No Cable
MOD-EQP-003 — No Machines
MOD-EQP-004 — Dumbbells Only
MOD-EQP-005 — Bands Only
MOD-EQP-006 — Bodyweight Only
MOD-EQP-007 — No Cardio Machine
```

Regra principal:

> Equipamento altera execução, não objetivo.

Se um exercício não puder ser realizado, o sistema consulta
`05_EXERCISE_SUBSTITUTIONS.md`.

------------------------------------------------------------------------

# 8. Domínio EXP --- Experiência

``` text
MOD-EXP-xxx
```

Prioridade: `P4`.

Exemplos:

``` text
MOD-EXP-001 — Beginner
MOD-EXP-002 — Intermediate
MOD-EXP-003 — Advanced
```

### Beginner

Pode futuramente:

-   reduzir volume inicial;
-   favorecer exercícios mais estáveis;
-   aumentar margem de esforço;
-   evitar técnicas avançadas;
-   simplificar combinações complexas.

### Intermediate

Tende a preservar template-base.

### Advanced

Pode permitir maior especificidade, volume ou técnicas quando a família
justificar.

Regra:

> Avançado não significa automaticamente mais exercícios.

------------------------------------------------------------------------

# 9. Domínio TIME --- Duração

``` text
MOD-TIME-xxx
```

Prioridade: `P5`.

Sugestão:

``` text
MOD-TIME-001 — 30 Minute Session
MOD-TIME-002 — 45 Minute Session
MOD-TIME-003 — 60 Minute Session
MOD-TIME-004 — 75+ Minute Session
```

Ordem preferencial para encurtar sessão:

``` text
1. preservar safety
2. preservar movimentos prioritários
3. remover redundância
4. reduzir acessórios de menor prioridade
5. reorganizar supersets compatíveis
6. ajustar séries quando necessário
7. ajustar cardio conforme finalidade da sessão
```

Nunca começar cortando aleatoriamente o primeiro/último exercício.

------------------------------------------------------------------------

# 10. Domínio VOL --- Volume

``` text
MOD-VOL-xxx
```

Prioridade: depende do gatilho que o originou.

Exemplos conceituais:

``` text
MOD-VOL-001 — Reduced Initial Volume
MOD-VOL-002 — Increased Target Muscle Volume
MOD-VOL-003 — Recovery Volume Reduction
```

Volume é frequentemente um **efeito** de outro modificador, e não uma
preferência isolada.

Evitar aplicar múltiplas reduções cumulativas sem limite.

------------------------------------------------------------------------

# 11. Domínio INT --- Intensidade/esforço

``` text
MOD-INT-xxx
```

Pode controlar:

-   intensidade relativa;
-   margem da falha;
-   faixa de repetições;
-   intervalo;
-   intensidade do cardio.

Em condicionamento:

``` text
HIGH
MODERATE
LOW
```

devem representar intensidade relativa ao usuário, não velocidade fixa.

------------------------------------------------------------------------

# 12. Domínio IMP --- Impacto

``` text
MOD-IMP-xxx
```

Prioridade: `P2-P4` conforme origem.

Exemplos:

``` text
MOD-IMP-001 — Reduced Impact
MOD-IMP-002 — No High Impact
```

Pode substituir:

``` text
corrida → caminhada inclinada/bike/elíptico
saltos → step/marcha/bike
step jack → marcha lateral controlada
```

A alternativa final depende de equipamento, capacidade e restrições.

------------------------------------------------------------------------

# 13. Domínio PREF --- Preferências

``` text
MOD-PREF-xxx
```

Prioridade: `P7`.

Categorias:

``` text
MUSCLE_EMPHASIS
EXERCISE_PREFERENCE
EXERCISE_AVOIDANCE
CARDIO_PREFERENCE
```

Exemplos:

``` text
MOD-PREF-001 — Glute Emphasis
MOD-PREF-002 — Chest Emphasis
MOD-PREF-003 — Back Emphasis
MOD-PREF-004 — Shoulder Emphasis
MOD-PREF-005 — Arms Emphasis
```

Preferência pode:

-   trocar acessório equivalente;
-   redistribuir parte do volume;
-   escolher entre alternativas equivalentes.

Preferência não pode:

-   remover safety;
-   violar equipamento;
-   contrariar limitação;
-   alterar a família inteira;
-   criar volume ilimitado.

------------------------------------------------------------------------

# 14. Domínio REC --- Recuperação

``` text
MOD-REC-xxx
```

Prioridade: `P4-P5`, salvo sinal de segurança.

Exemplos conceituais:

``` text
MOD-REC-001 — Poor Recovery
MOD-REC-002 — Unusual Fatigue
```

Possíveis efeitos futuros:

-   reduzir volume do dia;
-   remover técnicas intensificadoras;
-   converter sessão complementar em recuperação;
-   reduzir densidade.

Não deve diagnosticar overtraining, doença ou condição clínica.

------------------------------------------------------------------------

# 15. Domínio CARDIO

``` text
MOD-CARDIO-xxx
```

Controla:

-   modalidade;
-   duração;
-   impacto;
-   contínuo vs intervalado;
-   distribuição semanal.

Exemplos:

``` text
MOD-CARDIO-001 — Low Impact Cardio
MOD-CARDIO-002 — Walking Preference
MOD-CARDIO-003 — No Cardio Equipment
```

------------------------------------------------------------------------

# 16. Modificadores compostos

Algumas situações ativam vários efeitos, mas não devem virar um
"mega-modificador" impossível de testar.

Exemplo:

``` text
BEGINNER
```

pode ativar:

``` text
REDUCED_INITIAL_VOLUME
STABLE_EXERCISE_SELECTION
NO_ADVANCED_TECHNIQUES
CONSERVATIVE_EFFORT
```

A implementação poderá manter um modificador pai com efeitos explícitos
ou regras filhas. O importante é manter rastreabilidade.

------------------------------------------------------------------------

# 17. O que ainda não deve ser criado

Não criar modificadores genéricos como:

``` text
MOD-EASY
MOD-HARD
MOD-SAFE
MOD-FAT_BURN
MOD-FEMALE
MOD-OLD_PERSON
```

Eles são vagos, misturam conceitos ou codificam premissas ruins.

------------------------------------------------------------------------

# 18. Matriz inicial de domínios

  Domínio   Exemplo                            Prioridade típica
  --------- -------------------------------- -------------------
  SAF       restrição/safety gate                             P0
  POP       gestação/pós-parto/fragilidade                    P1
  LIM       joelho/quadril/ombro/coluna                       P2
  FUNC      capacidade/equilíbrio                         P2--P4
  IMP       impacto                                       P2--P4
  EQP       equipamento                                       P3
  EXP       experiência                                       P4
  REC       recuperação                                   P4--P5
  TIME      duração                                           P5
  VOL       volume                                    contextual
  INT       intensidade                               contextual
  CARDIO    cardio                                    contextual
  PREF      preferência                                       P7

------------------------------------------------------------------------

# 19. Próxima etapa

Cada arquivo `groups/Txxx...md` deverá dizer:

1.  quais modificadores deste catálogo se aplicam;
2.  como se aplicam;
3.  quais exercícios são prioritários;
4.  quais podem ser removidos;
5.  quais substituições são válidas;
6.  limites de volume/intensidade;
7.  exceções da família.

------------------------------------------------------------------------

# 20. Contratos de domínio da Fase 2

``` text
MOD-LIP-xxx   — lipedema; usa impacto + orientação, prioridade P2/P0
MOD-DIZ-xxx   — tontura/vertigem; usa frequência + equilíbrio, P2/P0
MOD-POST-xxx  — pós-cirúrgico; sempre precedido por SAF-POST, P0
SAF-MED-xxx   — restrição profissional estruturada, P0
```

Os prefixos reservam identidade e responsabilidade; não representam regras já
implementadas. `SAF-POST` deve decidir se há espaço permitido antes de qualquer
`MOD-POST`. `MOD-LIP` não equivale a baixo impacto. `MOD-DIZ` não substitui a
avaliação do equilíbrio. Nenhum deles pode converter `UNKNOWN/UNSURE` em
ausência de restrição.
