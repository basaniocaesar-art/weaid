/**
 * /work/electricians — "Electrician jobs in Kochi — earn with WeAid".
 * Recruitment pages: catch people searching for work in their trade and send
 * them to the WeAid Pro app (or the chat sign-up). Earnings are computed from
 * the same price list customers are charged, so they're never invented.
 */
import { SERVICES, SERVICE_BY_SLUG } from "../../lib/seo-config.js";
import { calculatePrice } from "../../lib/pricing.js";
import { Page, Faq, faqLd, crumbsLd } from "../../components/Seo.js";

const EXTRA = { courier: { slug: "courier-delivery", plural: "Courier Riders", one: "courier rider", trade: "bike courier deliveries", jobs: ["parcel and document delivery across Kochi", "pickups from shops and homes", "same-day local delivery"] } };
const needs = (key) => [
  "An Android phone (for the WeAid Pro app)",
  "A government photo ID — driving licence, voter ID, PAN, passport or masked Aadhaar",
  ...(["driver", "courier"].includes(key) ? ["A valid driving licence" + (key === "courier" ? " and your own bike" : "")] : []),
  ...(["cook", "maid", "babysit", "postnatal", "nursing", "eldercare"].includes(key) ? ["A Kerala Police clearance certificate (from Thuna) is strongly recommended — families choose police-verified carers first"] : []),
  ...(["nursing", "postnatal"].includes(key) ? ["Nursing or caregiving experience"] : []),
];
function examples(key) {
  const P = (a) => calculatePrice({ city: "kochi", scope: "small", slot: "standard", ...a }).providerEarnings;
  const X = {
    electrical: [["Small repair (fan, switch, MCB)", P({ service: "electrical", hours: 1 })], ["Half-day wiring job", P({ service: "electrical", hours: 4 })]],
    plumbing: [["Leaking tap / blocked drain", P({ service: "plumbing", hours: 1 })], ["Half-day plumbing job", P({ service: "plumbing", hours: 4 })]],
    ac: [["AC service (per unit)", P({ service: "ac" })]],
    cleaning: [["2BHK deep clean (team of two)", P({ service: "cleaning", days: 1 })]],
    painting: [["One room", P({ service: "painting", sqft: 300 })]],
    carpentry: [["Day's carpentry", P({ service: "carpentry", days: 1 })]],
    cook: [["One day (2 meals)", P({ service: "cook", days: 1 })], ["Monthly (2 meals a day)", P({ service: "cook", months: 1 })]],
    maid: [["One day (3 hours)", P({ service: "maid", days: 1 })], ["Monthly", P({ service: "maid", months: 1 })]],
    babysit: [["4-hour visit", P({ service: "babysit", days: 1 })], ["Monthly (daytime)", P({ service: "babysit", months: 1 })]],
    postnatal: [["One day (24 hr, live-in)", P({ service: "postnatal", days: 1 })], ["Monthly", P({ service: "postnatal", months: 1 })]],
    nursing: [["12-hour shift", P({ service: "nursing", days: 1 })], ["24-hour shift", P({ service: "nursing", days: 1, scope: "large" })], ["Monthly (24 hr)", P({ service: "nursing", months: 1, scope: "large" })]],
    eldercare: [["12-hour day", P({ service: "eldercare", days: 1 })], ["Monthly", P({ service: "eldercare", months: 1 })]],
    driver: [["3 hours", P({ service: "driver", hours: 3 })], ["Full day", P({ service: "driver", days: 1 })], ["Monthly", P({ service: "driver", months: 1 })]],
    courier: [["4 km delivery", P({ service: "courier", km: 4 })], ["10 km delivery", P({ service: "courier", km: 10 })]],
  };
  return X[key] || [];
}

