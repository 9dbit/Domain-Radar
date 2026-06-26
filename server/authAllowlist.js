function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function getAdminEmailWhitelist() {
  return String(process.env.ADMIN_EMAIL_WHITELIST || process.env.ADMIN_WHITELIST_EMAILS || "")
    .split(/[\n,;\s]+/)
    .map(normalizeEmail)
    .filter(Boolean);
}

function isEmailWhitelistEnabled() {
  return getAdminEmailWhitelist().length > 0;
}

function isEmailAllowed(email) {
  const whitelist = getAdminEmailWhitelist();
  if (!whitelist.length) return true;
  return whitelist.includes(normalizeEmail(email));
}

module.exports = {
  normalizeEmail,
  getAdminEmailWhitelist,
  isEmailWhitelistEnabled,
  isEmailAllowed
};
