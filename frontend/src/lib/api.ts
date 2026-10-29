export interface ApiEnvelope<T> {
  message: string;
  data: T;
  success: boolean;
}

export interface ApiErrorBody {
  message: string;
  success: boolean;
  code?: string;
}

import { expireSession } from "./session.ts";
import type { CreateDealInput } from "./prepared-deal.ts";

export class ApiRequestError extends Error {
  public status: number;
  public code: string | undefined;

  constructor(
    status: number,
    code: string | undefined,
    message: string,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "ApiRequestError";
  }
}

export class ApiUnreachableError extends Error {
  constructor() {
    super("The OpenDeal API could not be reached. Check that it is running.");
    this.name = "ApiUnreachableError";
  }
}

const API_BASE_URL: string = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export type DealStatus =
  | "draft"
  | "agreed"
  | "awaiting_payment"
  | "funded"
  | "shipped"
  | "accepted"
  | "settled"
  | "cancelled"
  | "disputed"
  | "refunded"
  | "expired";

export type SettlementPurpose = "payout_seller" | "refund_buyer";

export type SettlementPhase =
  | "none"
  | "proposed"
  | "broadcasting"
  | "broadcast"
  | "broadcast_unknown"
  | "broadcast_rejected"
  | "confirmed";

export interface Deal {
  id: string;
  status: DealStatus | string;
  title: string;
  amount_sats: number;
  currency: string;
  seller_pubkey: string;
  buyer_pubkey: string;
  mediator_pubkey: string;
  settlement_model: string;
  network: string;
  escrow_address: string | null;
  funding_txid: string | null;
  funding_vout: number | null;
  funding_amount_sats: number | null;
  settlement_txid: string | null;
  current_psbt: string | null;
  settlement_purpose: SettlementPurpose | null;
  settlement_proposal: string | null;
  settlement_phase: SettlementPhase;
  settlement_confirmations: number;
  settlement_block_hash: string | null;
  settlement_from_status: DealStatus | string | null;
  broadcast_attempted_at: string | null;
  delivery_deadline: string;
  acceptance_window_hours: number;
  created_at: string;
  updated_at: string;
}

export interface DealEvent {
  agreement_id: string;
  sequence: number;
  kind: string;
  payload: unknown;
  actor_pubkey: string;
  prev_event_hash: string;
  created_at: string;
}

export interface DealReceipt {
  agreement_id: string;
  status: string;
  settlement_model: string;
  network: string;
  funding_txid: string | null;
  settlement_txid: string | null;
  events: DealEvent[];
}

// === Transport

let apiUnreachableHandler: (() => void) | null = null;

export function setApiUnreachableHandler(handler: (() => void) | null): void {
  apiUnreachableHandler = handler;
}

function buildHeaders(token: string | null, extra?: HeadersInit): HeadersInit {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return { ...headers, ...extra };
}

async function sendApiRequest(
  path: string,
  init: RequestInit | undefined,
  token: string | null,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: buildHeaders(token, init?.headers),
    });
  } catch {
    apiUnreachableHandler?.();
    throw new ApiUnreachableError();
  }

  if (response.ok) {
    return response;
  }
  if (response.status === 401 && token) {
    expireSession(token);
  }
  let body: ApiErrorBody;
  try {
    body = await response.json();
  } catch {
    throw new ApiRequestError(response.status, undefined, response.statusText);
  }
  throw new ApiRequestError(response.status, body.code, body.message);
}

async function readEnvelope<T>(response: Response): Promise<T> {
  const envelope: ApiEnvelope<T> = await response.json();
  return envelope.data;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return readEnvelope<T>(await sendApiRequest(path, init, null));
}

export async function authedApiFetch<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  return readEnvelope<T>(await sendApiRequest(path, init, token));
}

export interface AgreementView {
  agreement: {
    version: number;
    title: string;
    description?: string;
    seller_payout_address?: string;
    buyer_refund_address?: string;
    amount_sats: number;
    currency: string;
    seller_pubkey: string;
    buyer_pubkey: string;
    mediator_pubkey: string;
    delivery_deadline: string;
    acceptance_window_hours: number;
    settlement_model: string;
    network: string;
    created_at: string;
  };
  canonical_hex: string;
  signed_pubkeys: string[];
}

export interface AuthSession {
  token: string;
  pubkey: string;
}

export interface PublicMeta {
  demo_enabled: boolean;
  network: string;
  settlement_model: string;
  custody: string;
  pilot_max_amount_sats: number | null;
  required_confirmations: number;
  rate_limit_per_minute: number;
  bitcoin_max_fee_sats: number;
  bitcoin_max_fee_bps: number;
}

export interface Reputation {
  pubkey: string;
  deals_as_seller: number;
  deals_as_buyer: number;
  settled: number;
  refunded: number;
  disputed: number;
}

