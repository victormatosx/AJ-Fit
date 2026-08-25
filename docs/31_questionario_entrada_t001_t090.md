# Questionário — contrato de entrada para T001–T090 (Fase 2)

Este documento registra a auditoria, a redução de fricção e o contrato de
coleta preparado para o futuro motor. Ele **não** implementa seleção final de
Txxx, modificadores executáveis ou mutação dos templates.

## 1. Auditoria antes da Fase 2

Contagem aproximada de telas de pergunta no caminho `gym`, sem equipamentos
condicionais:

| Cenário anterior | Telas de pergunta |
|---|---:|
| padrão masculino | 15 |
| padrão feminino | 15 |
| gestação | 20 |
| pós-parto | 19 |
| limitação funcional | 16 |

As duas fontes principais de fricção eram: `limits` aparecia para todos antes
do roteador de saúde; gestação adicionava cinco telas consecutivas e pós-parto,
quatro. A auditoria também confirmou que `PlanReadyScreen` usa apenas dados
resumidos, não existe motor T001–T090 ativo no cliente, analytics registra IDs
estáveis de etapa (sem valores clínicos) e Firestore já aceita `answers` como
mapa imutável do dono.

## 2. Fluxo após a Fase 2

Ordem mental:

``` text
sobre você → objetivo → rotina → personalização → saúde → finalização
```

No caminho padrão `gym`, há 14 telas de pergunta. Gestação e pós-parto passam
a adicionar três telas cada (17 no total), agrupando campos relacionados sem
perder informação. Limitação funcional adiciona uma (15). Musculoesquelética
e pós-cirúrgico adicionam duas (16); lipedema, tontura/vertigem e restrição
médica adicionam uma cada (15). `home` soma equipamento; `both` soma ambiente
principal e equipamento. Múltiplos ramos somam suas telas e coexistem.

O roteador canônico oferece:

``` text
none
musculoskeletal_limitation
pregnancy
postpartum
lipedema
dizziness_or_vertigo
post_surgical
functional_limitation
medical_restriction
```

`none` é exclusivo. Gestação e pós-parto são mutuamente exclusivos. As demais
condições podem coexistir. `limits` e `limitationImpact` agora aparecem somente
no ramo `musculoskeletal_limitation`.

## 3. Pergunta → campo → finalidade → papel → ramo

| Tela/pergunta | Campo persistido | Finalidade futura | Papel | Condição |
|---|---|---|---|---|
| sexo | `sex` | compatibilidade de população | selector | comum |
| nascimento | `birthDate` | idade derivada, nunca fragilidade automática | context | comum |
| altura/peso | `height`, `weight` | contexto físico | context | comum |
| motivação | `motivation` | contexto de onboarding | funnel-only | comum anônimo |
| objetivo | `goal` | família/base futura | selector | comum |
| experiência | `level` | complexidade/dose futura | modifier P4 | comum |
| dias | `days` | frequência/base futura | selector | comum |
| duração | `duration` | orçamento temporal | modifier P5 | comum |
| local | `place` | ambiente base | selector | comum |
| ambiente principal | `primaryPlace` | resolver `both` | selector | `place=both` |
| equipamentos | `equipment[]` | viabilidade | modifier P3 | `home/both` |
| prioridade muscular | `muscleFocus[]` | ênfase, máximo 2 | preference P7 | comum |
| roteador de saúde | `specialConditions[]` | ativar ramos explícitos | router | comum |
| região limitada | `limits[]` | constraints de movimento | modifier P2 | musculoesquelética |
| impacto da limitação | `limitationImpact` | diferenciar desconforto/adaptação/restrição | safety/modifier | musculoesquelética |
| semanas | `pregnancyScreening.weeks` | contexto da população | selector/context | gestação |
| cuidados (agrupada) | `prenatalCare`, `exerciseRestriction`, `complication` | gate declarado | safety P0/P1 | gestação |
| sinais gestacionais | `warningSigns[]` | red flags declaradas | safety P0 | gestação |
| contexto pós-parto (agrupada) | `timeSinceBirth`, `deliveryType` | contexto de retorno | selector/context | pós-parto |
| sinais pós-parto | `signs[]` | red flags declaradas | safety P0/P1 | pós-parto |
| orientação de retorno | `returnClearance` | gate declarado | safety P0/P1 | pós-parto |
| situações funcionais | `functionalScreening.situations[]` | capacidade e apoio | safety/modifier P2 | funcional |
| lipedema (agrupada) | `symptomImpact`, `professionalGuidance` | separar rótulo, impacto e orientação | modifier P2 + safety | lipedema |
| tontura/vertigem (agrupada) | `symptomFrequency`, `affectsBalance` | distinguir histórico, atividade e equilíbrio | safety P0 + modifier P2 | tontura/vertigem |
| recuperação/liberação (agrupada) | `recoveryStatus`, `returnClearance` | gate restritivo | safety P0 + modifier | pós-cirúrgico |
| região operada | `bodyRegion` | contexto sem inferir procedimento | safety/modifier | pós-cirúrgico |
| restrição profissional | `professionalExerciseRestriction` | estruturar a opção genérica | safety P0 | restrição médica |
| compromisso | `commitment` | conclusão do onboarding | funnel-only | comum anônimo |

