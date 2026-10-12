/* WeAid legal details — ONE place. Empty values are simply left out of the pages.
   TODO(owner): legal name/form, registered address, grievance officer, email. */
window.WEAID_BIZ = {
  legalName: "Seazars",            // e.g. "Seazars (proprietorship of …)" — confirm exact legal name
  address: "",                     // registered address
  grievanceOfficer: "",            // name of the person who handles complaints
  email: "",                       // a mailbox that is actually read
  phone: "080 6426 7771",
  city: "Kochi, Kerala",
  updated: "8 October 2026",
};
document.querySelectorAll("[data-biz]").forEach((el) => {
  const v = window.WEAID_BIZ[el.dataset.biz];
  if (v) el.textContent = v; else (el.closest("[data-optional]") || el).remove();
});
