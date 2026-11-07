import { ImageResponse } from "next/og";
import { LogoMark } from "@/components/logo";

export const alt = "Shareference: share unused AI credit, team seats, or your own computer";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 96, background: "#f7f7f5", color: "#161616" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        <LogoMark size={120} />
        <div style={{ display: "flex", fontSize: 88, fontWeight: 600 }}>Shareference</div>
      </div>
      <div style={{ marginTop: 40, fontSize: 40, color: "#4b4b47" }}>Share unused AI credit, team seats, or your own computer.</div>
    </div>,
    size,
  );
}
