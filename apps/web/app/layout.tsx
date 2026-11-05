import type { ReactNode } from "react";
import "./globals.css";
import { Header } from "../components/Header";
import { DemoNotice } from "../components/DemoNotice";
export const metadata = {
  title: "Switchboard — your call, our legwork",
  description:
    "One repair request, clear quotes, and two payment approvals. Explore the Switchboard sandbox demo with simulated providers.",
};
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <Header />
        <DemoNotice />
        {children}
      </body>
    </html>
  );
}
