import { findTemplate } from './catalog';
import { environmentFor, goalFamilyFor } from './input';
import type { Population, QuestionnaireAnswers, SelectionDecision } from './types';

export type SelectionResult =
  | { status: 'SELECTED'; decision: SelectionDecision }
  | { status: 'MISSING_TEMPLATE'; reasonCodes: string[] };

function populationFor(answers: QuestionnaireAnswers): Population {
  const has = (condition: QuestionnaireAnswers['specialConditions'][number]) =>
    answers.specialConditions.includes(condition);
  if (has('pregnancy')) return 'pregnancy';
  if (has('postpartum')) return 'postpartum';
  if (
    has('functional_limitation')
    && (answers.functionalScreening?.situations.some((value) => value !== 'none') ?? false)
  ) return 'frailty';
  return 'conventional';
}

export function selectTemplate(answers: QuestionnaireAnswers): SelectionResult {
  const population = populationFor(answers);
  const environment = environmentFor(answers);
  const goalFamily = goalFamilyFor(answers.goal);
  if (!answers.sex || !environment || !goalFamily || !answers.days) {
    return { status: 'MISSING_TEMPLATE', reasonCodes: ['SELECTION_DIMENSION_MISSING'] };
  }
  const prescribedStructuredDays = population === 'conventional'
    ? answers.days
    : Math.min(answers.days, 4);
  const template = findTemplate({
    population,
    sex: answers.sex === 'm' ? 'male' : 'female',
    environment,
    goalFamily,
    days: prescribedStructuredDays,
  });
  if (!template) {
    return {
      status: 'MISSING_TEMPLATE',
      reasonCodes: [
        `NO_TEMPLATE:${population}:${answers.sex}:${environment}:${goalFamily}:${prescribedStructuredDays}`,
      ],
    };
  }
  return {
    status: 'SELECTED',
    decision: {
      templateId: template.id,
      requestedDays: answers.days,
      prescribedStructuredDays,
      population,
      environment,
      goalFamily,
      reasons: [
        `population:${population}`,
        `sex:${template.profile.sex}`,
        `goal_family:${template.profile.primary_goal}`,
        `environment:${environment}`,
        `structured_days:${prescribedStructuredDays}`,
        ...(answers.days !== prescribedStructuredDays ? [`requested_days:${answers.days}`] : []),
      ],
    },
  };
}
