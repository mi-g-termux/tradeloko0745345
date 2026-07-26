import type { Metadata, Viewport } from "next";
import "./globals.css";
import Nav from "@/components/Nav";
import PwaRegister from "@/components/PwaRegister";
import AdSlot from "@/components/AdSlot";
import { getBranding } from "@/lib/branding";

// Title AND favicon now come from the admin panel (falling back to env /
// defaults), which is why this is generateMetadata instead of a static object.
export async function generateMetadata(): Promise<Metadata> {
  const b = await getBranding();
  // Favicon precedence: admin favicon -> admin logo -> bundled default.
  const icon = b.faviconUrl ?? b.logoUrl ?? "/icon.svg";
  return {
    title: {
      default: b.appName,
      template: `%s · ${b.appName}`,
    },
    description:
      "Real-time Solana memecoin scanner, safety analysis, signals, whale tracking and trading.",
    manifest: "/manifest.webmanifest",
    icons: { icon, shortcut: icon, apple: icon },
  };
}

export const viewport: Viewport = {
  themeColor: "#0b0e14",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const branding = await getBranding();

  return (
    <html
      lang="en"
      // The admin accent colour overrides the design token for the whole app.
      // safeHexColor() in lib/branding guarantees this is a hex literal.
      style={
        branding.accentColor
          ? ({ ["--c-accent" as string]: branding.accentColor } as React.CSSProperties)
          : undefined
      }
    >
      <body className="min-h-screen bg-base text-ink">
        <PwaRegister />
        <Nav />

        {/* Ad slots render nothing at all when ads are off or empty. */}
        <div className="mx-auto max-w-[1600px] px-3 sm:px-4">
          <AdSlot slot="top_banner" className="mt-3" />
        </div>

        <main className="mx-auto max-w-[1600px] px-3 py-4 sm:px-4">{children}</main>

        <footer className="mx-auto max-w-[1600px] px-3 pb-8 sm:px-4">
          <AdSlot slot="footer" className="mb-4" />
          <p className="text-2xs leading-relaxed text-faint">
            {branding.appName} shows probabilistic analysis of public on-chain
            and market data. Nothing here is financial advice. Memecoins can go
            to zero — never risk more than you can lose.
          </p>
        </footer>
      </body>
    </html>
  );
}
