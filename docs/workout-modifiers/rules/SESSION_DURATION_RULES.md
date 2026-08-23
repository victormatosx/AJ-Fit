# AJ Fit --- Session Duration Rules

## 1. Objetivo

Adaptar o treino à duração disponível sem simplesmente "cortar o final".

Faixas conceituais atuais:

``` text
SHORT      ≈ 30 min
MEDIUM     ≈ 45 min
STANDARD   ≈ 60 min
LONG       ≈ 75+ min
```

Os limites exatos de produto podem ser ajustados posteriormente.

------------------------------------------------------------------------

## 2. Regra principal

``` text
tempo disponível
!=
percentual fixo de corte
```

O motor deve reconstruir a sessão dentro de um orçamento de tempo.

------------------------------------------------------------------------

## 3. Orçamento conceitual

Uma sessão possui:

``` text
warmup
exercise_execution
rest
transitions
cardio
cooldown
```

O cálculo final de duração deverá considerar todos esses componentes.

------------------------------------------------------------------------

## 4. Prioridade de preservação

``` text
1. Safety
2. componente essencial
3. componente de alta prioridade
4. acessório prioritário
5. acessório opcional
6. redundância
```

------------------------------------------------------------------------

## 5. 30 minutos

Objetivo:

Produzir a versão mínima coerente da sessão.

Estratégia:

-   preservar componentes essenciais;
-   remover redundâncias;
-   reduzir acessórios;
-   usar supersets compatíveis quando não prejudicarem a finalidade;
-   reduzir séries somente quando necessário;
-   em cardio, ajustar duração/intervalos sem eliminar
    aquecimento/segurança relevante.

Não transformar força em circuito.

------------------------------------------------------------------------

## 6. 45 minutos

Deve preservar maior parte da sessão.

Ajustes típicos:

-   remover 1--2 componentes opcionais quando necessário;
-   reduzir transições;
-   organizar acessórios em pares compatíveis;
-   pequenas reduções de séries/duração.

------------------------------------------------------------------------

## 7. 60 minutos

É a referência conceitual de muitos templates gerais.

Na ausência de outros modificadores, tende a preservar o template-base.

------------------------------------------------------------------------

## 8. 75+ minutos

Tempo adicional não significa adicionar exercícios automaticamente.

Só usar tempo extra se:

-   volume adicional fizer sentido;
-   recuperação permitir;
-   experiência permitir;
-   objetivo justificar.

Caso contrário, preservar a dose-base.

------------------------------------------------------------------------

## 9. Hipertrofia

Prioridade:

``` text
compostos/padrões principais
→ volume muscular prioritário
→ acessórios
```

Preferência estética pode definir qual acessório sobrevive ao corte,
desde que não viole regra superior.

------------------------------------------------------------------------

## 10. Força

Prioridade:

``` text
movimento principal
→ segundo movimento prioritário
→ assistência
→ acessórios
```

Descanso dos principais deve ser protegido.

------------------------------------------------------------------------

## 11. Condicionamento

Possíveis reduções:

-   número de voltas;
-   minutos contínuos;
-   quantidade de intervalos;
-   acessórios do circuito.

Não remover indiscriminadamente aquecimento e volta à calma quando
fizerem parte da estrutura segura.

------------------------------------------------------------------------

## 12. Gestação

Tempo curto não justifica acelerar a sessão por densidade excessiva.

Preservar transições, conforto e estabilidade.

------------------------------------------------------------------------

## 13. Pós-parto

Mesma regra: encurtar por seleção de componentes, não por pressa.

------------------------------------------------------------------------

## 14. Fragilidade

Transições e descanso podem consumir mais tempo e devem ser considerados
parte real da sessão.

Não usar estimativa baseada em adulto saudável avançado.

------------------------------------------------------------------------

## 15. Supersets

Só usar quando:

-   exercícios forem compatíveis;
-   não comprometerem principal;
-   equipamento permitir;
-   usuário tiver experiência/capacidade;
-   safety permitir.

Tipos preferíveis:

``` text
upper + lower de baixa interferência
push + pull acessório
exercise + core leve
```

As combinações finais serão especificadas por família.

------------------------------------------------------------------------

## 16. Cálculo futuro

Cada exercício deverá possuir estimativa de:

``` text
setup_time
set_execution_time
default_rest
transition_time
```

Então:

``` text
estimated_session_duration =
warmup
+ Σ(set execution)
+ Σ(rest)
+ Σ(transitions)
+ cardio
+ cooldown
```

------------------------------------------------------------------------

## 17. Se não couber

Quando nem a estrutura mínima couber:

``` text
SESSION_TOO_SHORT_FOR_TEMPLATE
```

O motor deve:

-   selecionar alternativa de sessão quando formalmente prevista; ou
-   retornar necessidade de ajuste.

Não deve destruir o template silenciosamente.

------------------------------------------------------------------------

## 18. Frequência vs duração

Usuário com:

``` text
6 dias × 30 min
```

pode ter melhor distribuição do que:

``` text
2 dias × 90 min
```

mas isso pertence à seleção/composição global, não a um corte isolado de
sessão.

------------------------------------------------------------------------

## 19. Validation

-   estimativa \<= duração alvo?
-   essenciais presentes?
-   descanso dos principais preservado?
-   redundância removida antes de essenciais?
-   supersets compatíveis?
-   cardio ainda cumpre finalidade?
-   safety não foi sacrificado?

------------------------------------------------------------------------

## 20. Trace

``` yaml
duration:
  target_minutes: 30
  estimated_before: null
  estimated_after: null
  removed_components: []
  paired_components: []
  reduced_sets: []
```