export function getReputation(pubkey: string): Promise<Reputation> {
  return apiFetch<Reputation>(`/api/v1/deals/reputation/${encodeURIComponent(pubkey)}`);
}

export function getMeta(): Promise<PublicMeta> {
  return apiFetch<PublicMeta>("/api/v1/meta");
}

export function getDeal(token: string, id: string): Promise<Deal> {
  return authedApiFetch<Deal>(token, `/api/v1/deals/${id}`);
}

export function getAgreement(token: string, id: string): Promise<AgreementView> {
  return authedApiFetch<AgreementView>(token, `/api/v1/deals/${id}/agreement`);
}

export function signAgreement(
  token: string,
  id: string,
  signature: { sig: string; pubkey: string },
): Promise<Deal> {
  return authedApiFetch<Deal>(token, `/api/v1/deals/${id}/sign`, {
    method: "POST",
    body: JSON.stringify({ signature }),
  });
}

export function requestNostrChallenge(pubkey: string): Promise<{ nonce: string; expires_at: string }> {
  return apiFetch(`/api/v1/auth/nostr/challenge`, {
    method: "POST",
    body: JSON.stringify({ pubkey }),
  });
}

export function nostrLogin(event: unknown): Promise<AuthSession> {
  return apiFetch<AuthSession>(`/api/v1/auth/nostr/login`, {
    method: "POST",
    body: JSON.stringify({ event }),
  });
}

export function createDeal(
  token: string,
  input: CreateDealInput,
  idempotencyKey?: string,
): Promise<Deal> {
  return authedApiFetch<Deal>(token, "/api/v1/deals", {
    method: "POST",
    headers: idempotencyKey ? {"Idempotency-Key": idempotencyKey} : undefined,
    body: JSON.stringify(input),
  });
}

export function transitionDeal(token: string, id: string, to: DealStatus): Promise<Deal> {
  return authedApiFetch<Deal>(token, `/api/v1/deals/${id}/transition`, {
    method: "POST",
    body: JSON.stringify({ to }),
  });
}

export interface FundingInstructions {
  address: string;
  script_pubkey_hex: string;
  witness_script_hex: string;
  expected_amount_sats: number;
  required_confirmations: number;
  network: string;
  settlement_model: string;
}

export function getFundingInstructions(token: string, id: string): Promise<FundingInstructions> {
  return authedApiFetch<FundingInstructions>(token, `/api/v1/deals/${id}/funding`);
}

export function prepareFunding(token: string, id: string): Promise<Deal> {
  return authedApiFetch<Deal>(token, `/api/v1/deals/${id}/funding/prepare`, {
    method: "POST",
  });
}

export function verifyFunding(token: string, id: string): Promise<Deal> {
  return authedApiFetch<Deal>(token, `/api/v1/deals/${id}/funding/verify`, {
    method: "POST",
  });
}

export function getEvents(token: string, id: string): Promise<DealEvent[]> {
  return authedApiFetch<DealEvent[]>(token, `/api/v1/deals/${id}/events`);
}

export function getReceipt(token: string, id: string): Promise<DealReceipt> {
  return authedApiFetch<DealReceipt>(token, `/api/v1/deals/${id}/receipt`);
}

