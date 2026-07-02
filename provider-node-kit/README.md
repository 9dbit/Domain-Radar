# Provider Node Quick Install Kit

Paket ini dibuat supaya provider node baru bisa dipasang cepat di Replit dan Termux.

## Isi Paket

- `termux-install.sh`: installer cepat untuk HP Android / Termux.
- `REPLIT_SETUP.md`: checklist setup Replit pusat.
- `TERMUX_RUNBOOK.md`: cara install, test, run, restart, dan troubleshoot di Termux.

## Node yang disiapkan

- TELKOMSEL-JKT-01
- XL-JKT-01
- INDOSAT-JKT-01
- TRI-JKT-01
- SMARTFREN-JKT-01
- BIZNET-JKT-01
- INDIHOME-JKT-01

## Alur Cepat

### Replit pusat

```bash
git fetch origin
git reset --hard origin/main
npm install
npm run nodes:seed
npm run build
npm run start
```

### Termux per HP provider

```bash
pkg update -y
pkg install -y git nodejs termux-api
cd ~
git clone https://github.com/9dbit/Domain-Radar.git
cd Domain-Radar
bash provider-node-kit/termux-install.sh
```

### Jalankan agent

```bash
cd ~/Domain-Radar
./run-provider-node.sh
```

Kalau sudah benar, dashboard akan berubah dari `waiting` menjadi `online`.
