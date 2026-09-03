import type { Metadata } from "next";
import "./globals.css";

const themeInitializer = `
  try {
    const savedTheme = localStorage.getItem("docchat-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = savedTheme === "dark" || (!savedTheme && prefersDark);
    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.style.colorScheme = isDark ? "dark" : "light";
  } catch {}
`;

export const metadata: Metadata = {
  metadataBase: new URL("https://docchat-lyart.vercel.app"),
  title: "Smartly.ai — Chat with your documents",
  description:
    "Upload multiple documents and get streamed, source-grounded answers from your private workspace.",
  applicationName: "Smartly.ai",
  openGraph: {
    type: "website",
    siteName: "Smartly.ai",
    title: "Smartly.ai — Chat with your documents",
    description:
      "Turn PDFs, presentations, spreadsheets and text files into searchable knowledge.",
  },
  twitter: {
    card: "summary",
    title: "Smartly.ai — Chat with your documents",
    description:
      "Turn your documents into searchable knowledge and grounded answers.",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitializer }} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
