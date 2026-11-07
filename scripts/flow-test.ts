/**
 * Exercises the purchase flow against the configured DATABASE_URL using the app's own modules.
 * Run: npx tsx --conditions=react-server --env-file=.env.local scripts/flow-test.ts
 * Prints a pool key on the last line for API testing.
 */
import { createUser, setPayoutMethods, getUserById } from "../src/lib/users";
import { createListing, getListing, POOL_LISTING_ID } from "../src/lib/listings";
import { createOrder, markSent, confirmProviderReceipt, confirmPlatformReceipt, getPayment, paymentLegs } from "../src/lib/payments";
import { revealKey, getGrant } from "../src/lib/grants";

async function main(): Promise<void> {
  const tag = Date.now().toString(36);
  const buyer = await createUser(`buyer-${tag}@test.dev`, "Buyer", "password1234");
  const provider = await createUser(`prov-${tag}@test.dev`, "Provider", "password1234");

  const pool = await getListing(POOL_LISTING_ID);
  if (!pool) throw new Error("pool listing missing");
  const demo = await createOrder(pool, buyer, 500, "demo");
  if (!demo.ok) throw new Error(demo.message);
  const demoPay = await getPayment(demo.paymentId);
  console.log("pool demo order:", demoPay?.status, "grant:", Boolean(demoPay?.grantId));

  await setPayoutMethods(provider.id, { zelle: "provider@test.dev", zelleName: "Pro Vider" });
  const bad = await createListing(provider.id, {
    kind: "api_key", service: "personal-login", title: "x", description: "xxxxxxxxxxx", features: ["chat"], models: [],
    pricePer1kMicros: 500, seatPriceCents: 0, seatMinutes: 0, minPurchaseCents: 500, maxRpm: 60, maxTokensPerRequest: 4000,
    upstreamBaseUrl: "https://example.com/v1", credential: "sk-secret-123",
  });
  console.log("forbidden listing rejected:", !bad.ok);

  const seat = await createListing(provider.id, {
    kind: "seat", service: "canva-teams", title: "Canva Teams seat 2h", description: "Two hours on our Canva team.", features: [], models: [],
    pricePer1kMicros: 0, seatPriceCents: 1000, seatMinutes: 120, minPurchaseCents: 100, maxRpm: 60, maxTokensPerRequest: 4000,
    upstreamBaseUrl: null, credential: null,
  });
  const seatListing = await getListing(seat.listingId ?? "");
  if (!seatListing) throw new Error("seat listing missing");
  const order = await createOrder(seatListing, buyer, 0, "zelle");
  if (!order.ok) throw new Error(order.message);
  const p = await getPayment(order.paymentId);
  if (!p) throw new Error("payment missing");
  console.log("legs:", JSON.stringify((await paymentLegs(p)).map((l) => [l.recipient, l.handle, l.holderName, l.cents])));
  await markSent(p.id, buyer.id);
  await confirmProviderReceipt(p.id, provider.id);
  console.log("after provider confirm:", (await getPayment(p.id))?.status);
  console.log("buyer cannot confirm provider leg:", !(await confirmProviderReceipt(p.id, buyer.id)));
  const admin = { ...(await getUserById(buyer.id))!, isAdmin: true };
  await confirmPlatformReceipt(p.id, admin);
  const done = await getPayment(p.id);
  console.log("after fee confirm:", done?.status, "| seat grant:", (await getGrant(done?.grantId ?? ""))?.status);

  console.log(`POOLKEY=${await revealKey(demoPay?.grantId ?? "", buyer.id)}`);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
