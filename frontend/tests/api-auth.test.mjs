import assert from "node:assert/strict";
import { test } from "node:test";

const storage = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  },
  addEventListener() {},
  removeEventListener() {},
};

const api = await import("../src/lib/api.ts");
const { getDeal } = api;

test("the browser client has no pubkey-only (dev session) sign-in", () => {
  assert.equal("devSession" in api, false);
  assert.equal("approveDemoMediator" in api, false);
});

test("protected reads include the bearer token", async () => {
  const originalFetch = globalThis.fetch;
  let authorization = null;
  globalThis.fetch = async (_url, init) => {
    authorization = new Headers(init.headers).get("Authorization");
    return new Response(
      JSON.stringify({ message: "deal", success: true, data: { id: "deal-id" } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  try {
    await getDeal("unit-test-token", "deal-id");
    assert.equal(authorization, "Bearer unit-test-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a protected 401 expires the matching session", async () => {
  const originalFetch = globalThis.fetch;
  storage.set(
    "opendeal.session",
    JSON.stringify({ token: "expired-token", pubkey: "11".repeat(32), roleLabel: "seller" }),
  );
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: "expired", success: false }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  try {
    await assert.rejects(getDeal("expired-token", "deal-id"), /expired/);
    assert.equal(JSON.parse(storage.get("opendeal.session")).token, "");
  } finally {
    globalThis.fetch = originalFetch;
    storage.clear();
  }
});

test("an old identity's delayed 401 cannot expire the newly active participant",async()=>{
 const originalFetch=globalThis.fetch;
 storage.set("opendeal.session",JSON.stringify({token:"buyer-token",pubkey:"22".repeat(32),roleLabel:"buyer"}));
 globalThis.fetch=async()=>Response.json({message:"old token expired",success:false},{status:401});
 try{await assert.rejects(getDeal("old-seller-token","deal-id"),/expired/);assert.equal(JSON.parse(storage.get("opendeal.session")).token,"buyer-token");}finally{globalThis.fetch=originalFetch;storage.clear();}
});

test("guided deal retries can carry a stable actor-scoped idempotency key",async()=>{
 const {createDeal}=await import("../src/lib/api.ts");const original=globalThis.fetch;
 const body={title:"Demo",amount_sats:50000,buyer_pubkey:"buyer",mediator_pubkey:"mediator",delivery_deadline:"2026-12-01T00:00:00Z",acceptance_window_hours:48,seller_payout_address:"payout",buyer_refund_address:"refund"};
 globalThis.fetch=async(_url,init)=>{assert.equal(new Headers(init.headers).get("Idempotency-Key"),"demo:seller");assert.equal(new Headers(init.headers).get("Authorization"),"Bearer seller-token");assert.deepEqual(JSON.parse(init.body),body);return Response.json({success:true,data:{id:"same-deal"}});};
 try{assert.equal((await createDeal("seller-token",body,"demo:seller")).id,"same-deal");}finally{globalThis.fetch=original;}
});
