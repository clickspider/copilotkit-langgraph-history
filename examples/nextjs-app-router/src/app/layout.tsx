import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CopilotKit LangGraph History Example",
  description: "Example app demonstrating history hydration with CopilotKit and LangGraph",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
