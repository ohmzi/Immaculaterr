import type { PasswordRecoveryQuestion } from '@/api/auth';
import { type PasswordRecoveryAnswerDraft } from '@/lib/password-recovery';

const PASSWORD_RECOVERY_ROW_KEYS = ['first', 'second', 'third'] as const;

type PasswordRecoveryAnswerRow = {
  rowKey: string;
  rowIndex: number;
  entry: PasswordRecoveryAnswerDraft;
};

const toPasswordRecoveryRows = (
  answers: PasswordRecoveryAnswerDraft[],
): PasswordRecoveryAnswerRow[] => {
  const rows: PasswordRecoveryAnswerRow[] = [];
  for (let index = 0; index < answers.length; index += 1) {
    const entry = answers[index];
    if (!entry) continue;
    rows.push({
      rowKey: PASSWORD_RECOVERY_ROW_KEYS[index] ?? `row-${index + 1}`,
      rowIndex: index,
      entry,
    });
  }
  return rows;
};

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
  const answerRows = toPasswordRecoveryRows(answers);

  return (
    <div className="space-y-4">
      {answerRows.map(({ rowKey, rowIndex, entry }) => {
        const selectedInOtherRows = new Set(
          answers
            .map((answer, answerIndex) =>
              answerIndex === rowIndex ? '' : answer.questionKey,
            )
            .filter(Boolean),
        );

        return (
          <div
            key={`${idPrefix}-row-${rowKey}`}
            className="rounded-xl border border-white/10 bg-white/5 p-3"
          >
            <label
              htmlFor={`${idPrefix}-question-${rowIndex}`}
              className="mb-1 block text-xs font-bold uppercase tracking-wider text-white/60"
            >
              Security question {rowIndex + 1}
            </label>
            <select
              id={`${idPrefix}-question-${rowIndex}`}
              value={entry.questionKey}
              onChange={(event) =>
                onQuestionKeyChange(rowIndex, event.target.value)
              }
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
              htmlFor={`${idPrefix}-answer-${rowIndex}`}
              className="mt-3 mb-1 block text-xs font-bold uppercase tracking-wider text-white/60"
            >
              Answer
            </label>
            <input
              id={`${idPrefix}-answer-${rowIndex}`}
              type="text"
              autoComplete="off"
              value={entry.answer}
              onChange={(event) => onAnswerChange(rowIndex, event.target.value)}
              disabled={disabled}
              className={inputClassName}
            />
          </div>
        );
      })}
    </div>
  );
}
