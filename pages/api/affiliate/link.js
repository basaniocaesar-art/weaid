export default async function handler(req, res) {
  const { refCode } = req.query;

  if (!refCode) {
    return res.redirect(302, "/");
  }

  const baseUrl = process.env.NEXT_PUBLIC_URL || "https://weaid.in";
  return res.redirect(302, `${baseUrl}/?ref=${encodeURIComponent(refCode)}`);
}
