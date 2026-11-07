import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import { createUser, setPayoutMethods, syncClerkUser } from "../src/lib/users";
import { createListing, getListing, type Listing } from "../src/lib/listings";
import { createOrder, getPayment, markSent, confirmPlatformReceipt, confirmProviderReceipt, markProviderPaid, paymentLegs, cancelOrder } from "../src/lib/payments";
import { getGrant, revealKey, recordUsage, revokeGrant, updateLimits, activateSeat } from "../src/lib/grants";
import { reserveBudget } from "../src/lib/billing";
import { authorize, checkOrBlock } from "../src/lib/api";
import { checkIn, claimJob, createNode, finishJob } from "../src/lib/nodes";
import { routeChat } from "../src/lib/agents/router";

const enabled = process.env.RUN_DB_TESTS === "true";
if (enabled && !process.env.DATABASE_URL?.includes("shareference_review_")) throw new Error("DB tests require a dedicated shareference_review_ database");
after(() => { setTimeout(() => process.exit(process.exitCode ?? 0), 50).unref(); });

test("purchase, settlement, ownership, seat delivery and concurrent budgets", { skip: !enabled }, async (t) => {
  const tag = randomUUID();
  const provider = await createUser(`provider-${tag}@example.test`, "Test provider", randomUUID());
  const buyer = await createUser(`buyer-${tag}@example.test`, "Test getter", randomUUID());
  const stranger = await createUser(`stranger-${tag}@example.test`, "Other getter", randomUUID());
  const admin = { ...buyer, isAdmin: true };
  await setPayoutMethods(provider.id, { zelle: "provider@example.test", zelleName: "Provider Test" });
  const input = { kind: "api_key" as const, service: "openai-compatible", title: "Test API", description: "A test-only API listing", features: ["chat"], models: ["test-model"], pricePer1kMicros: 1000, seatPriceCents: 0, seatMinutes: 0, minPurchaseCents: 500, maxRpm: 60, maxTokensPerRequest: 4000, upstreamBaseUrl: "https://api.openai.com/v1", credential: "test-only-placeholder" };
  const result = await createListing(provider.id, input); assert.equal(result.ok, true);
  const listing = await getListing(result.listingId!) as Listing; assert.ok(listing);
  let paymentId = "", grantId = "";
  await t.test("duplicate checkout creates one order and buyer only sees the platform collection leg", async () => {
    const checkoutKey = randomUUID();
    const orders = await Promise.all(Array.from({length:5}, () => createOrder(listing, buyer, 500, "zelle", { checkoutKey })));
    assert.ok(orders.every(o => o.ok));
    const ids = orders.map(o => o.ok ? o.paymentId : ""); assert.equal(new Set(ids).size, 1); paymentId = ids[0];
    const payment = await getPayment(paymentId); assert.ok(payment);
    const legs = await paymentLegs(payment);
    assert.equal(legs.length, 1);
    assert.equal(legs[0].recipient, "platform");
    assert.equal(legs[0].cents, 500);
    assert.notEqual(legs[0].handle, "provider@example.test");
  });
  await t.test("provider confirm unlocks access after admin deposit + payout", async () => {
    assert.equal(await markProviderPaid(paymentId, stranger), false);
    await markSent(paymentId, buyer.id); assert.equal(await cancelOrder(paymentId, buyer.id), false);
    assert.equal((await getPayment(paymentId))?.grantId, null);
    await Promise.all(Array.from({length:6}, () => confirmPlatformReceipt(paymentId, admin)));
    let p = await getPayment(paymentId); assert.ok(p?.feeConfirmedAt); assert.equal(p.status, "buyer_marked_sent"); assert.equal(p.grantId, null);
    assert.equal(await confirmProviderReceipt(paymentId, provider.id), false); // admin hasn't marked paid yet
    assert.equal(await markProviderPaid(paymentId, admin), true);
    assert.ok((await getPayment(paymentId))?.providerPaidAt);
    assert.equal(await confirmProviderReceipt(paymentId, stranger.id), false);
    assert.equal(await confirmProviderReceipt(paymentId, provider.id), true);
    p = await getPayment(paymentId); assert.equal(p?.status, "completed"); assert.ok(p?.grantId); grantId = p.grantId!;
    assert.ok(p.providerConfirmedAt);
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
    await confirmPlatformReceipt(o.paymentId,admin);
    assert.equal((await getPayment(o.paymentId))?.status,"canceled"); assert.equal((await getPayment(o.paymentId))?.grantId,null);
  });
  await t.test("seat orders require an invitation email and preserve it through activation", async()=>{
    const made=await createListing(provider.id,{...input,kind:"seat",service:"canva-teams",features:[],models:[],upstreamBaseUrl:null,credential:null,seatPriceCents:500,seatMinutes:120}); assert.ok(made.ok);
    const seat=await getListing(made.listingId!) as Listing;
    assert.equal((await createOrder(seat,buyer,0,"zelle")).ok,false);
    const o=await createOrder(seat,buyer,0,"zelle",{deliveryEmail:"invite@example.test"}); assert.ok(o.ok);
    await confirmPlatformReceipt(o.paymentId,admin);
    await markProviderPaid(o.paymentId,admin);
    await confirmProviderReceipt(o.paymentId,provider.id);
    const p=await getPayment(o.paymentId); const g=await getGrant(p!.grantId!); assert.equal(g?.deliveryEmail,"invite@example.test"); assert.equal(g.status,"pending_assignment");
    assert.equal((await getListing(seat.id))?.status,"paused");
    assert.equal(await activateSeat(g.id,stranger.id,120),false); assert.equal(await activateSeat(g.id,provider.id,120),true);
  });
  await t.test("computer listings sell hours and relay requests through the provider's agent", async()=>{
    const base={...input,kind:"compute" as const,service:"own-computer",features:["chat"],models:[],pricePer1kMicros:0,upstreamBaseUrl:null,credential:null,seatPriceCents:200,seatMinutes:60,minPurchaseCents:200};
    assert.equal((await createListing(provider.id,base)).ok,false);
    const token=await createNode(provider.id);
    const nodeId=await checkIn(token,{gpu:"Test GPU",ramGb:32,freeDiskGb:500},["llama3.2"]); assert.ok(nodeId);
    assert.equal((await createListing(stranger.id,{...base,nodeId})).ok,false);
    const made=await createListing(provider.id,{...base,nodeId}); assert.ok(made.ok);
    const listing=await getListing(made.listingId!) as Listing; assert.equal(listing.nodeId,nodeId);
    const o=await createOrder(listing,buyer,600,"zelle"); assert.ok(o.ok);
    assert.equal((await getPayment(o.paymentId))?.grossCents,600);
    await confirmPlatformReceipt(o.paymentId,admin);
    await markProviderPaid(o.paymentId,admin);
    await confirmProviderReceipt(o.paymentId,provider.id);
    assert.equal((await getListing(listing.id))?.status,"paused");
    const g=await getGrant((await getPayment(o.paymentId))!.grantId!); assert.ok(g?.expiresAt);
    const hours=(g.expiresAt-g.startsAt)/3_600_000; assert.ok(hours>2.99&&hours<3.01,`expected 3 hours, got ${hours}`);
    assert.equal(await updateLimits(g.id,provider.id,{maxRpm:60,maxTokensPerRequest:4000,privacyFloor:"fast",expiresAt:g.expiresAt+3_600_000}),false);
    assert.equal(await checkOrBlock({grant:g,listing},"chat",{feature:"chat"}),null);

    const agent=(async()=>{ for(let i=0;i<50;i++){ const job=await claimJob(nodeId!); if(job){ assert.equal((job.request as {model:string}).model,"llama3.2"); await finishJob(nodeId!,job.id,{response:{id:"c1",model:"llama3.2",choices:[{index:0,message:{role:"assistant",content:"hi from the box"},finish_reason:"stop"}],usage:{prompt_tokens:3,completion_tokens:4}}}); return; } await new Promise(r=>setTimeout(r,100)); } })();
    const routed=await routeChat(g,listing,{messages:[{role:"user",content:"hello"}]},null); await agent;
    const body=await routed.response.json() as {choices:Array<{message:{content:string}}>};
    assert.equal(body.choices[0].message.content,"hi from the box"); assert.deepEqual(await routed.usage,{promptTokens:3,completionTokens:4}); assert.equal(routed.pricePer1kMicros,0);
    assert.equal((await db.get<{n:number}>("SELECT COUNT(*) AS n FROM node_jobs WHERE node_id = ?",[nodeId]))?.n,0);
    await assert.rejects(routeChat(g,listing,{model:"not-installed",messages:[{role:"user",content:"x"}]},null),/not installed/i);
    await db.run("UPDATE nodes SET last_seen = 0 WHERE id = ?",[nodeId]);
    await assert.rejects(routeChat(g,listing,{messages:[{role:"user",content:"x"}]},null),/offline/i);
  });
  await t.test("Clerk links an existing profile only with a verified email, preserving orders", async()=>{
    const linked=await syncClerkUser({id:`clerk_${tag}`,name:"Getter",verifiedEmail:buyer.email}); assert.equal(linked.id,buyer.id);
    const relinked=await syncClerkUser({id:`clerk_prod_${tag}`,name:"Getter",verifiedEmail:buyer.email}); assert.equal(relinked.id,buyer.id);
    const parallel=await Promise.all(Array.from({length:4},()=>syncClerkUser({id:`clerk_new_${tag}`,name:"New member"}))); assert.equal(new Set(parallel.map(u=>u.id)).size,1); assert.equal(parallel[0].isAdmin,false);
    assert.equal((await getPayment(paymentId))?.buyerId,linked.id);
  });
});
