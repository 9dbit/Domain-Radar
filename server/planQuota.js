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

function requirePlanQuota(resource) {
  return async (req, res, next) => {
    try {
      const user = req.user || getUser(req);
      if (!user || user.role === "superadmin" || user.isSuperadmin) return next();
      const { plan, usage } = await getPlanContext(user.userId);
      const map = {
        domains: [usage.domains, plan.limits.max_domains],
        projects: [usage.projects, plan.limits.max_projects],
        nodes: [usage.nodes, plan.limits.max_nodes],
        rank_groups: [usage.rank_groups, plan.limits.max_rank_groups]
      };
      const [current, limit] = map[resource] || [0, Infinity];
      if (Number.isFinite(limit) && current >= limit) {
        return res.status(403).json({
          error: "Upgrade your plan",
          code: "PLAN_LIMIT_REACHED",
          resource,
          current,
          limit,
          plan: plan.id
        });
      }
      return next();
    } catch (err) { next(err); }
  };
}

module.exports = { getUsage, getPlanContext, requirePlanQuota };
