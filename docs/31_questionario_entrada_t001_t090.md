# Questionário — contrato de entrada para T001–T090

Este documento registra a auditoria e o contrato de coleta preparado para o
futuro motor de seleção/modificadores. Ele **não** descreve nem implementa a
seleção final de templates.

## Auditoria do contrato anterior

- UI/fluxo: `src/screens/OnboardingFunnelScreen.tsx`,
  `src/components/onboarding/QuestionStepScreen.tsx`,
  `src/components/onboarding/QuestionRenderer.tsx`, `src/onboarding/steps.ts`
  e `src/onboarding/questionDefs.ts`.
- Estado/tipos: `Quiz` e `defaultQuiz` em `src/state/AppState.tsx`.
- Draft anônimo: AsyncStorage em `src/onboarding/draftStorage.ts`.
- Firestore: snapshots imutáveis em
  `users/{uid}/questionnaires/{questionnaireId}`, convertidos por
  `src/lib/questionnaireAnswers.ts` e gravados por
  `src/services/userProfile.ts`.
- Consumidores: `PlanReadyScreen` usa `goal`, `level`, `days` e `duration`;
  `AssessmentScreen` recebe o questionário; `EditProfileScreen` usa
  `birthDate`/`height`; a Cloud Function administrativa expõe os campos para
  consulta. Não existe motor T001–T090 ativo no cliente.
- Analytics usa IDs estáveis de etapa, nunca texto ou valor clínico. O logger
  ainda é no-op.
- Campos legados sem pergunta no funil atual: `frequency` e `style`. O antigo
  catálogo detalhado de `equipment` existe no componente não montado
  `EquipmentPicker`. Esses contratos permanecem legíveis.
- Valores legados preservados na leitura: objetivos `hyper/cut/perf/def/recon`,
  experiências `beg/int/adv/elite`, equipamentos detalhados e `age` (convertido
  em `birthDate`).
- Firestore Rules aceitam `answers` como mapa e já restringem o documento a
  criação imutável pelo dono; nenhum relaxamento de regra foi necessário.

## Shape atual (`Quiz` / `answers`)

```ts
{
  // profile
  sex: 'm' | 'f' | null;
  birthDate: Date | Timestamp | null;
  height: number;
  weight: number;

  // base selection (future engine)
  goal: PrimaryGoal | LegacyGoal | null;
  days: 2 | 3 | 4 | 5 | 6 | 7 | null;
  place: 'gym' | 'home' | 'both' | null;
  primaryPlace: 'gym' | 'home' | null;

  // modifiers
  level: ExperienceLevel | LegacyExperienceLevel | null;
  duration: '30' | '45' | '60' | '90' | null;
  equipment: string[];
  limits: string[];
  limitationImpact: 'mild' | 'requires_adaptation' |
    'professional_restriction' | 'unknown' | null;
  muscleFocus: string[]; // máximo 2

  // special population / safety
  specialConditions: Array<'none' | 'pregnancy' | 'postpartum' |
    'functional_limitation' | 'medical_restriction'>;
  pregnancyScreening: {
    weeks: number | null;
    prenatalCare: 'yes' | 'no' | null;
    exerciseRestriction: 'yes' | 'no' | null;
    complication: 'yes' | 'no' | 'unsure' | null;
    warningSigns: string[];
  } | null;
  postpartumScreening: {
    timeSinceBirth: string | null;
    deliveryType: string | null;
    signs: string[];
    returnClearance: string | null;
  } | null;
  functionalScreening: { situations: string[] } | null;

  // funnel only / legacy preserved
  motivation: string | null;
  commitment: string | null;
  frequency: string | null;
  style: string[];
}
```

No Firestore, `birthDate` é `Timestamp`; no draft é ISO string. Os demais IDs
são invariantes entre idiomas.

## Fluxo condicional

- Padrão: perguntas comuns + condição especial + prioridade muscular.
- `home`: inclui equipamentos.
- `both`: inclui ambiente principal e equipamentos.
- Limitação diferente de `none`: inclui impacto da limitação.
- `pregnancy`: semana, pré-natal, restrição profissional, complicação e sinais
  de alerta declarados.
- `postpartum`: tempo, tipo de parto, sinais e orientação de retorno.
- `functional_limitation`: situações funcionais declaradas.

`none` é exclusivo em todos os multi-selects. Gestação e pós-parto são estados
mutuamente exclusivos; cada um pode coexistir com restrição médica ou limitação
funcional. Trocar um roteador limpa deterministicamente o objeto condicional
que deixou de ser aplicável. Idade nunca ativa fragilidade.

O progresso usa somente as perguntas do caminho atualmente aplicável.

## Compatibilidade

Questionários v1 continuam sendo carregados com defaults nulos/vazios apenas
para campos ausentes. IDs antigos não são reclassificados ou inventados;
inclusive `elite` continua visível para consumidores de um documento antigo,
embora não seja oferecido na UI nova. `PlanReadyScreen` traduz tanto os IDs
canônicos quanto os legados.

O motor completo `QuestionnaireAnswers -> Txxx -> modifiers -> workout` não
faz parte desta etapa e permanece não implementado.
