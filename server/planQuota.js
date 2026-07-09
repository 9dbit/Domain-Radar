const { pool } = require("./db");
const { getPlan } = require("./plans");
const { getSubscription } = require("./billingStore");
const { getUser } = require("./authService");

async function getUsage(userId) {
  const [domains, projects, nodes, rankGroups] = await Promise.all([
    pool.query("SELECT COUNT(*)::int AS count FROM domains WHERE user_id=$1", [userId]),
    pool.query("SELECT COUNT(*)::int AS count FROM projects WHERE user_id=$1", [userId]).catch(() => ({ rows: [{ count: 0 }] })),
    pool.query("SELECT COUNT(*)::int AS count FROM provider_nodes WHERE user_id=$1 AND COALESCE(is_platform_node,false)=false", [userId]).catch(() => ({ rows: [{ count: 0 }] })),
    pool.query("SELECT COUNT(*)::int AS count FROM rank_keyword_groups WHERE user_id=$1", [userId]).catch(() => ({ rows: [{ count: 0 }] }))
  ]);
  return {
    domains: domains.rows[0]?.count || 0,
    projects: projects.rows[0]?.count || 0,
    nodes: nodes.rows[0]?.count || 0,
    rank_groups: rankGroups.rows[0]?.count || 0
  };
}

async function getPlanContext(userId) {
  const subscription = await getSubscription(userId);
  const plan = getPlan(subscription.plan);
  const usage = await getUsage(userId);
  return { subscription, plan, usage };
}

function limitFor(plan, resource) {
  const map = {
    domains: plan.limits.max_domains,
    projects: plan.limits.max_projects,
    nodes: plan.limits.max_nodes,
    rank_groups: plan.limits.max_rank_groups
  };
  return map[resource] ?? Infinity;
}

function currentFor(usage, resource) {
  const map = {
    domains: usage.domains,
    projects: usage.projects,
    nodes: usage.nodes,
    rank_groups: usage.rank_groups
  };
  return map[resource] ?? 0;
}

function requirePlanQuota(resource, options = {}) {
  return async (req, res, next) => {
    try {
      const user = req.user || getUser(req);
      if (!user || user.role === "superadmin" || user.isSuperadmin) return next();
      const increment = typeof options.increment === "function" ? await options.increment(req) : Number(options.increment || 1);
      const requested = Number.isFinite(increment) && increment > 0 ? increment : 1;
      const { plan, usage } = await getPlanContext(user.userId);
      const current = currentFor(usage, resource);
      const limit = limitFor(plan, resource);
      if (Number.isFinite(limit) && current + requested > limit) {
        return res.status(403).json({
          error: "Upgrade your plan",
          code: "PLAN_LIMIT_REACHED",
          resource,
          current,
          requested,
          limit,
          plan: plan.id
        });
      }
      return next();
    } catch (err) { next(err); }
  };
}

module.exports = { getUsage, getPlanContext, requirePlanQuota };
