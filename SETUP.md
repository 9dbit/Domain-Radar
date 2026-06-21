# Domain Radar Setup

## Replit Import

1. Open Replit.
2. Import this GitHub repository.
3. Add Secrets:
   - DATABASE_URL
   - TELEGRAM_BOT_TOKEN
   - TELEGRAM_CHAT_ID
   - CHECK_INTERVAL_SECONDS
   - STATUS_KEYWORDS
4. Run install:

```bash
npm install
```

5. Start development:

```bash
npm run dev
```

## Database

Create PostgreSQL tables using:

```txt
server/db/schema.sql
```

## STATUS_KEYWORDS example

Use comma-separated keywords for page detection.

```txt
internetpositif,trustpositif,nawala
```

## Proxy format

HTTP proxy:

```txt
http://username:password@host:port
```

SOCKS proxy:

```txt
socks5://username:password@host:port
```

## Important

Provider-specific results depend on the checker source. For better accuracy, use verified mobile or residential proxy sources.
