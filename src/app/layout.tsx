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
  title: "DocChat",
  description: "Ask grounded questions about your PDF documents.",
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
