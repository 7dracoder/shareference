import { ImageResponse } from "next/og";
import { LogoMark } from "@/components/logo";

export const alt = "Shareference · AI access, made simple";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 96, background: "#101413", color: "#f1f5f2" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        <LogoMark size={120} />
        <div style={{ display: "flex", fontSize: 88 }}>
          <span>share</span><span style={{ color: "#b6e6c7" }}>ference</span>
        </div>
      </div>
      <div style={{ marginTop: 40, fontSize: 40, color: "#b4c1b9" }}>Share unused AI credits with limits you control.</div>
    </div>,
    size,
  );
}
