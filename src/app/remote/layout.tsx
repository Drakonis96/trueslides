import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "TrueSlides — Remote Control",
  description: "Mobile presenter remote control",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RemoteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
