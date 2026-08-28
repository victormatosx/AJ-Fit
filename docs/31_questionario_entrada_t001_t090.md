# Questionário — contrato de entrada para T001–T090 (Fase 2)

Este documento registra a auditoria, a redução de fricção e o contrato de
coleta consumido pelo motor atual. O questionário não seleciona Txxx nem aplica
modificadores por conta própria; essa responsabilidade pertence ao pipeline
documentado em `32_workout_prescription_engine.md`.

Status deste documento: o contrato descrito nas seções 1–6 está
`IMPLEMENTED`; as extensões da seção 7 estão explicitamente separadas como
`FUTURE_DESIGN` ou `DECISION_REQUIRED`. A legenda comum está em
`workout-lifecycle/00_README.md`.

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
resumidos e não existia motor T001–T090 ativo no cliente naquele momento;
analytics registra IDs
estáveis de etapa (sem valores clínicos) e Firestore já aceita `answers` como
mapa imutável do dono.

## 2. Fluxo após a Fase 2

Ordem mental:

``` text
sobre você → objetivo → rotina → personalização → saúde → finalização
```

No caminho padrão `gym`, há 14 telas de pergunta. Gestação e pós-parto passam
a adicionar três telas cada (17 no total), agrupando campos relacionados sem
perder informação. Limitação funcional, musculoesquelética, pós-cirúrgico,
lipedema, tontura/vertigem e restrição médica adicionam uma tela cada (15).
`home` soma equipamento; `both` soma ambiente principal e equipamento.
Múltiplos ramos somam suas telas e coexistem.

Musculoesquelética não possui mais uma segunda tela de "impacto da
limitação" (`limitationImpact`, removida). Selecionar uma ou mais regiões em
`limits[]` já é suficiente para ativar automaticamente a adaptação daquela(s)
região(ões) — ver seção 3 e `docs/32_workout_prescription_engine.md`.

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
condições podem coexistir. `limits` aparece somente no ramo
`musculoskeletal_limitation`.

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
| região limitada | `limits[]` | constraints de movimento; ativa adaptação automaticamente | safety/modifier P0 | musculoesquelética |
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

## 7. Extensões aprovadas para coleta futura

Estas extensões não existem no fluxo atual e não devem ser lidas de campos
aproximados:

| Extensão | Papel | Status | Decisão pendente |
|---|---|---|---|
| `deliveryDate` no ramo pós-parto | derivar tempo sem inferir recuperação | `APPROVED_NOT_IMPLEMENTED` | momento em DR-007 |
| pergunta explícita de reavaliação pós-parto | informar novo safety/lifecycle gate | `APPROVED_NOT_IMPLEMENTED` | texto/opções e saída em DR-020/DR-008 |

`trainingDays` (dias da semana preferidos após `days`) deixou de ser uma
extensão futura: está `IMPLEMENTED` como entrada do Schedule Engine (DR-017
`RESOLVED_V1`, `workout-lifecycle/03_SCHEDULE_ENGINE.md`). Campo persistido:

```ts
trainingDays: ('MON'|'TUE'|'WED'|'THU'|'FRI'|'SAT'|'SUN')[] | null;
```

Para frequência de 2 a 6, a pergunta `trainingDays` exige exatamente a
quantidade declarada em `days`, sem duplicatas; para 7, a pergunta é pulada e
os sete IDs são preenchidos automaticamente. Valores são sempre normalizados
para ordem cronológica canônica (nunca ordem de clique) e são independentes
de idioma. Questionários antigos sem este campo carregam `null` — o Schedule
Engine trata isso como `SCHEDULE_SETUP_REQUIRED`, nunca como uma preferência
inventada. Essa preferência não muda a identidade das sessões A/B/C e não
pertence ao Selection Engine; `trainingDaysValid()` é um gate próprio do
Schedule Engine, deliberadamente fora de `questionnaireValidationErrors` — a
ausência de `trainingDays` nunca bloqueia a geração da prescrição.

`deliveryDate` é o nome proposto para não colidir com `birthDate`, que representa
o nascimento da usuária. A data do parto e qualquer autodeclaração de prontidão são contexto. Elas não
neutralizam sinais, restrições profissionais, ausência de liberação ou outro
Safety Gate. Consulte `workout-lifecycle/03_SCHEDULE_ENGINE.md` e
`workout-lifecycle/06_REASSESSMENT.md`.
