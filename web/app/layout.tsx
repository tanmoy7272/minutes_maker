import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Meet Minutes Pro — Instant AI Meeting Minutes from Google Meet",
  description:
    "Turn Google Meet live captions into perfect, structured meeting minutes in 4 seconds. Free, private, and instant. No database, no auth, no API keys.",
  keywords: ["Google Meet", "Meeting Minutes", "AI Summarizer", "Gemini", "Chrome Extension"],
  authors: [{ name: "Meet Minutes Pro Team" }],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} dark scroll-smooth`}>
      <body className="bg-[#08080c] text-slate-100 font-sans antialiased selection:bg-purple-600/30 selection:text-purple-200">
        {children}
      </body>
    </html>
  );
}
