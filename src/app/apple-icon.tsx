import { ImageResponse } from "next/og";
import { LogoMark } from "@/components/logo";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#101413" }}>
      <LogoMark size={150} />
    </div>,
    size,
  );
}
