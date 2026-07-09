const PLANS = {
  free: {
    id: "free",
    name: "Free",
    price_idr: 0,
    currency: "IDR",
    interval: "month",
    limits: {
      max_domains: 5,
      max_projects: 2,
      check_interval_min_seconds: 300,
      max_nodes: 0,
      max_rank_groups: 5
    }
  },
  starter: {
    id: "starter",
    name: "Starter",
    price_idr: 99000,
    currency: "IDR",
    interval: "month",
    limits: {
      max_domains: 50,
      max_projects: 10,
      check_interval_min_seconds: 120,
      max_nodes: 3,
      max_rank_groups: 50
    }
  },
  pro: {
    id: "pro",
    name: "Pro",
    price_idr: 299000,
    currency: "IDR",
    interval: "month",
    limits: {
      max_domains: 250,
      max_projects: 50,
      check_interval_min_seconds: 60,
      max_nodes: 15,
      max_rank_groups: 250
    }
  }
};

function listPlans() {
  return Object.values(PLANS);
}

function getPlan(planId = "free") {
  return PLANS[String(planId || "free").toLowerCase()] || PLANS.free;
}

function isPaidPlan(planId) {
  return getPlan(planId).price_idr > 0;
}

module.exports = { PLANS, listPlans, getPlan, isPaidPlan };
