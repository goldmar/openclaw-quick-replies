export type QuickReplyConfig = {
  enabled: boolean;
  maxSuggestions: number;
  minConfidence: number;
  model?: string;
  maxInputChars: number;
  maxLabelChars: number;
  maxValueBytes: number;
  evaluationTimeoutMs: number;
  updateChecks: boolean;
};

export type QuickReplySuggestion = {
  label: string;
  value: string;
};

export type QuickReplyDecision = {
  eligible: boolean;
  confidence: number;
  suggestions: QuickReplySuggestion[];
  reason?: string;
};

export type QuickReplyDiagnosticReason =
  | "disabled"
  | "unsupported_channel"
  | "empty_text"
  | "input_budget"
  | "non_plain_text"
  | "existing_interactivity"
  | "not_explicit_ask"
  | "evaluator_unavailable"
  | "evaluator_denied"
  | "evaluator_error"
  | "evaluator_timeout"
  | "evaluator_invalid_json"
  | "evaluator_invalid_decision"
  | "no_decision";

export type QuickReplyEvaluationResult = {
  decision: QuickReplyDecision | null;
  failureReason?: QuickReplyDiagnosticReason;
};

export type QuickReplyEvaluationInput = {
  text: string;
  channel: "telegram";
  sessionKey?: string;
  runId?: string;
  messageId?: string;
  maxSuggestions: number;
  maxLabelChars: number;
  maxValueBytes: number;
};

export type QuickReplyEvaluator = {
  evaluate: (input: QuickReplyEvaluationInput) => Promise<QuickReplyEvaluationResult>;
};
