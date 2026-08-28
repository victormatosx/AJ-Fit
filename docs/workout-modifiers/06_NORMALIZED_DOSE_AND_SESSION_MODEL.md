# Modelo simplificado de sessão e dose — V1

Status: `IMPLEMENTED` em `src/workoutPrescription/`, sem normalização complexa.

## 1. Princípio

O Prescription Engine V1 não precisa normalizar toda dose nem estimar duração
matematicamente. Os T001–T090 permanecem a fonte da prescrição interna de cada
exercício. O motor escolhe e omite exercícios; modifica sets somente pela regra
simples de priority ou pelo fallback de duration.

## 2. Dados legados preservados

| Forma encontrada | Slots | Tratamento V1 |
|---|---:|---|
| sets + reps | 1.802 | preservar; permitir +1 ou fallback −1 quando elegível |
| duration em minutos | 160 | preservar string/base |
| duration em segundos | 88 | preservar string/base |
| cycles + work/recovery | 24 | preservar string/base |
| sets + distância | 20 | preservar; sets seguem apenas regras explícitas |
| sets + duration por set | 14 | preservar; sets seguem apenas regras explícitas |

Normalização futura pode melhorar execução, analytics ou persistência, mas não
é pré-requisito de seleção/adaptação V1. Não criar parser obrigatório somente
para reduzir beginner ou duration.

## 3. Beginner

```text
Week 1 = keep ceil(sessionExercises × 0.50)
Week 2 = keep ceil(sessionExercises × 0.70)
Week 3+ = keep all
```

Os exercícios retidos mantêm sua dose interna. Não reduzir sets, segundos,
metros, ciclos ou intervalos. Não aplicar RIR.

## 4. Duration aproximada

```text
30 = keep ceil(sessionExercises × 0.60)
45 = keep ceil(sessionExercises × 0.80)
60/90 = keep all
```

Não estimar segundos, descanso, setup ou transições. Quando `ceil` mantém todos
os itens de uma sessão curta e ainda se deseja redução, diminuir exatamente um
set do último exercício elegível com sets numéricos maiores que 1. Sem exercício
elegível, preservar a sessão; não alterar duration/cycles.

## 5. Regra de retenção

A ordem do template é o sinal principal:

1. proteger o primeiro item;
2. proteger o primeiro item de cada muscle priority que caiba no target;
3. preencher pelas posições canônicas iniciais;
4. somente se os retidos tiverem um único movement pattern e houver outro,
   trocar o último não protegido pelo primeiro omitido diferente;
5. nunca reintroduzir item removido por safety, limitation ou equipment.

Não existe `slotRole`, timing profile, donor/receiver pool ou classificação
manual dos 2.108 slots.

## 6. Muscle priority

Priority tem duas fases simples:

- sinal: preservar e antecipar o primeiro exercício relevante de cada uma das
  até duas prioridades;
- volume extra: +1 set no primeiro exercício relevante com sets numéricos, no
  máximo uma vez por priority por sessão.

Não adicionar sets em Beginner Week 1/2 ou em 30 minutos. Em 45 minutos, só
adicionar quando a sessão não precisou remover exercício nem usar fallback. Em
60/90, aplicar quando houver candidato elegível. Sem candidato, apenas
preservar/ordenar e registrar o motivo.

## 7. Pipeline e determinismo

```text
Questionnaire → Safety → Select immutable Txxx
→ limitations/equipment → compute priority signal
→ duration reduction → beginner reduction
→ priority ordering/eligible extra set → final validation → snapshot
```

Duration e beginner produzem targets independentes a partir da base e o motor
usa o menor. Priority signal é calculado antes da seleção; volume extra é
avaliado depois. Todas as etapas partem da sessão resolvida e dos mesmos inputs,
garantindo idempotência.

## 8. Invariantes V1

- safety/limitations/equipment sempre vencem;
- mesmas entradas e versões produzem a mesma saída;
- ao menos um exercício permanece em sessão-base não vazia;
- exercício retido preserva sua dose, salvo +1 priority ou fallback −1 duration;
- nenhum set numérico fica abaixo de 1;
- duas priorities geram no máximo +2 sets por sessão;
- 30 minutos e Beginner Week 1/2 nunca adicionam sets;
- 90 minutos não adicionam exercícios;
- `return_to_training` não ativa beginner;
- `unknown` nunca significa `compatible`.
