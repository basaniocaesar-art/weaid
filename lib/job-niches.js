/**
 * One job board per field (owner's call, 27 Oct 2026): a nurse looking for work
 * trusts "the board for nurses" more than a general jobs list, and an employer
 * pays more to be seen there. Each entry is a page at /<slug> with its own name;
 * the jobs are ordinary WeAid Jobs rows whose role is in `roles`.
 */
/** The board a role belongs to, if any — "/driver-jobs" for "Driver". */
export const boardFor = (role) => {
  const hit = Object.entries(NICHES).find(([, n]) => n.roles.includes(role));
  return hit ? `/${hit[0]}` : null;
};

export const NICHES = {
  "home-nurse-jobs": {
    brand: "Kochi Nurse Jobs",
    icon: "+",
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
  "driver-jobs": {
    brand: "Kochi Driver Jobs",
    icon: "🚗",
    roles: ["Driver", "Delivery boy"],
    headline: "Find your next driver job in Kochi",
    sub: "The job board just for drivers in Ernakulam — family and company drivers, cab, delivery and heavy-vehicle jobs. Apply free — you never pay a fee.",
    one: "driver",
    postRole: "Driver",
    areas: ["Kakkanad", "Edappally", "Kaloor", "Vyttila", "Palarivattom", "Aluva", "Kalamassery", "Tripunithura", "Angamaly", "Fort Kochi", "Ernakulam North", "Ernakulam South", "Perumbavoor"],
    faq: [
      ["Do I pay anything to apply?", "No. WeAid never charges job seekers. If an employer asks you for a fee or a deposit to get the job, don't pay — report it to us."],
      ["What licence do I need?", "Car jobs need a light motor vehicle (LMV) licence; delivery jobs usually need a two-wheeler licence; truck and bus jobs need a heavy (HMV/HGV) licence and a badge. Each job says what it needs."],
      ["How much do drivers earn in Kochi?", "Usually ₹15,000–₹30,000 a month for family and company drivers, more for heavy vehicles. Delivery pay often depends on orders. Each job shows its salary."],
      ["I need a driver. How do I post?", "Tap 'Post a job'. Your first post is free, and applicants' profiles and phone numbers come straight to your email."],
    ],
  },
  "hotel-jobs": {
    brand: "Kochi Hotel Jobs",
    icon: "🍽",
    roles: ["Hotel / restaurant staff", "Waiter", "Chef", "Cook", "Kitchen helper", "Housekeeping"],
    headline: "Find your next hotel or restaurant job in Kochi",
    sub: "The job board just for hotel, restaurant and café staff in Ernakulam — cooks, chefs, waiters, kitchen and housekeeping. Apply free — you never pay a fee.",
    one: "hotel or restaurant worker",
    postRole: "Hotel / restaurant staff",
    areas: ["Marine Drive", "MG Road", "Fort Kochi", "Kakkanad", "Edappally", "Kaloor", "Vyttila", "Palarivattom", "Aluva", "Kalamassery", "Willingdon Island", "Nedumbassery"],
    faq: [
      ["Do I pay anything to apply?", "No. WeAid never charges job seekers. If an employer asks you for a fee or a deposit to get the job, don't pay — report it to us."],
      ["Do these jobs give food and stay?", "Many hotel and restaurant jobs in Kochi include food, and some include accommodation. Each job says what it offers."],
      ["How much do hotel staff earn in Kochi?", "Roughly ₹12,000–₹20,000 a month for helpers and waiters, ₹18,000–₹40,000+ for cooks and chefs, depending on experience. Each job shows its salary."],
      ["I run a hotel or restaurant. How do I post?", "Tap 'Post a job'. Your first post is free, and applicants' profiles and phone numbers come straight to your email."],
    ],
  },
  "sales-jobs": {
    brand: "Kochi Sales Jobs",
    icon: "📈",
    roles: ["Sales executive", "Telecaller", "Field executive"],
    headline: "Find your next sales or telecaller job in Kochi",
    sub: "The job board just for sales executives, telecallers and field staff in Ernakulam — with a fixed salary shown on every job. Apply free — you never pay a fee.",
    one: "sales executive or telecaller",
    postRole: "Sales executive",
    areas: ["Kakkanad", "Edappally", "Palarivattom", "Kaloor", "Vyttila", "MG Road", "Aluva", "Kalamassery", "Tripunithura", "Ernakulam North", "Ernakulam South", "Infopark"],
    faq: [
      ["Do I pay anything to apply?", "No. WeAid never charges job seekers. If an employer asks you to pay a fee or buy a starter kit, don't — report it to us. We don't list network-marketing or commission-only jobs."],
      ["Do I need experience?", "Many telecaller and sales jobs take freshers and train you. Malayalam and basic English help. Each job says what it needs."],
      ["How much do sales staff earn in Kochi?", "Telecallers usually earn ₹12,000–₹20,000 a month and sales executives ₹15,000–₹30,000, plus incentives. Each job shows its fixed salary."],
      ["I'm hiring sales staff. How do I post?", "Tap 'Post a job'. Your first post is free, and applicants' profiles and phone numbers come straight to your email."],
    ],
  },
  "office-jobs": {
    brand: "Kochi Shop & Office Jobs",
    icon: "🏬",
    roles: ["Shop staff", "Cashier", "Receptionist", "Office assistant", "Accountant", "Data entry"],
    headline: "Find your next shop or office job in Kochi",
    sub: "The job board just for shop staff, cashiers, receptionists, office assistants and accountants in Ernakulam. Apply free — you never pay a fee.",
    one: "shop or office worker",
    postRole: "Shop staff",
    areas: ["MG Road", "Kakkanad", "Edappally", "Kaloor", "Vyttila", "Palarivattom", "Aluva", "Kalamassery", "Tripunithura", "Ernakulam North", "Ernakulam South", "Infopark"],
    faq: [
      ["Do I pay anything to apply?", "No. WeAid never charges job seekers. If an employer asks you for a fee or a deposit, don't pay — report it to us. We don't list work-from-home 'data entry' earning schemes."],
      ["Do I need experience?", "Many shop and front-desk jobs take freshers. Accounts jobs usually ask for B.Com and Tally. Each job says what it needs."],
      ["How much do shop and office staff earn in Kochi?", "Usually ₹12,000–₹20,000 a month for shop staff and receptionists, ₹15,000–₹30,000 for accountants. Each job shows its salary."],
      ["I'm hiring. How do I post?", "Tap 'Post a job'. Your first post is free, and applicants' profiles and phone numbers come straight to your email."],
    ],
  },
};
