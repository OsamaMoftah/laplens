import type { Metadata } from "next";
import "@fontsource-variable/jost";
import "@fontsource-variable/karla";
import "./tokens.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "LapLens — race exposure analysis",
  description: "Review racing footage, find sponsor marks, and inspect the moments behind every exposure count.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
