import type { PasswordRecoveryQuestion } from '@/api/auth';
import {
  type PasswordRecoveryAnswerDraft,
} from '@/lib/password-recovery';

export function PasswordRecoveryQuestionFields(props: {
  idPrefix: string;
  answers: PasswordRecoveryAnswerDraft[];
  questions: PasswordRecoveryQuestion[];
  inputClassName: string;
  disabled?: boolean;
  onQuestionKeyChange: (index: number, value: string) => void;
  onAnswerChange: (index: number, value: string) => void;
}) {
  const {
    idPrefix,
    answers,
    questions,
    inputClassName,
    disabled = false,
    onQuestionKeyChange,
    onAnswerChange,
  } = props;

  return (
    <div className="space-y-4">
      {answers.map((entry, index) => {
        const selectedInOtherRows = new Set(
          answers
            .map((answer, answerIndex) =>
              answerIndex === index ? '' : answer.questionKey,
            )
            .filter(Boolean),
        );

        return (
          <div
            key={`${idPrefix}-row-${index}`}
            className="rounded-xl border border-white/10 bg-white/5 p-3"
          >
            <label
              htmlFor={`${idPrefix}-question-${index}`}
              className="mb-1 block text-xs font-bold uppercase tracking-wider text-white/60"
            >
              Security question {index + 1}
            </label>
            <select
              id={`${idPrefix}-question-${index}`}
              value={entry.questionKey}
              onChange={(event) => onQuestionKeyChange(index, event.target.value)}
              disabled={disabled}
              className={inputClassName}
            >
              <option value="">Select a question</option>
              {questions.map((question) => (
                <option
                  key={question.key}
                  value={question.key}
                  disabled={
                    selectedInOtherRows.has(question.key) &&
                    question.key !== entry.questionKey
                  }
                >
                  {question.prompt}
                </option>
              ))}
            </select>

            <label
              htmlFor={`${idPrefix}-answer-${index}`}
              className="mt-3 mb-1 block text-xs font-bold uppercase tracking-wider text-white/60"
            >
              Answer
            </label>
            <input
              id={`${idPrefix}-answer-${index}`}
              type="text"
              autoComplete="off"
              value={entry.answer}
              onChange={(event) => onAnswerChange(index, event.target.value)}
              disabled={disabled}
              className={inputClassName}
            />
          </div>
        );
      })}
    </div>
  );
}
