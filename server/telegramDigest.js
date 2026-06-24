function buildDigest(domains) {
  return domains.map((domain) => `${domain.status} ${domain.domain}`).join('\n');
}

module.exports = { buildDigest };
