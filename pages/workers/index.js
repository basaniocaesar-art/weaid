/** /workers — every "hire workers" page, one per field. */
import { Page, crumbsLd } from "../../components/Seo.js";
import { NICHES } from "../../lib/job-niches.js";
export default function WorkersIndex() {
  return (
    <Page title="Hire workers in Kochi — drivers, maids, technicians, staff | WeAid" description="Find people in Kochi looking for work now — drivers, home nurses, maids, technicians, construction workers, shop and office staff and more. Unlock a number and call." path="/workers" jsonLd={[crumbsLd([["Hire workers in Kochi", "/workers"]])]}>
      <h1>Hire workers in Kochi</h1>
      <p className="lead">People looking for work right now, by field. See experience, area and expected pay, then unlock a number and call — or post a job free.</p>
      <div className="links" style={{ marginTop: 14 }}>{Object.values(NICHES).map((n) => <a key={n.workers.slug} href={`/workers/${n.workers.slug}`}>Hire {n.workers.title}</a>)}</div>
    </Page>
  );
}
