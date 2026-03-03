import type { Metadata } from "next";
import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: "ClipCast — Creator Upload App",
  description: "Desktop app for creators. Import videos, generate AI metadata, schedule and publish to YouTube, Instagram, and TikTok.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <div className="siteWrapper">
          <SiteHeader />
          <main className="mainContent">{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
