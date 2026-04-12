import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TrueSlides — AI Presentation Generator",
  description: "Upload a document and generate professional presentations with AI",
  icons: {
    icon: "/logo.png",
    shortcut: "/logo.png",
    apple: "/logo.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
