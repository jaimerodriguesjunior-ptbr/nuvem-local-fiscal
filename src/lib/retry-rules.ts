import type {
  DocumentEventRecord,
  DocumentStatus,
  SefazDocumentType
} from "../types.js";

export const AUTHORIZATION_RETRY_BACKOFF_MINUTES = [1, 5, 15] as const;
export const MAX_AUTHORIZATION_RETRY_ATTEMPTS =
  AUTHORIZATION_RETRY_BACKOFF_MINUTES.length;

export type AuthorizationRetryPlan = {
  retryable: boolean;
  reasonCode:
    | "retry_scheduled"
    | "terminal_status"
    | "processing_in_progress"
    | "rejected_requires_payload_review"
    | "deterministic_failure"
    | "attempt_limit_reached";
  message: string;
  attempt: number;
  nextRetryAt: string | null;
};

export function isUncertainAuthorizationFailure(message: string) {
  return /tempo esgotado|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket|corpo vazio|HTTP 5\d\d/i.test(
    message
  );
}

export function buildAuthorizationRetryPlan(input: {
  status: DocumentStatus;
  attempt: number;
  uncertainExternalState: boolean;
  now?: Date;
}): AuthorizationRetryPlan {
  const attempt = Math.max(0, Math.trunc(input.attempt));

  if (["autorizado", "cancelado"].includes(input.status)) {
    return blockedPlan("terminal_status", "Documento em status terminal nao entra em retry automatico.", attempt);
  }
  if (input.status === "processamento") {
    return blockedPlan("processing_in_progress", "Documento ainda esta em processamento.", attempt);
  }
  if (input.status === "rejeitado") {
    return blockedPlan(
      "rejected_requires_payload_review",
      "Rejeicao fiscal exige revisao do payload/regra antes de nova tentativa.",
      attempt
    );
  }
  if (!input.uncertainExternalState) {
    return blockedPlan(
      "deterministic_failure",
      "Falha deterministica nao deve ser repetida automaticamente.",
      attempt
    );
  }
  if (attempt >= MAX_AUTHORIZATION_RETRY_ATTEMPTS) {
    return blockedPlan(
      "attempt_limit_reached",
      "Limite de tentativas automaticas atingido.",
      attempt
    );
  }

  const retryDelayMinutes =
    AUTHORIZATION_RETRY_BACKOFF_MINUTES[Math.max(0, attempt - 1)] ??
    AUTHORIZATION_RETRY_BACKOFF_MINUTES[AUTHORIZATION_RETRY_BACKOFF_MINUTES.length - 1];
  const now = input.now ?? new Date();
  const nextRetryAt = new Date(now.getTime() + retryDelayMinutes * 60_000).toISOString();

  return {
    retryable: true,
    reasonCode: "retry_scheduled",
    message: `Retry seguro agendavel em ${retryDelayMinutes} minuto(s).`,
    attempt,
    nextRetryAt
  };
}

export function countAuthorizationAttempts(events: DocumentEventRecord[]) {
  return events.filter((event) => event.eventType === "authorization_attempt_started")
    .length;
}

export function buildDocumentRetryPlan(input: {
  status: DocumentStatus;
  events: DocumentEventRecord[];
  now?: Date;
}) {
  const lastFailure = [...input.events]
    .reverse()
    .find((event) => event.eventType === "authorization_attempt_failed");
  const uncertainExternalState =
    lastFailure?.payload.uncertainExternalState === true ||
    (typeof lastFailure?.message === "string" &&
      isUncertainAuthorizationFailure(lastFailure.message));

  return buildAuthorizationRetryPlan({
    status: input.status,
    attempt: countAuthorizationAttempts(input.events),
    uncertainExternalState,
    now: input.now
  });
}

export function retrySupportedForDocumentType(tipoDocumento: string): tipoDocumento is SefazDocumentType {
  return tipoDocumento === "NFe" || tipoDocumento === "NFCe";
}

function blockedPlan(
  reasonCode: AuthorizationRetryPlan["reasonCode"],
  message: string,
  attempt: number
): AuthorizationRetryPlan {
  return {
    retryable: false,
    reasonCode,
    message,
    attempt,
    nextRetryAt: null
  };
}
