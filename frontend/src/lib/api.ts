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

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
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

function authHeaders(token?: string | null): HeadersInit {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit & { token?: string | null },
): Promise<T> {
  const { token, ...rest } = init ?? {};
  const response: Response = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: { ...authHeaders(token), ...rest.headers },
  });

  if (!response.ok) {
    let body: ApiErrorBody;
    try {
      body = await response.json();
    } catch {
      throw new ApiRequestError(response.status, undefined, response.statusText);
    }
    throw new ApiRequestError(response.status, body.code, body.message);
  }

  const envelope: ApiEnvelope<T> = await response.json();
  return envelope.data;
}

export interface AgreementView {
  agreement: {
    version: number;
    title: string;
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
  network: string;
  settlement_model: string;
  custody: string;
  pilot_max_amount_sats: number | null;
  required_confirmations: number;
  rate_limit_per_minute: number;
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

export function getDeal(id: string): Promise<Deal> {
  return apiFetch<Deal>(`/api/v1/deals/${id}`);
}

export function getAgreement(id: string): Promise<AgreementView> {
  return apiFetch<AgreementView>(`/api/v1/deals/${id}/agreement`);
}

export function signAgreement(
  token: string,
  id: string,
  signature: { sig: string; pubkey: string },
): Promise<Deal> {
  return apiFetch<Deal>(`/api/v1/deals/${id}/sign`, {
    method: "POST",
    token,
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

export function devSession(pubkey: string): Promise<AuthSession> {
  return apiFetch<AuthSession>(`/api/v1/auth/dev/session`, {
    method: "POST",
    body: JSON.stringify({ pubkey }),
  });
}

export function createDeal(
  token: string,
  input: {
    title: string;
    amount_sats: number;
    buyer_pubkey: string;
    mediator_pubkey: string;
    delivery_deadline: string;
    acceptance_window_hours: number;
  },
): Promise<Deal> {
  return apiFetch<Deal>("/api/v1/deals", {
    method: "POST",
    token,
    body: JSON.stringify(input),
  });
}

export function transitionDeal(token: string, id: string, to: DealStatus): Promise<Deal> {
  return apiFetch<Deal>(`/api/v1/deals/${id}/transition`, {
    method: "POST",
    token,
    body: JSON.stringify({ to }),
  });
}

export function prepareFunding(token: string, id: string): Promise<Deal> {
  return apiFetch<Deal>(`/api/v1/deals/${id}/funding/prepare`, { method: "POST", token });
}

export function verifyFunding(token: string, id: string): Promise<Deal> {
  return apiFetch<Deal>(`/api/v1/deals/${id}/funding/verify`, { method: "POST", token });
}

export function getEvents(id: string): Promise<DealEvent[]> {
  return apiFetch<DealEvent[]>(`/api/v1/deals/${id}/events`);
}

export function getReceipt(id: string): Promise<DealReceipt> {
  return apiFetch<DealReceipt>(`/api/v1/deals/${id}/receipt`);
}

export function openDispute(token: string, id: string, reason: string): Promise<unknown> {
  return apiFetch(`/api/v1/deals/${id}/disputes`, {
    method: "POST",
    token,
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

export function listEvidence(id: string): Promise<Evidence[]> {
  return apiFetch<Evidence[]>(`/api/v1/deals/${id}/evidence`);
}

export function submitEvidence(
  token: string,
  id: string,
  input: { kind: string; content: string },
): Promise<Evidence> {
  return apiFetch<Evidence>(`/api/v1/deals/${id}/evidence`, {
    method: "POST",
    token,
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
  return apiFetch<OpenDisputeSummary[]>(
    `/api/v1/disputes?status=${encodeURIComponent(status)}`,
    { token },
  );
}

export function resolveDispute(
  token: string,
  disputeId: string,
  decision: "release" | "refund",
  rationale: string,
): Promise<unknown> {
  return apiFetch(`/api/v1/disputes/${disputeId}/resolve`, {
    method: "POST",
    token,
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
  return apiFetch<Deal>(`/api/v1/deals/${id}/settlement/propose`, {
    method: "POST",
    token,
    body: JSON.stringify(input),
  });
}

export function attachPsbtSignature(token: string, id: string, signed_psbt: string): Promise<Deal> {
  return apiFetch<Deal>(`/api/v1/deals/${id}/settlement/sign`, {
    method: "POST",
    token,
    body: JSON.stringify({ signed_psbt }),
  });
}

export function finalizeSettlement(token: string, id: string): Promise<Deal> {
  return apiFetch<Deal>(`/api/v1/deals/${id}/settlement/finalize`, {
    method: "POST",
    token,
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
  return apiFetch<SettlementProgress>(`/api/v1/deals/${id}/settlement`, { token });
}

export interface WebhookEndpoint {
  id: string;
  owner_pubkey: string;
  url: string;
  secret: string;
  created_at: string;
}

export function registerWebhook(token: string, url: string): Promise<WebhookEndpoint> {
  return apiFetch<WebhookEndpoint>("/api/v1/webhooks", {
    method: "POST",
    token,
    body: JSON.stringify({ url }),
  });
}

export function confirmSettlement(
  token: string,
  id: string,
  blockHash?: string,
): Promise<Deal> {
  return apiFetch<Deal>(`/api/v1/deals/${id}/settlement/confirm`, {
    method: "POST",
    token,
    body: JSON.stringify({ block_hash: blockHash ?? null }),
  });
}
