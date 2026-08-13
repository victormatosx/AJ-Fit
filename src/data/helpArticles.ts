import type { HelpArticle, HelpCategory } from '../types/support';

export const HELP_CATEGORIES: HelpCategory[] = [
  'ACCOUNT', 'SUBSCRIPTION', 'ASSESSMENTS', 'WORKOUTS', 'SETTINGS', 'TECHNICAL', 'OTHER',
];

export const helpArticles: HelpArticle[] = [
  { id: 'change-profile', category: 'ACCOUNT', titleKey: 'articles.changeProfile.title', contentKey: 'articles.changeProfile.content' },
  { id: 'reset-password', category: 'ACCOUNT', titleKey: 'articles.resetPassword.title', contentKey: 'articles.resetPassword.content' },
  { id: 'manage-subscription', category: 'SUBSCRIPTION', titleKey: 'articles.manageSubscription.title', contentKey: 'articles.manageSubscription.content' },
  { id: 'assessment-estimate', category: 'ASSESSMENTS', titleKey: 'articles.assessmentEstimate.title', contentKey: 'articles.assessmentEstimate.content' },
  { id: 'change-workout', category: 'WORKOUTS', titleKey: 'articles.changeWorkout.title', contentKey: 'articles.changeWorkout.content' },
  { id: 'change-language', category: 'SETTINGS', titleKey: 'articles.changeLanguage.title', contentKey: 'articles.changeLanguage.content' },
  { id: 'app-not-loading', category: 'TECHNICAL', titleKey: 'articles.appNotLoading.title', contentKey: 'articles.appNotLoading.content' },
  { id: 'contact-support', category: 'OTHER', titleKey: 'articles.contactSupport.title', contentKey: 'articles.contactSupport.content' },
];

export interface HelpArticleRepository {
  list(): Promise<HelpArticle[]>;
}

export const localHelpArticleRepository: HelpArticleRepository = {
  async list() { return helpArticles; },
};
