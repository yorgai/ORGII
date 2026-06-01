/**
 * AskQuestionCard Types
 *
 * Shared types for the question card system: batch extraction,
 * selection state, and component props.
 */

export interface QuestionOption {
  id: string;
  label: string;
  description?: string;
}

export interface SingleQuestion {
  text: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

export interface QuestionBatch {
  chunkId: string;
  sessionId: string;
  questionId: string;
  questions: SingleQuestion[];
  blocking: boolean;
}

export interface AskQuestionCardProps {
  forceVisible?: boolean;
  collapsed?: boolean;
  onCollapse?: () => void;
  onHasDataChange?: (hasData: boolean) => void;
}

export const OPTION_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export const CUSTOM_OPTION_INDEX = -1;
