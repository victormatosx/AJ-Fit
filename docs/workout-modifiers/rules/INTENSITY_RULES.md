# AJ Fit --- Intensity Rules

## 1. Objetivo

Definir como intensidade, esforço, descanso, densidade e formato de
trabalho podem ser modificados sem misturar conceitos.

------------------------------------------------------------------------

## 2. Intensidade não é uma única variável

No motor, distinguir:

``` text
LOAD_INTENSITY
EFFORT
REP_RANGE
REST
DENSITY
CARDIO_INTENSITY
IMPACT
```

Impacto não é sinônimo de intensidade cardiovascular.

------------------------------------------------------------------------

## 3. Força

T025--T048 usam faixas de repetições menores nos movimentos principais.

Modificadores devem preservar:

-   descanso adequado;
-   execução técnica;
-   capacidade de produzir força;
-   progressão mensurável.

Não usar supersets agressivos nos principais apenas para caber no tempo.

------------------------------------------------------------------------

## 4. Hipertrofia

T001--T024:

A intensidade deve permitir volume de qualidade.

`BEGINNER` pode usar maior margem de esforço e progressão conservadora.

`ADVANCED` não significa falha em todas as séries.

------------------------------------------------------------------------

## 5. Condicionamento

T049--T072:

Termos como:

``` text
forte
moderado
leve
```

são relativos ao usuário.

Não codificar uma velocidade universal.

Intervalos devem preservar relação trabalho/recuperação do template ou
de sua regra de modificação.

------------------------------------------------------------------------

## 6. Gestação

Intensidade deve permanecer dentro do envelope definido pelo Safety
Gate, estágio, conforto e orientação profissional.

Experiência prévia pode influenciar familiaridade, mas não remove
constraints.

------------------------------------------------------------------------

## 7. Pós-parto

Intensidade acompanha estágio de reconstrução.

Não usar tempo desde o parto como único gatilho para voltar a esforços
anteriores.

------------------------------------------------------------------------

## 8. Fragilidade

Priorizar esforço controlável, execução estável e autonomia.

Não usar falha muscular como objetivo padrão.

------------------------------------------------------------------------

## 9. Experiência

### Beginner

A V1 não modifica intensidade por experience. Beginner reduz somente a
quantidade de exercícios na Week 1/2; cada item retido mantém a prescrição-base.
Não há RIR, effort target ou controle de proximidade da falha no Prescription
Engine. DR-002 foi substituído e DR-023 cancelado.

### Intermediate

Preserva dose-base na ausência de outras constraints.

### Advanced

Preserva a intensidade-base. O nível avançado, sozinho, não aumenta intensidade
nem autoriza técnicas; evolução futura pertence ao Progression Engine.

------------------------------------------------------------------------

## 10. Recuperação

Em recuperação ruim:

``` text
remove intensifiers
→ reduce effort/density
→ reduce secondary volume
```

Não compensar recuperação ruim com intervalos mais curtos.

------------------------------------------------------------------------

## 11. Tempo curto

Tempo curto não deve significar automaticamente:

``` text
rest ↓
density ↑
```

Especialmente em força.

Alternativas:

-   cortar acessórios;
-   supersets de baixa interferência;
-   reduzir séries;
-   reduzir duração de cardio;
-   reorganizar sessão.

------------------------------------------------------------------------

## 12. Técnicas avançadas

Exemplos conceituais:

``` text
drop set
rest-pause
cluster
myo-reps
superset de alta interferência
```

Só devem existir quando explicitamente suportadas pela família e
experiência.

Não são necessárias para considerar um treino "avançado".

------------------------------------------------------------------------

## 13. Falha

O motor não deve assumir:

``` text
hipertrofia = falha sempre
força = nunca falha
condicionamento = máximo sempre
```

A regra final de proximidade da falha ainda precisa ser especificada por
família.

------------------------------------------------------------------------

## 14. Descanso

Descanso é variável de programação, não desperdício de tempo.

Prioridade:

-   força: proteger desempenho;
-   hipertrofia: equilibrar qualidade e duração;
-   condicionamento: descanso faz parte do estímulo;
-   populações especiais: segurança/recuperação prevalecem.

------------------------------------------------------------------------

## 15. Densidade

Densidade pode aumentar por:

-   supersets compatíveis;
-   circuitos;
-   menor intervalo.

Mas nunca deve violar:

-   safety;
-   objetivo da família;
-   técnica;
-   recuperação.

------------------------------------------------------------------------

## 16. Impacto

Impacto é tratado por constraint separada.

Exemplo:

``` text
running interval
→ bike interval
```

pode reduzir impacto mantendo intensidade cardiovascular relativa.

------------------------------------------------------------------------

## 17. Valores numéricos fora da V1

O Prescription Engine V1 não calcula:

-   RPE;
-   RIR;
-   %1RM;
-   zonas de frequência cardíaca;
-   velocidade;
-   wattagem.

Uma funcionalidade futura de execução/progressão pode tratá-los sem bloquear a
seleção e personalização V1.

------------------------------------------------------------------------

## 18. Validation

Após mudança de intensidade:

-   família ainda é reconhecível?
-   descanso ficou inadequado?
-   densidade criou risco?
-   iniciante recebeu técnica avançada?
-   recuperação ruim recebeu estímulo maior?
-   no-high-impact continua respeitado?
-   população especial continua dentro do envelope?

------------------------------------------------------------------------

## 19. Trace

``` yaml
intensity_change:
  modifier: MOD-XXX
  dimension: effort|rest|density|cardio_intensity|rep_range
  before: null
  after: null
  reason: ""
```
