# Adaptação inicial para iniciantes

## Regra V1 aprovada

Status: `IMPLEMENTED` em `src/workoutPrescription/`.

Beginner usa o mesmo Txxx selecionado. Nas duas primeiras semanas, o motor
reduz quantidade de exercícios, não sets, duração, ciclos ou intensidade:

```text
Week 1: keepCount = ceil(baseExerciseCount × 0.50)
Week 2: keepCount = ceil(baseExerciseCount × 0.70)
Week 3+: keepCount = baseExerciseCount
```

| Base | Week 1 | Week 2 | Week 3+ |
|---:|---:|---:|---:|
| 4 | 2 | 3 | 4 |
| 5 | 3 | 4 | 5 |
| 6 | 3 | 5 | 6 |
| 7 | 4 | 5 | 7 |

`ceil` garante pelo menos um exercício quando a sessão não está vazia. O
exercício preservado mantém sets/reps/duration/cycles originais, salvo outro
modifier. Não existe RIR ou controle de proximidade da falha na V1.

## Seleção simples dos exercícios preservados

1. partir da ordem canônica da sessão já resolvida por safety/limitations e
   equipment;
2. proteger o primeiro exercício;
3. proteger o primeiro exercício elegível de cada muscle priority, até o limite
   `keepCount`;
4. preencher vagas pelos primeiros exercícios restantes, sem reordenar toda a
   sessão;
5. se o conjunto com pelo menos dois itens ainda contiver um único movement
   pattern enquanto existir outro na sessão, trocar o último item não protegido
   pelo primeiro omitido de padrão diferente;
6. emitir o resultado na ordem canônica, salvo a pequena antecipação de
   priority definida na regra própria.

Essa proteção usa `primaryMuscle`/movement pattern já existentes; não exige
`slotRole` nem classificação dos 2.108 slots.

## Composição

Duration e beginner calculam targets independentes sobre a mesma sessão-base; o
resultado usa o menor `keepCount`. Não multiplicar percentuais sequencialmente.
Durante Week 1/2, priority influencia preservação/ordem, mas nunca adiciona
sets. O estágio vem do contexto de geração; ausência significa Week 1 e Week 3+
normaliza para estágio 3.

`return_to_training` não ativa esta adaptação (DR-022). O fim do modifier não
promove o usuário para intermediate.