export default function Work({ tradeKey: k, t, ex, quote }) {
  const job = t.one[0].toUpperCase() + t.one.slice(1);
  const title = `${job} jobs in Kochi — earn with WeAid`;
  const faq = [
    [`How do I get ${t.one} jobs in Kochi?`, `Install the WeAid Pro app, verify your ID (2 minutes), and switch Online. Paid ${t.trade} jobs near you pop up on your phone — tap Accept and the job is yours.`],
    ["Is it free to join?", "Yes. There's no joining fee. WeAid's fee is already inside the customer's price, and you see exactly what you earn before you accept a job."],
    ["When do I get paid?", "Customers pay WeAid when they book. You're paid by UPI for every completed job — weekly."],
    ["Can I choose when I work?", "Yes. Switch Online when you want jobs and Offline when you don't. You can decline any job."],
  ];
  const path = `/work/${t.slug}`;
  return (
    <Page title={title} description={`Earn with WeAid as ${/^[aeiou]/i.test(t.one) ? "an" : "a"} ${t.one} in Kochi. Free to join — paid jobs near you come to your phone. You see what you earn before you accept.`} path={path}
      jsonLd={[crumbsLd([["Work with WeAid", "/work"], [t.plural, path]]), faqLd(faq)]}>
      <div className="crumb"><a href="/work">Work with WeAid</a> › {t.plural}</div>
      <h1>{job} jobs in Kochi</h1>
      <p className="lead">Get paid {t.trade} work near you, on your phone. Free to join — you choose when you work, and you see what you earn before you accept.</p>
      <div className="box" style={{ marginTop: 18, borderColor: "#99f6e4", background: "#f0fdfa" }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>Join WeAid in 3 minutes</div>
        <div className="btns" style={{ maxWidth: 520 }}>
          <a className="btn call" href="/pro">Download WeAid Pro (Android)</a>
          <a className="btn" href={`/?q=${encodeURIComponent(quote)}`}>Sign up in chat</a>
        </div>
      </div>
      {ex.length > 0 && <>
        <h2>What you earn</h2>
        <div className="box">{ex.map(([l, v]) => <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #e7ebf0" }}><span>{l}</span><b>₹{v.toLocaleString("en-IN")}</b></div>)}
          <p className="meta" style={{ marginBottom: 0 }}>What you take home on WeAid's current Kochi prices, after WeAid's fee.</p></div>
      </>}
      <h2>How it works</h2>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
        {[["1. Install & sign up", "WeAid Pro app, your trade and your area."], ["2. Verify your ID", "A photo and a selfie with your ID — WeAid checks it, usually within a day."], ["3. Go online", "Jobs near you ring on your phone. First to accept gets it."], ["4. Get paid", "Customers pay WeAid upfront. You're paid by UPI every week."]].map(([a, b]) => <div key={a} className="card"><b>{a}</b><span className="meta">{b}</span></div>)}
      </div>
      <h2>What you need</h2>
      <div className="box"><ul>{needs(k).map((n) => <li key={n}>{n}</li>)}</ul></div>
      {t.jobs?.length > 0 && <><h2>The kind of work</h2><div className="box"><ul>{t.jobs.map((j) => <li key={j}>{j[0].toUpperCase() + j.slice(1)}</li>)}</ul></div></>}
      <h2>Questions</h2>
      <Faq items={faq} />
    </Page>
  );
}

export async function getStaticPaths() {
  const slugs = [...Object.values(SERVICES).map((s) => s.slug), EXTRA.courier.slug];
  return { paths: slugs.map((trade) => ({ params: { trade } })), fallback: false };
}

export async function getStaticProps({ params }) {
  const key = params.trade === EXTRA.courier.slug ? "courier" : SERVICE_BY_SLUG[params.trade];
  const s = key === "courier" ? EXTRA.courier : SERVICES[key];
  return {
    props: {
      tradeKey: key, ex: examples(key),
      t: { slug: s.slug, plural: s.plural, one: s.one, trade: s.trade, jobs: s.jobs || [] },
      quote: `I want to join WeAid as ${/^[aeiou]/i.test(s.one) ? "an" : "a"} ${s.one}`,
    },
    revalidate: 86400,
  };
}
