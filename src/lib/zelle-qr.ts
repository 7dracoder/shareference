import "server-only";
import QRCode from "qrcode";
import { env } from "./env";
import { formatCents } from "./pricing";
import { platformPayoutMethods } from "./payments";

/**
 * Buyer-facing Zelle QR. Prefers a bank-exported QR image (PLATFORM_ZELLE_QR_URL).
 * Otherwise builds a QR that encodes the platform Zelle handle so the buyer can scan and send.
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
  if (env.PLATFORM_ZELLE_QR_URL) {
    return { imageSrc: env.PLATFORM_ZELLE_QR_URL, amountLabel, reference: opts.reference, recipientLabel };
  }
  // Plain handle is what most Zelle apps accept from a QR. Amount and memo are shown next to it.
  const imageSrc = await QRCode.toDataURL(platform.zelle, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 280,
    color: { dark: "#161616", light: "#ffffff" },
  });
  return { imageSrc, amountLabel, reference: opts.reference, recipientLabel };
}
