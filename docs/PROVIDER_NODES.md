# Domain Radar Provider Nodes

Provider Node adalah checker kecil yang berjalan dari jaringan asli: Telkomsel, XL, Indosat, Tri, IndiHome, Biznet, VPS, atau proxy gateway. Node pusat Domain Radar akan memanggil endpoint node untuk mengecek domain dari jaringan tersebut.

## 1. Jalankan agent di node provider

Install dependency:

```bash
npm install
```

Set environment:

```bash
export PROVIDER_NAME="TELKOMSEL-JKT-01"
export NETWORK_TYPE="mobile"
export AGENT_SECRET="secret-random-kuat"
export AGENT_PORT=4100
npm run agent
```

Health check:

```bash
curl -H "x-domain-radar-secret: secret-random-kuat" http://localhost:4100/health
```

Domain check:

```bash
curl -X POST http://localhost:4100/check \
  -H "content-type: application/json" \
  -H "x-domain-radar-secret: secret-random-kuat" \
  -d '{"domain":"google.com"}'
```

## 2. Expose node ke internet

Opsi aman:

- Cloudflare Tunnel
- Tailscale Funnel
- Ngrok
- VPS reverse proxy

Endpoint yang dimasukkan ke dashboard cukup base URL, contoh:

```text
https://telkomsel-jkt-01.your-tunnel.com
```

Jangan masukkan `/health` atau `/check` di dashboard. Sistem akan menambahkan path otomatis.

## 3. Tambahkan ke Domain Radar

Buka:

```text
Settings -> Provider Nodes
```

Isi:

```text
Name: TELKOMSEL-JKT-01
Provider: Telkomsel
Type: mobile
Endpoint URL: https://telkomsel-jkt-01.your-tunnel.com
Secret Key: secret-random-kuat
```

Klik Add Node, lalu Ping.

## 4. Contoh node broadband

```bash
export PROVIDER_NAME="BIZNET-JKT-01"
export NETWORK_TYPE="broadband"
export AGENT_SECRET="secret-random-kuat"
npm run agent
```

## 5. Contoh node Android Termux

```bash
pkg update
pkg install nodejs git
npm install
export PROVIDER_NAME="TELKOMSEL-ANDROID-01"
export NETWORK_TYPE="mobile"
export AGENT_SECRET="secret-random-kuat"
export AGENT_PORT=4100
npm run agent
```

Lalu expose via Cloudflare Tunnel/Tailscale/ngrok.

## 6. Cara kerja scheduler

Setiap run scheduler, Domain Radar mengecek domain melalui:

1. Direct checker
2. Proxy Center
3. Provider Node Center

Semua hasil masuk ke `check_results` dengan `checker_type` seperti:

```text
direct
proxy
node:mobile
node:broadband
node:vps
```

Global status domain akan dihitung dari semua checker aktif.