## 4. Shape persistido relevante

```ts
specialConditions: SpecialCondition[];
limits: string[];
limitationImpact: 'mild' | 'requires_adaptation' |
  'professional_restriction' | 'unknown' | null;

lipedemaScreening: {
  symptomImpact: 'none' | 'mild_or_occasional' |
    'interferes_with_exercises' | 'unknown' | null;
  professionalGuidance: 'no' | 'yes' | 'unsure' | null;
} | null;

dizzinessScreening: {
  symptomFrequency: 'history_only' | 'occasional' |
    'frequent' | 'current_or_recent' | null;
  affectsBalance: 'no' | 'yes' | 'unknown' | null;
} | null;

postSurgicalScreening: {
  recoveryStatus: 'completed' | 'in_progress' | 'unsure' | null;
  bodyRegion: string | null;
  returnClearance: 'cleared_no_restrictions' |
    'cleared_with_restrictions' | 'not_yet' | 'unsure' | null;
} | null;

medicalRestrictionScreening: {
  professionalExerciseRestriction: 'yes' | 'no' | 'unsure' | null;
} | null;
```

Gestação, pós-parto e funcional mantêm os objetos documentados na Fase 1.
`birthDate` é ISO no draft e `Timestamp` no Firestore. IDs são invariantes
entre pt-BR, en e es.

## 5. Limpeza, compatibilidade e segurança de dados

- Ao desmarcar um ramo, seu objeto e campos associados voltam a `null`/`[]`;
  dados ocultos não permanecem ativos.
- Trocar sexo para masculino remove gestação/pós-parto, preservando os demais
  ramos sem inferência.
- Rascunhos v1 cujo cursor estava nas telas antigas de cuidados gestacionais
  ou contexto pós-parto retomam nas telas agrupadas equivalentes.
- Questionários antigos e shapes esparsos continuam legíveis por defaults;
  `frequency`, `style`, objetivos/experiências legados e `age` continuam sob a
  política de compatibilidade existente.
- Orientação profissional de lipedema e liberação cirúrgica com restrições
  permanecem em seus domínios; não são convertidas silenciosamente em
  `medical_restriction`.
- A visão administrativa expõe todos os novos objetos de forma defensiva.
- Textos e opções existem em pt-BR, inglês e espanhol; valores persistidos não
  dependem do idioma.

## 6. Integração com o motor

O questionário continua sendo o contrato imutável de entrada. A implementação
do pipeline `QuestionnaireAnswers → safety → Txxx → modifiers → composition →
validation` está documentada em `docs/32_workout_prescription_engine.md`.
Regras ainda não formalizadas não são inferidas: o motor retorna um estado de
domínio explícito no ponto da lacuna.
