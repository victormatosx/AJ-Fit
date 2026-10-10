/**
 * Module augmentation for i18next — pt-BR is the reference locale.
 *
 * Every language must ship the same key set; TypeScript picks pt-BR as the
 * shape source so calling `t('common:foo.bar')` with a nonexistent key
 * fails at compile time and IDE autocomplete surfaces the tree.
 *
 * If en or es diverge from pt-BR in shape, the runtime falls back to the
 * missing key emitting the key string — the structural test suite in
 * `src/lib/__tests__/i18n.test.ts` catches that so it never ships.
 */
import 'i18next';
import type ptBRCommon from './resources/pt-BR/common.json';
import type ptBRSettings from './resources/pt-BR/settings.json';
import type ptBRErrors from './resources/pt-BR/errors.json';
import type ptBROnboarding from './resources/pt-BR/onboarding.json';
import type ptBRQuiz from './resources/pt-BR/quiz.json';
import type ptBRPlan from './resources/pt-BR/plan.json';
import type ptBRHome from './resources/pt-BR/home.json';
import type ptBRProfile from './resources/pt-BR/profile.json';
import type ptBRWorkout from './resources/pt-BR/workout.json';
import type ptBRAssessment from './resources/pt-BR/assessment.json';
import type ptBRAuth from './resources/pt-BR/auth.json';
import type ptBRSupport from './resources/pt-BR/support.json';
import type ptBRMyPlan from './resources/pt-BR/myPlan.json';
import type ptBREvolution from './resources/pt-BR/evolution.json';
import type ptBRNotifications from './resources/pt-BR/notifications.json';
import type ptBRTreino from './resources/pt-BR/treino.json';
import type ptBRNutrition from './resources/pt-BR/nutrition.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: {
      common: typeof ptBRCommon;
      settings: typeof ptBRSettings;
      errors: typeof ptBRErrors;
      onboarding: typeof ptBROnboarding;
      quiz: typeof ptBRQuiz;
      plan: typeof ptBRPlan;
      home: typeof ptBRHome;
      profile: typeof ptBRProfile;
      workout: typeof ptBRWorkout;
      assessment: typeof ptBRAssessment;
      auth: typeof ptBRAuth;
      support: typeof ptBRSupport;
      myPlan: typeof ptBRMyPlan;
      evolution: typeof ptBREvolution;
      notifications: typeof ptBRNotifications;
      treino: typeof ptBRTreino;
      nutrition: typeof ptBRNutrition;
    };
    returnNull: false;
  }
}
