import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import { SiteHeader } from "@/components/SiteHeader";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Loopforge",
  description: "Kuźnia pętli rowerowych — generuj trasę, nie szukaj",
  icons: {
    icon: [{ url: "/branding/loopforge-icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/branding/loopforge-icon.svg", type: "image/svg+xml" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pl"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-dvh flex-col bg-zinc-950 text-zinc-100 lg:h-dvh lg:overflow-hidden">
        <SiteHeader />
        <div className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-hidden">{children}</div>
        <Analytics />
      </body>
    </html>
  );
}
