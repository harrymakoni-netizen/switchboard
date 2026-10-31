import type { ReactNode } from "react";
import "./globals.css";
import { Header } from "../components/Header";
export const metadata = {
  title: "Switchboard — your call, our legwork",
  description:
    "Arrange a home repair, compare phone quotes, and choose who gets the job.",
};
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Header />
        {process.env.DEMO_MODE === "1" && (
          <div className="demo-banner">
            Judge mode: calls go to demo business bots · PayPal sandbox only
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
