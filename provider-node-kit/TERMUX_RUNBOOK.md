# Termux Provider Node Runbook

## Install awal

```bash
pkg update -y
pkg install -y git nodejs termux-api
cd ~
git clone https://github.com/9dbit/Domain-Radar.git
cd Domain-Radar
bash provider-node-kit/termux-install.sh
```

## Jalankan agent

```bash
cd ~/Domain-Radar
./run-provider-node.sh
```

## Restart agent

Tekan `CTRL + C`, lalu jalankan lagi:

```bash
./run-provider-node.sh
```

## Update package dari GitHub

```bash
cd ~/Domain-Radar
git fetch origin
git reset --hard origin/main
npm install --omit=dev
```

## Cek log

```bash
tail -f ~/Domain-Radar/provider-node.log
```

## Cek baterai Termux

```bash
termux-battery-status
```

Catatan: install aplikasi Termux:API di Android juga, bukan hanya package `termux-api` di shell.

## Gejala umum

### Invalid node credentials

Artinya Node name atau Agent secret tidak sama dengan data di dashboard/database.

### wrong network

Artinya kartu/jaringan HP tidak sesuai provider yang dipilih, atau org dari IP publik tidak cocok dengan keyword yang dimasukkan.

### network check failed

Biasanya koneksi HP belum aktif, DNS bermasalah, atau situs IP info sedang timeout.

### Node tetap waiting

Pastikan agent masih jalan, layar HP tidak mematikan Termux, dan koneksi data aktif.
