# Fechamento simplificado do Prescription Engine V1

Status: `IMPLEMENTED` para beginner, duration, priority, trace e versionamento.
Limitation metadata continua fora do runtime. DR-004 está `RESOLVED_SCHEMA` e
DR-006 `REVIEW_QUEUE_READY`, sem aprovação clínica ou escrita Firestore.

## 1. Auditoria dos templates

A biblioteca v1.3.0 contém 90 templates, 378 sessões e 2.108 exercícios
prescritos. Todos os slots possuem correspondência no catálogo usado pela
auditoria. Sessões têm de 1 a 11 exercícios, média 5,58:

| Exercícios/sessão | Sessões |
|---:|---:|
| 1 | 20 |
| 2 | 20 |
| 3 | 16 |
| 4 | 34 |
| 5 | 93 |
| 6 | 76 |
| 7 | 60 |
| 8 | 18 |
| 9 | 35 |
| 10 | 2 |
| 11 | 4 |

## 2. Validação dos percentuais simples

| Regra | Média retida | Retenção real sobre 2.108 slots | Faixa final |
|---|---:|---:|---:|
| Beginner Week 1: `ceil(n×0,50)` | 3,09 | 55,4% | 1–6 |
| Beginner Week 2: `ceil(n×0,70)` | 4,39 | 78,7% | 1–8 |
| Duration 30: `ceil(n×0,60)` | 3,75 | 67,2% | 1–7 |
| Duration 45: `ceil(n×0,80)` | 4,80 | 86,1% | 1–9 |

A diferença entre fator e retenção real vem de `ceil`, intencionalmente
conservador em sessões curtas. 30 altera 338/378 sessões; 45 altera 288/378.
60/90 preservam 100%.

O prefixo calculado não produziu, em nenhuma das 378 sessões, um conjunto com
apenas um movement pattern quando a sessão completa tinha múltiplos. Portanto,
a ordem existente funciona como sinal principal. Ainda assim, a regra mantém
um guard mínimo de diversidade para futuras versões do catálogo.

A regra de +1 também encontra candidatos com sets numéricos sem metadata nova:

| Priority | Sessões elegíveis | Cobertura |
|---|---:|---:|
| chest | 168 | 44,4% |
| back | 226 | 59,8% |
| shoulders | 146 | 38,6% |
| arms | 119 | 31,5% |
| glutes | 123 | 32,5% |
| quads | 202 | 53,4% |
| hamstrings | 161 | 42,6% |

Ausência em uma sessão não é gap: a priority atua onde o músculo já existe e
não insere exercício novo.

## 3. Beginner V1

Beginner mantém o mesmo Txxx, conserva a dose de cada exercício retido e reduz
somente a lista: 50% na Week 1, 70% na Week 2 e base na Week 3+. Não há RIR,
redução de sets, duration ou cycles. `return_to_training` não ativa a regra.

## 4. Duration V1

30 mantém 60% e 45 mantém 80%, ambos com `ceil`; 60/90 mantêm a base. Trata-se
de preferência aproximada, não promessa de minutos. Sem timing engine.

Se uma sessão curta não perder item por arredondamento, reduzir um único set do
último exercício com sets >1. Se não existir, preservar. Nunca modificar strings
de duration/cycles como fallback.

## 5. Retenção por ordem

Partir da ordem canônica já segura, proteger o primeiro exercício e um candidato
por priority, preencher pelas primeiras posições e aplicar apenas um guard de
diversidade quando todos os retidos tiverem o mesmo movement pattern. Não
classificar slots nem reorganizar completamente a sessão.

## 6. Priority V1

Para até duas prioridades:

1. marcar o primeiro exercício cujo `primaryMuscle` corresponde à priority;
2. protegê-lo nas reduções e antecipá-lo de forma estável quando necessário;
3. fora de beginner/30, adicionar no máximo +1 set nesse exercício elegível;
4. em 45, adicionar somente se a sessão não foi reduzida;
5. em 60/90, adicionar se existir candidato com sets numéricos.

Não há +20%, budget, donors, receivers, maiores restos, round-robin ou
invariância semanal de sets.

## 7. Composição combinada

```text
Questionnaire → Safety → Select Txxx → limitations/equipment
→ priority signal → duration → beginner
→ priority ordering/extra set → validation → snapshot
```

O signal de priority vem antes das reduções para proteger itens; o volume extra
vem depois para respeitar beginner/duration.

## 8. Simulações

- T002: uma sessão de 6 itens vira 3 na Week 1 e 5 na Week 2; os sets dos itens
  retidos permanecem iguais.
- T003, male hypertrophy 4d, beginner, 30, chest: seleciona T003; protege chest;
  calcula 60% e 50% sobre a base e usa o menor target; não adiciona set.
- T004, intermediate, 60, chest+back: preserva/antecipa um exercício de cada e
  pode adicionar +1 set a cada candidato elegível.
- T016, female hypertrophy 5d, gym, intermediate, 60, glutes+quads: T016 é o
  template correto; 60 não reduz e cada priority pode receber +1 set elegível.
- Conditioning com `8-10 ciclos`: mantém `8-10 ciclos` em todas as semanas; só
  a presença do exercício na sessão pode mudar.
- T073 e demais populações especiais: safety/population continuam antes de
  qualquer personalização cosmética.

## 9. Edge cases reais

- sessões de 1 item não podem perder exercício; duration pode usar fallback de
  um set somente quando houver sets >1;
- sessões de 2 itens não reduzem em 30/45 por `ceil`; o mesmo fallback evita
  remover metade da estrutura;
- se priority não existe na sessão, não inserir exercício novo;
- quando duas priorities competem por target pequeno, preservar primeiro o
  exercício inicial e depois priorities na ordem declarada até preencher;
- limitation/equipment removem candidatos antes do signal; eles nunca voltam.

## 10. Complexidade retirada

Foram retirados do contrato V1: RIR, effort targets, dose normalizada obrigatória,
scaling de duration/cycles, timing preciso, estimativa matemática, `slotRole`,
classificação de 2.108 slots, compression loops, budget +20%, donors/receivers,
maiores restos, round-robin e capacity metadata.

## 11. Blockers restantes

Somente safety/limitations continuam materialmente bloqueados por dados e
implementação: DR-004 tem schema fechado, mas não implementado; DR-006 possui
300 pares M+U na fila profissional. Persistence, Schedule e Progression são
fases próprias, não requisitos para o modifier V1.