export function openDispute(token: string, id: string, reason: string): Promise<unknown> {
  return authedApiFetch(token, `/api/v1/deals/${id}/disputes`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export interface Evidence {
  id: string;
  agreement_id: string;
  kind: string;
  content: string;
  submitted_by: string;
  created_at: string;
  object_key: string | null;
  content_sha256: string | null;
  content_type: string | null;
}

export function listEvidence(token: string, id: string): Promise<Evidence[]> {
  return authedApiFetch<Evidence[]>(token, `/api/v1/deals/${id}/evidence`);
}

export async function downloadEvidenceContent(
  token: string,
  dealId: string,
  evidenceId: string,
): Promise<Blob> {
  const response: Response = await sendApiRequest(
    `/api/v1/deals/${dealId}/evidence/${evidenceId}/content`,
    undefined,
    token,
  );
  return response.blob();
}

export function submitEvidence(
  token: string,
  id: string,
  input: { kind: string; content: string },
): Promise<Evidence> {
  return authedApiFetch<Evidence>(token, `/api/v1/deals/${id}/evidence`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface OpenDisputeSummary {
  id: string;
  agreement_id: string;
  title: string;
  amount_sats: number;
  opened_by: string;
  reason: string;
  status: string;
  created_at: string;
}

export function listDisputes(token: string, status = "open"): Promise<OpenDisputeSummary[]> {
  return authedApiFetch<OpenDisputeSummary[]>(
    token,
    `/api/v1/disputes?status=${encodeURIComponent(status)}`,
  );
}

export interface Dispute {
  id: string;
  agreement_id: string;
  opened_by: string;
  reason: string;
  status: string;
  decision: string | null;
  rationale: string | null;
  resolved_by: string | null;
  created_at: string;
  resolved_at: string | null;
}

export function getDisputeDetail(token: string, disputeId: string): Promise<Dispute> {
  return authedApiFetch<Dispute>(token, `/api/v1/disputes/${disputeId}`);
}

export function resolveDispute(
  token: string,
  disputeId: string,
  decision: "release" | "refund",
  rationale: string,
): Promise<unknown> {
  return authedApiFetch(token, `/api/v1/disputes/${disputeId}/resolve`, {
    method: "POST",
    body: JSON.stringify({ decision, rationale }),
  });
}

export function proposeSettlement(
  token: string,
  id: string,
  input: {
    destination_address: string;
    fee_sats: number;
    purpose: SettlementPurpose;
  },
): Promise<Deal> {
  return authedApiFetch<Deal>(token, `/api/v1/deals/${id}/settlement/propose`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function attachPsbtSignature(token: string, id: string, signed_psbt: string): Promise<Deal> {
  return authedApiFetch<Deal>(token, `/api/v1/deals/${id}/settlement/sign`, {
    method: "POST",
    body: JSON.stringify({ signed_psbt }),
  });
}

export function finalizeSettlement(token: string, id: string): Promise<Deal> {
  return authedApiFetch<Deal>(token, `/api/v1/deals/${id}/settlement/finalize`, {
    method: "POST",
  });
}

export interface SettlementProgress {
  current_psbt: string | null;
  valid_signatures: number;
  required_signatures: number;
  phase: SettlementPhase;
  txid: string | null;
  confirmations: number;
  block_hash: string | null;
  purpose: SettlementPurpose | null;
}

export function getSettlement(token: string, id: string): Promise<SettlementProgress> {
  return authedApiFetch<SettlementProgress>(token, `/api/v1/deals/${id}/settlement`);
}

export interface WebhookEndpoint {
  id: string;
  owner_pubkey: string;
  url: string;
  secret: string;
  created_at: string;
}

export function registerWebhook(token: string, url: string): Promise<WebhookEndpoint> {
  return authedApiFetch<WebhookEndpoint>(token, "/api/v1/webhooks", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

export function confirmSettlement(
  token: string,
  id: string,
  blockHash?: string,
): Promise<Deal> {
  return authedApiFetch<Deal>(token, `/api/v1/deals/${id}/settlement/confirm`, {
    method: "POST",
    body: JSON.stringify({ block_hash: blockHash ?? null }),
  });
}

// === Health

export type ApiHealth = "online" | "degraded" | "offline";

export const API_HEALTH_QUERY_KEY = ["api-health"] as const;

export async function checkApiHealth(): Promise<ApiHealth> {
  try {
    const liveness: Response = await fetch(`${API_BASE_URL}/health`);
    if (!liveness.ok) {
      return "offline";
    }
    const readiness: Response = await fetch(`${API_BASE_URL}/health/ready`);
    return readiness.ok ? "online" : "degraded";
  } catch {
    return "offline";
  }
}

export interface ApprovedMediator {
  pubkey: string;
  display_name: string;
  status: "approved";
  source: "registry" | "configuration";
}
export interface MediatorRegistration {
  id: string;
  pubkey: string;
  display_name: string;
  status: "pending" | "approved" | "suspended";
  reviewed_by: string | null;
  reviewed_at: string | null;
}
export const getApprovedMediators = () => apiFetch<ApprovedMediator[]>("/api/v1/mediators");
export const getMyMediatorRegistration = (token: string) => authedApiFetch<MediatorRegistration | null>(token, "/api/v1/mediators/me");
export const registerMediator = (token: string, display_name: string, signature: {sig: string; pubkey: string}) =>
  authedApiFetch<MediatorRegistration>(token, "/api/v1/mediators", {method:"POST",body:JSON.stringify({display_name,signature})});
export const reviewMediators = (token: string) => authedApiFetch<MediatorRegistration[]>(token,"/api/v1/mediators/review");
export const setMediatorStatus = (token: string, pubkey: string, status: "approved" | "suspended") =>
  authedApiFetch<MediatorRegistration>(token,`/api/v1/mediators/${pubkey}/status`,{method:"POST",body:JSON.stringify({status})});
// Developer helper: only works when the API runs with OPENDEAL_DEMO_ENABLED on loopback regtest.
export const generateRegtestAddress = (token: string) => authedApiFetch<string>(token,"/api/v1/demo/addresses",{method:"POST",body:JSON.stringify({confirmation:"GENERATE REGTEST ADDRESS"})});

export const registerMediatorWithEvent = (token: string, display_name: string, event: unknown) => authedApiFetch<MediatorRegistration>(token,"/api/v1/mediators",{method:"POST",body:JSON.stringify({display_name,event})});
