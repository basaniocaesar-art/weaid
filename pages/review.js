/**
 * weaid.in/review — one short link (and QR) to WeAid's Google review form.
 * GOOGLE_REVIEW_URL comes from Business Profile → "Ask for reviews".
 * Until it's set, people land on WeAid's Google listing search.
 */
export default function Review() { return null; }
export async function getServerSideProps() {
  const dest = process.env.GOOGLE_REVIEW_URL || "https://www.google.com/search?q=WeAid+Kochi+reviews";
  return { redirect: { destination: dest, permanent: false } };
}
