> Registro histórico: as seções sobre limitações musculoesqueléticas estão descontinuadas. As demais regras independentes continuam sujeitas ao código atual. Ver [remoção definitiva](../../removal-physical-limitations/REPORT.md).

# AJ Fit --- Volume Rules

## 1. Objetivo

Este documento define como o motor pode reduzir, preservar, redistribuir
ou aumentar o volume de treinamento sem descaracterizar o template-base.

Volume não deve ser tratado como um número isolado. No AJ Fit ele pode
existir em:

``` text
séries por exercício
séries por sessão
séries por grupo muscular
séries semanais
número de voltas de circuito
minutos de cardio
número de intervalos
```

------------------------------------------------------------------------

## 2. Princípio central

O template-base define uma dose inicial coerente com sua família.

Modificadores podem alterar essa dose, mas devem preservar:

-   finalidade;
-   componentes essenciais;
-   recuperação;
-   duração;
-   safety constraints.

------------------------------------------------------------------------

## 3. Sinal de preservação

Não classificar componentes manualmente. A ordem do template é o sinal
principal: proteger o primeiro exercício, os primeiros candidatos das muscle
priorities e preencher pelas posições iniciais. Usar movement pattern existente
somente como guard quando todos os retidos ficariam iguais.

------------------------------------------------------------------------

## 4. Redução de volume

Beginner e duration calculam quantidade-alvo e selecionam por esse sinal. Não
há loop de compressão nem hierarquia de roles.

------------------------------------------------------------------------

## 5. Iniciante

Regra `IMPLEMENTED` sobre a quantidade de exercícios:

``` text
semana 1 → ceil(exerciseCount × 0.50)
semana 2 → ceil(exerciseCount × 0.70)
semana 3+ → todos os exercícios
```

Os itens retidos mantêm a dose. `BEGINNER != treino mínimo para sempre`.

------------------------------------------------------------------------

## 6. Sessão curta

Duration e beginner calculam seus targets sobre a mesma lista-base: 30 mantém
60%, 45 mantém 80%, Week 1 mantém 50% e Week 2 mantém 70%. O resultado usa o
menor target aplicável, nunca percentuais sequenciais. Cada target usa `ceil`.

------------------------------------------------------------------------

## 7. Recuperação ruim

Quando não houver red flag:

1.  remover intensificadores;
2.  reduzir acessórios;
3.  reduzir volume secundário;
4.  preservar movimentos prioritários quando possível;
5.  considerar sessão leve/recuperativa quando o template já prevê isso.

------------------------------------------------------------------------

## 8. Preferência muscular

Preferência não significa adicionar volume automaticamente.

A regra V1 não calcula exposição semanal. Para cada uma das até duas priorities,
preservar/antecipar o primeiro exercício relevante e, quando permitido,
adicionar +1 set nele. Máximo +1 por priority por sessão. Beginner Week 1/2 e
30 minutos não adicionam sets; 45 só adiciona se não houve redução; 60/90 podem
adicionar. O candidato precisa ter sets numéricos e já ter passado safety,
limitations e equipment.

------------------------------------------------------------------------

## 9. Hipertrofia / composição corporal

T001--T024:

-   preservar cobertura muscular e movimentos principais;
-   definição/emagrecimento não exigem redução do treino resistido por
    padrão;
-   cardio adicional não deve substituir indiscriminadamente séries de
    força/hipertrofia;
-   ênfase feminina/masculina padrão pode ser redistribuída por
    preferência.

------------------------------------------------------------------------

## 10. Força

T025--T048:

Volume deve ser subordinado à qualidade dos movimentos prioritários.

Em sessão curta:

``` text
principais > acessórios
```

Não aumentar densidade a ponto de destruir o caráter de força.

Mais séries não significam automaticamente mais força.

------------------------------------------------------------------------

## 11. Condicionamento

T049--T072:

Volume inclui:

-   voltas;
-   duração contínua;
-   intervalos;
-   exercícios por circuito.

Reduções possíveis:

``` text
4 voltas → 3
40 min → 30 min
10 intervalos → 8
```

Os números acima são exemplos estruturais do tipo de operação; o
template específico continua sendo a fonte da dose-base.

------------------------------------------------------------------------

## 12. Gestação

T073--T078:

Volume é subordinado a:

-   Safety Gate;
-   estágio;
-   conforto;
-   recuperação;
-   experiência prévia.

Não aplicar progressão de volume apenas porque a usuária era avançada
antes da gestação.

------------------------------------------------------------------------

## 13. Pós-parto

T079--T084:

Objetivo inicial é reconstrução gradual.

Tempo desde o parto não deve aumentar automaticamente volume.

Progressão depende das regras de recuperação e segurança.

------------------------------------------------------------------------

## 14. Fragilidade

T085--T090:

Priorizar dose tolerável e repetível.

O objetivo não é maximizar fadiga.

Sessões de movimento, cardio e equilíbrio têm valor próprio e não devem
ser convertidas em volume resistido adicional só porque existe tempo
disponível.

------------------------------------------------------------------------

## 15. Alta frequência

Treinar 6--7x não significa distribuir o máximo de volume todos os dias.

O motor deve considerar:

-   repetição de padrões;
-   dias leves;
-   recuperação ativa;
-   proximidade entre estímulos;
-   volume semanal resultante.

------------------------------------------------------------------------

## 16. Aumento de volume

Só permitir quando:

``` text
safety clear
AND recovery adequate
AND duration allows
AND family allows
AND experience allows
```

Preferir incrementos pequenos e rastreáveis.

------------------------------------------------------------------------

## 17. Limites

Os limites numéricos finais por grupo muscular/família **ainda precisam
ser especificados**.

Este documento não deve inventar:

-   número universal de séries por músculo;
-   MEV/MAV/MRV fixos para todos;
-   progressão semanal universal.

Antes da produção, cada família deve definir seus limites operacionais.

------------------------------------------------------------------------

## 18. Validation

Após qualquer mudança:

-   sessão continua com componentes essenciais?
-   algum grupo/padrão desapareceu sem motivo?
-   volume foi duplicado por dois modificadores?
-   duração ainda cabe?
-   recuperação é compatível?
-   preferência criou excesso?
-   alta frequência acumulou volume indevido?

------------------------------------------------------------------------

## 19. Decision trace

``` yaml
volume_change:
  source_modifier: MOD-XXX
  before:
    sets: null
    rounds: null
    minutes: null
  after:
    sets: null
    rounds: null
    minutes: null
  reason: ""
```

------------------------------------------------------------------------

## 20. Regra anti-acúmulo

O motor deve calcular o **volume final**, não simplesmente executar
deltas sucessivos.

Preferir:

``` text
BaseVolume
+ ActiveConstraints
→ TargetVolume
```

em vez de:

``` text
Base - modifierA - modifierB + modifierC - modifierD
```
