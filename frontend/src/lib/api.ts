// === API client (mirrors opendeal-api ApiEnvelope / Deal shapes)

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

export function getDeal(id: string): Promise<Deal> {
  return apiFetch<Deal>(`/api/v1/deals/${id}`);
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
