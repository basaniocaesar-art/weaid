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
    roles: ["Hotel / restaurant staff", "Waiter", "Chef", "Cook", "Kitchen helper", "Housekeeping", "Event staff / promoter"],
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
    roles: ["Shop staff", "Cashier", "Receptionist", "Office assistant", "Accountant", "Data entry", "HR / recruiter"],
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
  "home-help-jobs": {
    "brand": "Kochi Home Help Jobs",
    "icon": "🏠",
    "roles": [
      "Housemaid",
      "Babysitter / nanny", "Gardener", "Cleaner / office boy"
    ],
    "headline": "Find your next housemaid or nanny job in Kochi",
    "sub": "The job board just for housemaids, home helpers, babysitters and nannies in Ernakulam — daily and live-in jobs. Apply free — you never pay a fee.",
    "one": "home helper or nanny",
    "postRole": "Housemaid",
    "areas": [
      "Kakkanad",
      "Edappally",
      "Kaloor",
      "Vyttila",
      "Palarivattom",
      "Aluva",
      "Kalamassery",
      "Tripunithura",
      "Angamaly",
      "Fort Kochi",
      "Ernakulam North",
      "Ernakulam South",
      "Perumbavoor"
    ],
    "faq": [
      [
        "Do I pay anything to apply?",
        "No. WeAid never charges job seekers. If an employer asks you for a fee or a deposit to get the job, don't pay — report it to us."
      ],
      [
        "Are these live-in jobs?",
        "Some are live-in with food and stay, others are day jobs. Each job says which, and the hours."
      ],
      [
        "How much do home helpers earn in Kochi?",
        "Usually ₹10,000–₹20,000 a month, more for live-in and childcare jobs. Each job shows its salary."
      ],
      [
        "I'm hiring. How do I post?",
        "Tap 'Post a job'. Your first post is free, and applicants' profiles and phone numbers come straight to your email."
      ]
    ]
  },
  "security-jobs": {
    "brand": "Kochi Security Jobs",
    "icon": "🛡",
    "roles": [
      "Security guard"
    ],
    "headline": "Find your next security guard job in Kochi",
    "sub": "The job board just for security guards and supervisors in Ernakulam — apartments, offices, malls, hospitals and factories. Apply free — you never pay a fee.",
    "one": "security guard",
    "postRole": "Security guard",
    "areas": [
      "Kakkanad",
      "Edappally",
      "Kaloor",
      "Vyttila",
      "Palarivattom",
      "Aluva",
      "Kalamassery",
      "Tripunithura",
      "Angamaly",
      "Fort Kochi",
      "Ernakulam North",
      "Ernakulam South",
      "Perumbavoor"
    ],
    "faq": [
      [
        "Do I pay anything to apply?",
        "No. WeAid never charges job seekers. If an employer asks you for a fee or a deposit to get the job, don't pay — report it to us."
      ],
      [
        "Do I need experience or training?",
        "Many guard jobs take freshers; ex-servicemen and people with security training are preferred for some. Each job says what it needs."
      ],
      [
        "How much do security guards earn in Kochi?",
        "Usually ₹13,000–₹22,000 a month, more for supervisors and gunmen. Each job shows its salary."
      ],
      [
        "I'm hiring. How do I post?",
        "Tap 'Post a job'. Your first post is free, and applicants' profiles and phone numbers come straight to your email."
      ]
    ]
  },
  "technician-jobs": {
    "brand": "Kochi Technician Jobs",
    "icon": "🔧",
    "roles": [
      "Electrician",
      "Plumber",
      "AC technician",
      "Mechanic",
      "Welder"
    ],
    "headline": "Find your next technician job in Kochi",
    "sub": "The job board just for electricians, plumbers, AC technicians, mechanics and welders in Ernakulam. Apply free — you never pay a fee.",
    "one": "technician",
    "postRole": "Electrician",
    "areas": [
      "Kakkanad",
      "Edappally",
      "Kaloor",
      "Vyttila",
      "Palarivattom",
      "Aluva",
      "Kalamassery",
      "Tripunithura",
      "Angamaly",
      "Fort Kochi",
      "Ernakulam North",
      "Ernakulam South",
      "Perumbavoor"
    ],
    "faq": [
      [
        "Do I pay anything to apply?",
        "No. WeAid never charges job seekers. If an employer asks you for a fee or a deposit to get the job, don't pay — report it to us."
      ],
      [
        "Do I need ITI?",
        "Many jobs ask for ITI or a diploma; others take experience instead. Each job says what it needs."
      ],
      [
        "How much do technicians earn in Kochi?",
        "Usually ₹15,000–₹30,000 a month depending on trade and experience. Each job shows its salary."
      ],
      [
        "Do you also have one-off home repair work?",
        "Yes — skilled technicians can also join WeAid Pro and get paid repair jobs near them on their phone: weaid.in/pro."
      ],
      [
        "I'm hiring. How do I post?",
        "Tap 'Post a job'. Your first post is free, and applicants' profiles and phone numbers come straight to your email."
      ]
    ]
  },
  "construction-jobs": {
    "brand": "Kochi Construction Jobs",
    "icon": "🏗",
    "roles": [
      "Carpenter",
      "Painter",
      "Mason",
      "Helper / labour"
    ],
    "headline": "Find your next construction job in Kochi",
    "sub": "The job board just for carpenters, painters, masons and site helpers in Ernakulam. Apply free — you never pay a fee.",
    "one": "construction worker",
    "postRole": "Carpenter",
    "areas": [
      "Kakkanad",
      "Edappally",
      "Kaloor",
      "Vyttila",
      "Palarivattom",
      "Aluva",
      "Kalamassery",
      "Tripunithura",
      "Angamaly",
      "Fort Kochi",
      "Ernakulam North",
      "Ernakulam South",
      "Perumbavoor"
    ],
    "faq": [
      [
        "Do I pay anything to apply?",
        "No. WeAid never charges job seekers. If an employer asks you for a fee or a deposit to get the job, don't pay — report it to us."
      ],
      [
        "Is the pay monthly or daily?",
        "We list jobs with a monthly salary. Each job shows its pay and hours."
      ],
      [
        "How much do construction workers earn in Kochi?",
        "Usually ₹15,000–₹30,000 a month for skilled trades, less for helpers. Each job shows its salary."
      ],
      [
        "I'm hiring. How do I post?",
        "Tap 'Post a job'. Your first post is free, and applicants' profiles and phone numbers come straight to your email."
      ]
    ]
  },
  "beauty-fitness-jobs": {
    "brand": "Kochi Beauty & Fitness Jobs",
    "icon": "✨",
    "roles": [
      "Beautician",
      "Fitness trainer", "Barber / hair stylist"
    ],
    "headline": "Find your next beautician or trainer job in Kochi",
    "sub": "The job board just for beauticians, hair stylists, makeup artists, spa therapists and fitness trainers in Ernakulam. Apply free — you never pay a fee.",
    "one": "beautician or trainer",
    "postRole": "Beautician",
    "areas": [
      "Kakkanad",
      "Edappally",
      "Kaloor",
      "Vyttila",
      "Palarivattom",
      "Aluva",
      "Kalamassery",
      "Tripunithura",
      "Angamaly",
      "Fort Kochi",
      "Ernakulam North",
      "Ernakulam South",
      "Perumbavoor"
    ],
    "faq": [
      [
        "Do I pay anything to apply?",
        "No. WeAid never charges job seekers. If an employer asks you for a fee or a deposit to get the job, don't pay — report it to us."
      ],
      [
        "Do I need a certificate?",
        "Salons usually ask for a beautician course or experience; gyms usually ask for a fitness certification. Each job says what it needs."
      ],
      [
        "How much do beauticians and trainers earn in Kochi?",
        "Usually ₹12,000–₹30,000 a month, plus incentives at many salons and gyms. Each job shows its salary."
      ],
      [
        "I'm hiring. How do I post?",
        "Tap 'Post a job'. Your first post is free, and applicants' profiles and phone numbers come straight to your email."
      ]
    ]
  },
  "teacher-jobs": {
    "brand": "Kochi Teacher Jobs",
    "icon": "📚",
    "roles": [
      "Teacher / tutor"
    ],
    "headline": "Find your next teaching job in Kochi",
    "sub": "The job board just for teachers and tutors in Ernakulam — schools, tuition centres, preschools and coaching centres. Apply free — you never pay a fee.",
    "one": "teacher or tutor",
    "postRole": "Teacher / tutor",
    "areas": [
      "Kakkanad",
      "Edappally",
      "Kaloor",
      "Vyttila",
      "Palarivattom",
      "Aluva",
      "Kalamassery",
      "Tripunithura",
      "Angamaly",
      "Fort Kochi",
      "Ernakulam North",
      "Ernakulam South",
      "Perumbavoor"
    ],
    "faq": [
      [
        "Do I pay anything to apply?",
        "No. WeAid never charges job seekers. If an employer asks you for a fee or a deposit to get the job, don't pay — report it to us."
      ],
      [
        "What qualifications do these jobs ask for?",
        "Schools usually ask for a degree with B.Ed; tuition and coaching centres often take a degree in the subject. Each job says what it needs."
      ],
      [
        "How much do teachers earn in Kochi?",
        "Usually ₹12,000–₹30,000 a month depending on the school and subject. Each job shows its salary."
      ],
      [
        "I'm hiring. How do I post?",
        "Tap 'Post a job'. Your first post is free, and applicants' profiles and phone numbers come straight to your email."
      ]
    ]
  },
  "warehouse-jobs": {
    "brand": "Kochi Warehouse Jobs",
    "icon": "📦",
    "roles": [
      "Warehouse / packing"
    ],
    "headline": "Find your next warehouse or packing job in Kochi",
    "sub": "The job board just for warehouse, packing, loading, store-keeping and factory-floor jobs in Ernakulam. Apply free — you never pay a fee.",
    "one": "warehouse worker",
    "postRole": "Warehouse / packing",
    "areas": [
      "Kakkanad",
      "Edappally",
      "Kaloor",
      "Vyttila",
      "Palarivattom",
      "Aluva",
      "Kalamassery",
      "Tripunithura",
      "Angamaly",
      "Fort Kochi",
      "Ernakulam North",
      "Ernakulam South",
      "Perumbavoor"
    ],
    "faq": [
      [
        "Do I pay anything to apply?",
        "No. WeAid never charges job seekers. If an employer asks you for a fee or a deposit to get the job, don't pay — report it to us."
      ],
      [
        "Do I need experience?",
        "Many packing and helper jobs take freshers; store-keeper and forklift jobs ask for experience. Each job says what it needs."
      ],
      [
        "How much do warehouse jobs pay in Kochi?",
        "Usually ₹12,000–₹22,000 a month. Each job shows its salary. We don't list work-from-home packing schemes."
      ],
      [
        "I'm hiring. How do I post?",
        "Tap 'Post a job'. Your first post is free, and applicants' profiles and phone numbers come straight to your email."
      ]
    ]
  },
  "tailor-jobs": {
    "brand": "Kochi Tailoring Jobs",
    "icon": "🧵",
    "roles": [
      "Tailor"
    ],
    "headline": "Find your next tailoring job in Kochi",
    "sub": "The job board just for tailors, stitching staff and garment workers in Ernakulam — boutiques, showrooms and garment units. Apply free — you never pay a fee.",
    "one": "tailor",
    "postRole": "Tailor",
    "areas": [
      "Kakkanad",
      "Edappally",
      "Kaloor",
      "Vyttila",
      "Palarivattom",
      "Aluva",
      "Kalamassery",
      "Tripunithura",
      "Angamaly",
      "Fort Kochi",
      "Ernakulam North",
      "Ernakulam South",
      "Perumbavoor"
    ],
    "faq": [
      [
        "Do I pay anything to apply?",
        "No. WeAid never charges job seekers. If an employer asks you for a fee or a deposit to get the job, don't pay — report it to us."
      ],
      [
        "Is the pay monthly or per piece?",
        "We list jobs with a monthly salary. Each job shows its pay."
      ],
      [
        "How much do tailors earn in Kochi?",
        "Usually ₹12,000–₹25,000 a month depending on skill. Each job shows its salary."
      ],
      [
        "I'm hiring. How do I post?",
        "Tap 'Post a job'. Your first post is free, and applicants' profiles and phone numbers come straight to your email."
      ]
    ]
  },
  "it-jobs": {
    "brand": "Kochi IT Jobs",
    "icon": "💻",
    "roles": [
      "Software developer",
      "IT support",
      "Data analyst",
      "UI/UX designer",
      "QA / tester"
    ],
    "headline": "Find your next IT job in Kochi",
    "sub": "The job board just for developers, IT support, data, design and testing jobs in Kochi — Infopark, SmartCity and beyond. Apply free — you never pay a fee.",
    "one": "IT professional",
    "postRole": "Software developer",
    "areas": [
      "Kakkanad",
      "Infopark",
      "SmartCity",
      "Edappally",
      "Kaloor",
      "Vyttila",
      "Palarivattom",
      "Kalamassery",
      "Aluva",
      "MG Road",
      "Ernakulam North",
      "Ernakulam South",
      "Tripunithura"
    ],
    "faq": [
      [
        "Do I pay anything to apply?",
        "No. WeAid never charges job seekers. If an employer asks you for a fee, a training charge or a deposit, don't pay — report it to us."
      ],
      [
        "Are there jobs for freshers?",
        "Yes — many developer, support and testing jobs take freshers. Each job says the experience it wants."
      ],
      [
        "How much do IT jobs pay in Kochi?",
        "Freshers usually start around ₹15,000–₹30,000 a month; experienced developers earn much more. Each job shows its salary."
      ],
      [
        "Is any of this a paid training course?",
        "No. We don't list jobs that ask you to pay for training, a bond deposit or a course."
      ],
      [
        "I'm hiring. How do I post?",
        "Tap 'Post a job'. Your first post is free, and applicants' profiles and phone numbers come straight to your email."
      ]
    ]
  },
  "marketing-jobs": {
    "brand": "Kochi Marketing & Creative Jobs",
    "icon": "📣",
    "roles": [
      "Digital marketing",
      "Marketing executive",
      "Content writer",
      "Graphic designer",
      "Video editor", "Photographer / videographer"
    ],
    "headline": "Find your next marketing or creative job in Kochi",
    "sub": "The job board just for digital marketers, social media, content writers, graphic designers and video editors in Kochi. Apply free — you never pay a fee.",
    "one": "marketer or designer",
    "postRole": "Digital marketing",
    "areas": [
      "Kakkanad",
      "Infopark",
      "SmartCity",
      "Edappally",
      "Kaloor",
      "Vyttila",
      "Palarivattom",
      "Kalamassery",
      "Aluva",
      "MG Road",
      "Ernakulam North",
      "Ernakulam South",
      "Tripunithura"
    ],
    "faq": [
      [
        "Do I pay anything to apply?",
        "No. WeAid never charges job seekers. If an employer asks you for a fee, a training charge or a deposit, don't pay — report it to us."
      ],
      [
        "Do I need a portfolio?",
        "For design, video and writing jobs a few samples help a lot — add a link in your profile. Marketing jobs ask for tools like Meta Ads, Google Ads or SEO."
      ],
      [
        "How much do these jobs pay in Kochi?",
        "Usually ₹15,000–₹35,000 a month depending on skill and experience. Each job shows its salary."
      ],
      [
        "I'm hiring. How do I post?",
        "Tap 'Post a job'. Your first post is free, and applicants' profiles and phone numbers come straight to your email."
      ]
    ]
  },
  "healthcare-jobs": {
    "brand": "Kochi Healthcare Jobs",
    "icon": "🏥",
    "roles": [
      "Staff nurse",
      "Pharmacist",
      "Lab technician", "Hospital attendant"
    ],
    "headline": "Find your next hospital or clinic job in Kochi",
    "sub": "The job board just for hospital and clinic staff nurses, pharmacists and lab technicians in Ernakulam. Apply free — you never pay a fee.",
    "one": "healthcare worker",
    "postRole": "Staff nurse",
    "areas": [
      "Kakkanad",
      "Infopark",
      "SmartCity",
      "Edappally",
      "Kaloor",
      "Vyttila",
      "Palarivattom",
      "Kalamassery",
      "Aluva",
      "MG Road",
      "Ernakulam North",
      "Ernakulam South",
      "Tripunithura"
    ],
    "faq": [
      [
        "Do I pay anything to apply?",
        "No. WeAid never charges job seekers. If an employer asks you for a fee, a training charge or a deposit, don't pay — report it to us."
      ],
      [
        "Do I need Kerala registration?",
        "Nursing and pharmacy jobs usually ask for Kerala council registration; lab jobs ask for DMLT or BSc MLT. Each job says what it needs."
      ],
      [
        "Are these jobs abroad?",
        "No — every job here is in Ernakulam. We don't list Gulf or overseas recruitment."
      ],
      [
        "Looking for home-nursing work instead?",
        "See Kochi Nurse Jobs at weaid.in/home-nurse-jobs."
      ],
      [
        "I'm hiring. How do I post?",
        "Tap 'Post a job'. Your first post is free, and applicants' profiles and phone numbers come straight to your email."
      ]
    ]
  },
  "engineering-jobs": {
    "brand": "Kochi Engineering Jobs",
    "icon": "⚙️",
    "roles": [
      "Engineer"
    ],
    "headline": "Find your next engineering job in Kochi",
    "sub": "The job board just for civil, mechanical, electrical, site and maintenance engineers in Ernakulam. Apply free — you never pay a fee.",
    "one": "engineer",
    "postRole": "Engineer",
    "areas": [
      "Kakkanad",
      "Infopark",
      "SmartCity",
      "Edappally",
      "Kaloor",
      "Vyttila",
      "Palarivattom",
      "Kalamassery",
      "Aluva",
      "MG Road",
      "Ernakulam North",
      "Ernakulam South",
      "Tripunithura"
    ],
    "faq": [
      [
        "Do I pay anything to apply?",
        "No. WeAid never charges job seekers. If an employer asks you for a fee, a training charge or a deposit, don't pay — report it to us."
      ],
      [
        "Are there jobs for fresh graduates?",
        "Yes — many site and junior engineer jobs take freshers with a B.Tech or diploma. Each job says what it needs."
      ],
      [
        "How much do engineers earn in Kochi?",
        "Usually ₹15,000–₹40,000 a month depending on branch and experience. Each job shows its salary."
      ],
      [
        "I'm hiring. How do I post?",
        "Tap 'Post a job'. Your first post is free, and applicants' profiles and phone numbers come straight to your email."
      ]
    ]
  },
  "customer-support-jobs": {
    "brand": "Kochi Customer Support Jobs",
    "icon": "🎧",
    "roles": [
      "Customer support",
      "Telecaller"
    ],
    "headline": "Find your next customer support job in Kochi",
    "sub": "The job board just for customer support, chat, email and call-centre jobs in Kochi. Apply free — you never pay a fee.",
    "one": "customer support executive",
    "postRole": "Customer support",
    "areas": [
      "Kakkanad",
      "Infopark",
      "SmartCity",
      "Edappally",
      "Kaloor",
      "Vyttila",
      "Palarivattom",
      "Kalamassery",
      "Aluva",
      "MG Road",
      "Ernakulam North",
      "Ernakulam South",
      "Tripunithura"
    ],
    "faq": [
      [
        "Do I pay anything to apply?",
        "No. WeAid never charges job seekers. If an employer asks you for a fee, a training charge or a deposit, don't pay — report it to us."
      ],
      [
        "Do I need experience?",
        "Many support jobs take freshers with good Malayalam and English. Each job says the languages and shifts it needs."
      ],
      [
        "How much do support jobs pay in Kochi?",
        "Usually ₹12,000–₹25,000 a month, sometimes with night-shift allowance. Each job shows its salary."
      ],
      [
        "I'm hiring. How do I post?",
        "Tap 'Post a job'. Your first post is free, and applicants' profiles and phone numbers come straight to your email."
      ]
    ]
  },
};
