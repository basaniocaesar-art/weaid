/** /engineering-jobs — Kochi Engineering Jobs (lib/job-niches.js). */
import NicheBoard from "../components/NicheBoard.js";
import { NICHES } from "../lib/job-niches.js";
export default NicheBoard;

const SLUG = "engineering-jobs";
export async function getServerSideProps({ res }) {
  const n = NICHES[SLUG];
  res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");
  let jobs = [];
  try { const { liveJobs } = await import("../lib/jobportal.js"); jobs = await liveJobs({ roles: n.roles, limit: 100 }); } catch {}
  return { props: { n, slug: SLUG, jobs } };
}
