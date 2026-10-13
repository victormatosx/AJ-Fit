import ptBRCommon from './resources/pt-BR/common.json';
import enCommon from './resources/en/common.json';
import esCommon from './resources/es/common.json';
import ptBRSettings from './resources/pt-BR/settings.json';
import enSettings from './resources/en/settings.json';
import esSettings from './resources/es/settings.json';
import ptBRErrors from './resources/pt-BR/errors.json';
import enErrors from './resources/en/errors.json';
import esErrors from './resources/es/errors.json';
import ptBROnboarding from './resources/pt-BR/onboarding.json';
import enOnboarding from './resources/en/onboarding.json';
import esOnboarding from './resources/es/onboarding.json';
import ptBRQuiz from './resources/pt-BR/quiz.json';
import enQuiz from './resources/en/quiz.json';
import esQuiz from './resources/es/quiz.json';
import ptBRPlan from './resources/pt-BR/plan.json';
import enPlan from './resources/en/plan.json';
import esPlan from './resources/es/plan.json';
import ptBRHome from './resources/pt-BR/home.json';
import enHome from './resources/en/home.json';
import esHome from './resources/es/home.json';
import ptBRProfile from './resources/pt-BR/profile.json';
import enProfile from './resources/en/profile.json';
import esProfile from './resources/es/profile.json';
import ptBRWorkout from './resources/pt-BR/workout.json';
import enWorkout from './resources/en/workout.json';
import esWorkout from './resources/es/workout.json';
import ptBRAssessment from './resources/pt-BR/assessment.json';
import enAssessment from './resources/en/assessment.json';
import esAssessment from './resources/es/assessment.json';
import ptBRAuth from './resources/pt-BR/auth.json';
import enAuth from './resources/en/auth.json';
import esAuth from './resources/es/auth.json';
import ptBRSupport from './resources/pt-BR/support.json';
import enSupport from './resources/en/support.json';
import esSupport from './resources/es/support.json';
import ptBRMyPlan from './resources/pt-BR/myPlan.json';
import enMyPlan from './resources/en/myPlan.json';
import esMyPlan from './resources/es/myPlan.json';
import ptBREvolution from './resources/pt-BR/evolution.json';
import enEvolution from './resources/en/evolution.json';
import esEvolution from './resources/es/evolution.json';
import ptBRNotifications from './resources/pt-BR/notifications.json';
import enNotifications from './resources/en/notifications.json';
import esNotifications from './resources/es/notifications.json';
import ptBRTreino from './resources/pt-BR/treino.json';
import enTreino from './resources/en/treino.json';
import esTreino from './resources/es/treino.json';
import ptBRNutrition from './resources/pt-BR/nutrition.json';
import enNutrition from './resources/en/nutrition.json';
import esNutrition from './resources/es/nutrition.json';
import ptBRHealth from './resources/pt-BR/health.json';
import enHealth from './resources/en/health.json';
import esHealth from './resources/es/health.json';

/** Single runtime registry used by bootstrap, parity tests and audits. */
export const resources = {
  'pt-BR': {
    common: ptBRCommon,
    settings: ptBRSettings,
    errors: ptBRErrors,
    onboarding: ptBROnboarding,
    quiz: ptBRQuiz,
    plan: ptBRPlan,
    home: ptBRHome,
    profile: ptBRProfile,
    workout: ptBRWorkout,
    assessment: ptBRAssessment,
    auth: ptBRAuth,
    support: ptBRSupport,
    myPlan: ptBRMyPlan,
    evolution: ptBREvolution,
    notifications: ptBRNotifications,
    treino: ptBRTreino,
    nutrition: ptBRNutrition,
    health: ptBRHealth,
  },
  en: {
    common: enCommon,
    settings: enSettings,
    errors: enErrors,
    onboarding: enOnboarding,
    quiz: enQuiz,
    plan: enPlan,
    home: enHome,
    profile: enProfile,
    workout: enWorkout,
    assessment: enAssessment,
    auth: enAuth,
    support: enSupport,
    myPlan: enMyPlan,
    evolution: enEvolution,
    notifications: enNotifications,
    treino: enTreino,
    nutrition: enNutrition,
    health: enHealth,
  },
  es: {
    common: esCommon,
    settings: esSettings,
    errors: esErrors,
    onboarding: esOnboarding,
    quiz: esQuiz,
    plan: esPlan,
    home: esHome,
    profile: esProfile,
    workout: esWorkout,
    assessment: esAssessment,
    auth: esAuth,
    support: esSupport,
    myPlan: esMyPlan,
    evolution: esEvolution,
    notifications: esNotifications,
    treino: esTreino,
    nutrition: esNutrition,
    health: esHealth,
  },
} as const;

export const DEFAULT_NAMESPACE = 'common';
export const NAMESPACES = Object.keys(resources['pt-BR']) as Array<
  keyof typeof resources['pt-BR']
>;

export type I18nNamespace = (typeof NAMESPACES)[number];
