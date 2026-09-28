export type SupportTicketType = 'BUG' | 'FEEDBACK' | 'SUPPORT';
export type FeedbackCategory = 'SUGGESTION' | 'IDEA' | 'COMPLIMENT' | 'OTHER';

export type SupportAttachmentInput = {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
};

export type CreateSupportTicketInput = {
  userId: string;
  userName: string;
  userEmail: string;
  type: SupportTicketType;
  subject: string;
  message: string;
  attachment?: SupportAttachmentInput | null;
};

export type HelpCategory =
  | 'ACCOUNT'
  | 'SUBSCRIPTION'
  | 'ASSESSMENTS'
  | 'WORKOUTS'
  | 'SETTINGS'
  | 'TECHNICAL'
  | 'OTHER';

export type HelpArticle = {
  id: string;
  category: HelpCategory;
  titleKey: string;
  contentKey: string;
};
