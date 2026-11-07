import "server-only";
import { createPublicClient, erc20Abi, getAddress, http, isAddressEqual, parseEventLogs, type Hash } from "viem";
import { base, baseSepolia } from "viem/chains";
import { env } from "../env";

/** Circle-issued USDC (6 decimals). Source: developers.circle.com/stablecoins/usdc-contract-addresses */
const USDC_ADDRESS = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
} as const;

/** 1 cent = 10,000 base units of a 6-decimal token. */
const UNITS_PER_CENT = 10_000n;
const CLOCK_SKEW_MS = 5 * 60_000;

const chain = env.USDC_NETWORK === "base" ? base : baseSepolia;
const client = createPublicClient({ chain, transport: http(env.BASE_RPC_URL) });

export function usdcNetworkLabel(): string {
  return env.USDC_NETWORK === "base" ? "Base mainnet (real USDC)" : "Base Sepolia testnet (no real money)";
}

export function explorerTx(hash: string): string {
  const host = env.USDC_NETWORK === "base" ? "basescan.org" : "sepolia.basescan.org";
  return `https://${host}/tx/${hash}`;
}

export interface Leg {
  to: string;
  cents: number;
}

export interface UsdcCheck {
  ok: boolean;
  message: string;
}

/**
 * Verifies that the given transactions contain USDC transfers from the buyer's
 * wallet covering every leg (provider share + platform fee), mined after the
 * order was created. Shareference never receives or holds these funds.
 */
export async function verifyUsdcPayment(hashes: Hash[], payer: string, legs: Leg[], orderCreatedAt: number): Promise<UsdcCheck> {
  const usdc = getAddress(USDC_ADDRESS[env.USDC_NETWORK]);
  const from = getAddress(payer);
  const received = new Map<string, bigint>();

  for (const hash of hashes) {
    let receipt;
    try {
      receipt = await client.getTransactionReceipt({ hash });
    } catch {
      return { ok: false, message: `Transaction ${hash.slice(0, 10)}… not found yet. Wait for it to confirm and try again.` };
    }
    if (receipt.status !== "success") return { ok: false, message: `Transaction ${hash.slice(0, 10)}… failed on-chain.` };
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    if (Number(block.timestamp) * 1000 < orderCreatedAt - CLOCK_SKEW_MS) {
      return { ok: false, message: `Transaction ${hash.slice(0, 10)}… is older than this order.` };
    }
    const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs }).filter(
      (log) => isAddressEqual(log.address, usdc) && isAddressEqual(log.args.from, from),
    );
    for (const t of transfers) {
      const key = getAddress(t.args.to);
      received.set(key, (received.get(key) ?? 0n) + t.args.value);
    }
  }

  for (const leg of legs) {
    if (leg.cents <= 0) continue;
    const need = BigInt(leg.cents) * UNITS_PER_CENT;
    const got = received.get(getAddress(leg.to)) ?? 0n;
    if (got < need) {
      return { ok: false, message: `Missing USDC to ${leg.to.slice(0, 8)}…: expected ${(leg.cents / 100).toFixed(2)}, found ${(Number(got) / 1e6).toFixed(2)}.` };
    }
  }
  return { ok: true, message: "Payment verified on-chain." };
}
