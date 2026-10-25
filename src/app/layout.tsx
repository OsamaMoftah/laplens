import type { Metadata } from "next";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource-variable/karla";
import "@fontsource/ibm-plex-mono/400.css";
import "./tokens.css";
import "./globals.css";
import "./workspace.css";

export const metadata: Metadata = {
  title: "LapLens — race exposure analysis",
  description: "Review racing footage, find sponsor marks, and inspect the moments behind every exposure count.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
