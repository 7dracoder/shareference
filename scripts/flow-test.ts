import { randomUUID } from "node:crypto";
import { createUser, setPayoutMethods } from "../src/lib/users";
import { createListing, getListing } from "../src/lib/listings";
import { createOrder, markSent, confirmPlatformReceipt, markProviderPaid, getPayment, paymentLegs } from "../src/lib/payments";

(async () => {
  const tag = randomUUID().slice(0, 8);
  const provider = await createUser(`flow-provider-${tag}@example.test`, "Flow provider", randomUUID());
  const buyer = await createUser(`flow-buyer-${tag}@example.test`, "Flow buyer", randomUUID());
  const admin = { ...buyer, isAdmin: true };
  await setPayoutMethods(provider.id, { zelle: "provider-payout@example.test", zelleName: "Provider" });
  const made = await createListing(provider.id, {
    kind: "api_key", service: "openai-compatible", title: "Flow test", description: "Temporary listing for payment smoke.",
    features: ["chat"], models: ["test"], pricePer1kMicros: 1000, seatPriceCents: 0, seatMinutes: 0, minPurchaseCents: 500,
    maxRpm: 60, maxTokensPerRequest: 4000, upstreamBaseUrl: "https://api.openai.com/v1", credential: "test-only-placeholder",
  });
  if (!made.ok) throw new Error(made.message);
  const listing = await getListing(made.listingId!);
  const order = await createOrder(listing!, buyer, 500, "zelle");
  if (!order.ok) throw new Error(order.message);
  const p = await getPayment(order.paymentId);
  const leaked = (await paymentLegs(p!)).some((l) => l.handle === "provider-payout@example.test");
  console.log("buyer_legs_ok", !leaked, "status", p?.status);
  await markSent(p!.id, buyer.id);
  await confirmPlatformReceipt(p!.id, admin);
  const after = await getPayment(p!.id);
  console.log("access_issued", after?.status === "completed" && Boolean(after.grantId));
  await markProviderPaid(p!.id, admin);
  console.log("provider_paid", Boolean((await getPayment(p!.id))?.providerConfirmedAt));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
