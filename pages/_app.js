// Vercel Web Analytics for the Next.js pages (the static public/*.html pages
// load the same script with a tag in their <head>).
import { Analytics } from "@vercel/analytics/react";

export default function App({ Component, pageProps }) {
  return (
    <>
      <Component {...pageProps} />
      <Analytics />
    </>
  );
}
