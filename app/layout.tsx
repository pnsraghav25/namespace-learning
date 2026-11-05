import "./globals.css";
import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "namespace-learning — Company Interview Questions",
  description: "Search coding interview questions by company."
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
