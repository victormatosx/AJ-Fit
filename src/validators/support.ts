export const SUPPORT_SUBJECT_MAX = 100;
export const SUPPORT_MESSAGE_MAX = 5000;

export function validateSupportTicket(subject: string, message: string) {
  const cleanSubject = subject.trim();
  const cleanMessage = message.trim();
  return {
    subject: cleanSubject,
    message: cleanMessage,
    subjectValid: cleanSubject.length >= 3 && cleanSubject.length <= SUPPORT_SUBJECT_MAX,
    messageValid: cleanMessage.length >= 10 && cleanMessage.length <= SUPPORT_MESSAGE_MAX,
  };
}
