import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import { createUser, setPayoutMethods, syncClerkUser } from "../src/lib/users";
import { createListing, getListing, type Listing } from "../src/lib/listings";
import { createOrder, getPayment, markSent, confirmProviderReceipt, confirmPlatformReceipt, paymentLegs, cancelOrder } from "../src/lib/payments";
import { getGrant, revealKey, recordUsage, revokeGrant, updateLimits, activateSeat } from "../src/lib/grants";
import { reserveBudget } from "../src/lib/billing";
import { authorize } from "../src/lib/api";

const enabled = process.env.RUN_DB_TESTS === "true";
if (enabled && !process.env.DATABASE_URL?.includes("shareference_review_")) throw new Error("DB tests require a dedicated shareference_review_ database");
after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

test("purchase, settlement, ownership, seat delivery and concurrent budgets", { skip: !enabled }, async (t) => {
  const tag = randomUUID();
  const provider = await createUser(`provider-${tag}@example.test`, "Test provider", randomUUID());
  const buyer = await createUser(`buyer-${tag}@example.test`, "Test getter", randomUUID());
  const stranger = await createUser(`stranger-${tag}@example.test`, "Other getter", randomUUID());
  const admin = { ...buyer, isAdmin: true };
  await setPayoutMethods(provider.id, { zelle: "provider@example.test" });
  const input = { kind: "api_key" as const, service: "openai-compatible", title: "Test API", description: "A test-only API listing", features: ["chat"], models: ["test-model"], pricePer1kMicros: 1000, seatPriceCents: 0, seatMinutes: 0, minPurchaseCents: 500, maxRpm: 60, maxTokensPerRequest: 4000, upstreamBaseUrl: "https://api.openai.com/v1", credential: "test-only-placeholder" };
  const result = await createListing(provider.id, input); assert.equal(result.ok, true);
  const listing = await getListing(result.listingId!) as Listing; assert.ok(listing);
  let paymentId = "", grantId = "";
  await t.test("duplicate checkout creates one order and freezes payment recipients", async () => {
    const checkoutKey = randomUUID();
    const orders = await Promise.all(Array.from({length:5}, () => createOrder(listing, buyer, 500, "zelle", { checkoutKey })));
    assert.ok(orders.every(o => o.ok));
    const ids = orders.map(o => o.ok ? o.paymentId : ""); assert.equal(new Set(ids).size, 1); paymentId = ids[0];
    await setPayoutMethods(provider.id, { zelle: "changed@example.test" });
    const payment = await getPayment(paymentId); assert.ok(payment);
    assert.equal((await paymentLegs(payment))[0].handle, "provider@example.test");
  });
  await t.test("only recipients can confirm and both payment legs are required", async () => {
    assert.equal(await confirmProviderReceipt(paymentId, stranger.id), false);
    await markSent(paymentId, buyer.id); assert.equal(await cancelOrder(paymentId, buyer.id), false);
    await confirmProviderReceipt(paymentId, provider.id);
    assert.equal((await getPayment(paymentId))?.grantId, null);
    await Promise.all(Array.from({length:6}, () => confirmPlatformReceipt(paymentId, admin)));
    const p = await getPayment(paymentId); assert.equal(p?.status, "completed"); assert.ok(p?.grantId); grantId = p.grantId;
    assert.equal((await db.get<{n:number}>("SELECT COUNT(*) AS n FROM grants WHERE listing_id = ? AND buyer_id = ?", [listing.id,buyer.id]))?.n, 1);
  });
  await t.test("key disclosure and limit editing respect ownership and purchased expiry", async () => {
    assert.equal(await revealKey(grantId, stranger.id), null); const key=await revealKey(grantId,buyer.id); assert.ok(key?.startsWith("shr_"));
    const auth = await authorize(new Request("https://example.test",{headers:{Authorization:`Bearer ${key}`}})); assert.ok(!(auth instanceof Response));
    assert.equal(await updateLimits(grantId, buyer.id,{maxRpm:60,maxTokensPerRequest:4000,privacyFloor:"private",expiresAt:null}),false);
    assert.equal(await updateLimits(grantId, provider.id,{maxRpm:600,maxTokensPerRequest:4000,privacyFloor:"private",expiresAt:Date.now()+3600000}),false);
  });
  await t.test("parallel requests cannot reserve more than the remaining balance", async () => {
    await db.run("UPDATE grants SET budget_micros = 100, spent_micros = 0 WHERE id = ?",[grantId]);
    const holds=await Promise.all(Array.from({length:10},()=>reserveBudget(grantId,60))); assert.equal(holds.filter(Boolean).length,1);
    const reservationId=holds.find(Boolean)!;
    const usage={grantId,reservationId,endpoint:"test",backend:"test",tier:"shared",model:null,promptTokens:1,completionTokens:1,costMicros:40,latencyMs:1,outcome:"ok" as const};
    await Promise.all([recordUsage(usage),recordUsage(usage)]); assert.equal((await getGrant(grantId))?.spentMicros,40);
    const second=await reserveBudget(grantId,60); assert.ok(second);
    await revokeGrant(grantId,buyer.id); await recordUsage({...usage,reservationId:second,costMicros:60}); assert.equal((await getGrant(grantId))?.status,"revoked");
    assert.equal(await reserveBudget(grantId,1),null);
  });
  await t.test("canceled orders cannot be confirmed back into active access", async()=>{
    const o=await createOrder(listing,buyer,500,"zelle"); assert.ok(o.ok);
    assert.equal(await cancelOrder(o.paymentId,buyer.id),true);
    await Promise.all([confirmProviderReceipt(o.paymentId,provider.id),confirmPlatformReceipt(o.paymentId,admin)]);
    assert.equal((await getPayment(o.paymentId))?.status,"canceled"); assert.equal((await getPayment(o.paymentId))?.grantId,null);
  });
  await t.test("seat orders require an invitation email and preserve it through activation", async()=>{
    const made=await createListing(provider.id,{...input,kind:"seat",service:"canva-teams",features:[],models:[],upstreamBaseUrl:null,credential:null,seatPriceCents:500,seatMinutes:120}); assert.ok(made.ok);
    const seat=await getListing(made.listingId!) as Listing;
    assert.equal((await createOrder(seat,buyer,0,"zelle")).ok,false);
    const o=await createOrder(seat,buyer,0,"zelle",{deliveryEmail:"invite@example.test"}); assert.ok(o.ok);
    await confirmProviderReceipt(o.paymentId,provider.id); await confirmPlatformReceipt(o.paymentId,admin);
    const p=await getPayment(o.paymentId); const g=await getGrant(p!.grantId!); assert.equal(g?.deliveryEmail,"invite@example.test"); assert.equal(g.status,"pending_assignment");
    assert.equal(await activateSeat(g.id,stranger.id,120),false); assert.equal(await activateSeat(g.id,provider.id,120),true);
  });
  await t.test("Clerk links an existing profile only with a verified email, preserving orders", async()=>{
    const linked=await syncClerkUser({id:`clerk_${tag}`,name:"Getter",verifiedEmail:buyer.email}); assert.equal(linked.id,buyer.id);
    const relinked=await syncClerkUser({id:`clerk_prod_${tag}`,name:"Getter",verifiedEmail:buyer.email}); assert.equal(relinked.id,buyer.id);
    const parallel=await Promise.all(Array.from({length:4},()=>syncClerkUser({id:`clerk_new_${tag}`,name:"New member"}))); assert.equal(new Set(parallel.map(u=>u.id)).size,1); assert.equal(parallel[0].isAdmin,false);
    assert.equal((await getPayment(paymentId))?.buyerId,linked.id);
  });
});
