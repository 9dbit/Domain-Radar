# Replit Setup Checklist

Run this in the Replit shell before installing new phones:

```bash
git fetch origin
git reset --hard origin/main
npm install
npm run nodes:seed
npm run build
npm run start
```

Health check:

```bash
curl https://domain-radar.org/api/nodes
```

Expected result:

- provider node rows exist
- endpoint starts with `poll://`
- status is `waiting` before phone agent starts
- status becomes `online` after phone agent starts

When using Replit Deployment, click Republish after build.
