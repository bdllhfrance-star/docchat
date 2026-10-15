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
  title: "CNOM · Assistant documentaire — Démonstration",
  description:
    "Prototype de démonstration pour le Comité National Olympique Marocain : explorez règlements, rapports et dossiers sportifs, avec des réponses sourcées en français et en arabe.",
  applicationName: "CNOM · Assistant documentaire",
  robots: { index: false, follow: false },
  openGraph: {
    type: "website",
    siteName: "CNOM · Démonstration documentaire",
    title: "CNOM · L’information au service du mouvement olympique",
    description:
      "Règlements, rapports et dossiers des délégations : une démonstration indépendante de recherche documentaire avec citations.",
    images: [{ url: "/cnom-logo.png", width: 436, height: 508, alt: "Comité National Olympique Marocain" }],
  },
  twitter: {
    card: "summary",
    title: "CNOM · Assistant documentaire — Démonstration",
    description:
      "Explorez vos documents sportifs et institutionnels avec des réponses sourcées.",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitializer }} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
