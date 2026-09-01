import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DocChat",
  description: "Ask grounded questions about your PDF documents.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
