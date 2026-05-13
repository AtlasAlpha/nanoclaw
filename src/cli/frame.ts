export type RequestFrame = {
  id: string;
  command: string;
  args: Record<string, unknown>;
};

export type ResponseFrame =
  | { id: string; ok: true; data: unknown }
  | { id: string; ok: false; error: { code: ErrorCode; message: string } };

export type ErrorCode =
  | 'unknown-command'
  | 'invalid-args'
  | 'permission-denied'
  | 'approval-pending'
  | 'not-found'
  | 'handler-error'
  | 'transport-error';

export type CallerContext =
  | { caller: 'host' }
  | {
      caller: 'agent';
      sessionId: string;
      agentGroupId: string;
      messagingGroupId: string;
    };
