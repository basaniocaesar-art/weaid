/**
 * One job board per field (owner's call, 27 Oct 2026): a nurse looking for work
 * trusts "the board for nurses" more than a general jobs list, and an employer
 * pays more to be seen there. Each entry is a page at /<slug> with its own name;
 * the jobs are ordinary WeAid Jobs rows whose role is in `roles`.
 */
export const NICHES = {
  "home-nurse-jobs": {
    brand: "Kochi Nurse Jobs",
    roles: ["Home nurse", "Caregiver"],
    headline: "Find your next home nurse job in Kochi",
    sub: "The job board just for home nurses, caregivers and patient-care staff in Ernakulam. Apply free — you never pay a fee.",
    one: "home nurse",
    postRole: "Home nurse",
    areas: ["Kakkanad", "Edappally", "Kaloor", "Vyttila", "Palarivattom", "Aluva", "Kalamassery", "Tripunithura", "Fort Kochi", "Ernakulam North", "Ernakulam South", "Thrikkakara"],
    faq: [
      ["Do I pay anything to apply?", "No. WeAid never charges job seekers. If any employer asks you for a registration, training or deposit fee, don't pay — report it to us."],
      ["What qualifications do these jobs ask for?", "Most home-nursing jobs ask for GNM, ANM, B.Sc Nursing, GDA or a home-nurse certificate. Many caregiver jobs take freshers and train you."],
      ["How much do home nurses earn in Kochi?", "Usually ₹15,000–₹40,000 a month, depending on qualification, experience and whether the job is live-in, day shift or night shift. Each job shows its salary."],
      ["I'm hiring a nurse. How do I post?", "Tap 'Post a job'. Your first post is free, and applicants' profiles and phone numbers come straight to your email."],
    ],
  },
};
