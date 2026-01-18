export type SSEFrame = {
  event?: string;
  data?: string;
  id?: string;
};

// We keep this intentionally loose: AG-UI events vary by type.
export type AGUIEvent = {
  type?: string;
  [key: string]: unknown;
};

export type ChatItemKind =
  | "user"
  | "assistant"
  | "tool_call"
  | "tool_result"
  | "interrupt"
  | "system";

export type ChatItem = {
  id: string;
  kind: ChatItemKind;
  createdAt: number;
  title?: string;
  text?: string;
  raw?: unknown;

  // Tool call
  toolCallId?: string;
  toolName?: string;
  toolArgsText?: string;

  // Tool result
  toolResultText?: string;

  // Interrupt
  interrupt?: {
    description?: string;
    action_request?: { action?: string; args?: unknown };
    config?: {
      allow_accept?: boolean;
      allow_edit?: boolean;
      allow_ignore?: boolean;
      allow_respond?: boolean;
    };
  };
};
