import assert from "node:assert/strict";
import test from "node:test";
import type { DocumentEventRecord } from "../types.js";
import {
  MAX_AUTHORIZATION_RETRY_ATTEMPTS,
  buildAuthorizationRetryPlan,
  buildDocumentRetryPlan,
  isUncertainAuthorizationFailure
} from "./retry-rules.js";

test("classifies uncertain external authorization failures", () => {
  assert.equal(isUncertainAuthorizationFailure("HTTP 500 na SEFAZ"), true);
  assert.equal(isUncertainAuthorizationFailure("ECONNRESET durante transmissao"), true);
  assert.equal(isUncertainAuthorizationFailure("socket hang up"), true);
  assert.equal(isUncertainAuthorizationFailure("Rejeicao 707: NFC-e interestadual"), false);
});

test("schedules retry with backoff for uncertain external errors", () => {
  const plan = buildAuthorizationRetryPlan({
    status: "erro",
    attempt: 2,
    uncertainExternalState: true,
    now: new Date("2026-07-02T12:00:00.000Z")
  });

  assert.equal(plan.retryable, true);
  assert.equal(plan.reasonCode, "retry_scheduled");
  assert.equal(plan.nextRetryAt, "2026-07-02T12:05:00.000Z");
});

test("blocks automatic retry for deterministic failures", () => {
  const plan = buildAuthorizationRetryPlan({
    status: "erro",
    attempt: 1,
    uncertainExternalState: false,
    now: new Date("2026-07-02T12:00:00.000Z")
  });

  assert.equal(plan.retryable, false);
  assert.equal(plan.reasonCode, "deterministic_failure");
  assert.equal(plan.nextRetryAt, null);
});

test("blocks automatic retry for rejected fiscal documents", () => {
  const plan = buildAuthorizationRetryPlan({
    status: "rejeitado",
    attempt: 1,
    uncertainExternalState: true,
    now: new Date("2026-07-02T12:00:00.000Z")
  });

  assert.equal(plan.retryable, false);
  assert.equal(plan.reasonCode, "rejected_requires_payload_review");
});

test("blocks automatic retry after attempt limit", () => {
  const plan = buildAuthorizationRetryPlan({
    status: "erro",
    attempt: MAX_AUTHORIZATION_RETRY_ATTEMPTS,
    uncertainExternalState: true,
    now: new Date("2026-07-02T12:00:00.000Z")
  });

  assert.equal(plan.retryable, false);
  assert.equal(plan.reasonCode, "attempt_limit_reached");
});

test("builds document retry plan from persisted events", () => {
  const events: DocumentEventRecord[] = [
    event("authorization_attempt_started", "Tentativa 1"),
    event("authorization_attempt_failed", "HTTP 503 temporario")
  ];

  const plan = buildDocumentRetryPlan({
    status: "erro",
    events,
    now: new Date("2026-07-02T12:00:00.000Z")
  });

  assert.equal(plan.retryable, true);
  assert.equal(plan.attempt, 1);
  assert.equal(plan.nextRetryAt, "2026-07-02T12:01:00.000Z");
});

function event(eventType: string, message: string): DocumentEventRecord {
  return {
    id: `evt_${eventType}`,
    documentId: "doc_retry",
    eventType,
    level: "info",
    message,
    payload: {},
    createdAt: "2026-07-02T12:00:00.000Z"
  };
}
