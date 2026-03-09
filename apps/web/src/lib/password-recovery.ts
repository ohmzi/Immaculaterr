export const PASSWORD_RECOVERY_QUESTION_COUNT = 3;

export type PasswordRecoveryAnswerDraft = {
  questionKey: string;
  answer: string;
};

export function createEmptyPasswordRecoveryDrafts(): PasswordRecoveryAnswerDraft[] {
  return Array.from({ length: PASSWORD_RECOVERY_QUESTION_COUNT }, () => ({
    questionKey: '',
    answer: '',
  }));
}
