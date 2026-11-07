import "server-only";
import { env } from "./env";
import { formatCents } from "./pricing";
import { platformPayoutMethods } from "./payments";

/** Bundled bank-exported Zelle QR served from /public. */
const DEFAULT_ZELLE_QR_PATH = "/zelle-qr.png";

/**
 * Buyer-facing Zelle QR. Prefers PLATFORM_ZELLE_QR_URL, otherwise the static /zelle-qr.png asset.
 */
export async function buyerZelleQr(opts: { reference: string; grossCents: number }): Promise<{
  imageSrc: string;
  amountLabel: string;
  reference: string;
  recipientLabel: string;
} | null> {
  const platform = platformPayoutMethods();
  if (!platform.zelle) return null;
  const amountLabel = formatCents(opts.grossCents);
  const recipientLabel = platform.zelleName?.trim() || "Shareference";
  const imageSrc = env.PLATFORM_ZELLE_QR_URL?.trim() || DEFAULT_ZELLE_QR_PATH;
  return { imageSrc, amountLabel, reference: opts.reference, recipientLabel };
}
