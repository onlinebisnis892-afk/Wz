# WZ MANAGE PRO — ONLINE PHASE 14 FINAL

Build online-first yang mempertahankan UI, alur, dan fallback offline dari sumber WZ MANAGE PRO. Phase 14 Final menambahkan sinkronisasi transaksi dan laporan tutup shift ke PostgreSQL tanpa menghapus 27 fixture KYONGSHIFT001–027 dari data offline.

## Fitur online
- Login/logout dan session server berbasis HttpOnly cookie.
- 5 karyawan + 5 cabang acuan.
- CRUD karyawan Owner/Manager sekaligus pembuatan akun login.
- Transaksi online, void transaksi, dan laporan tutup shift online.
- Sinkronisasi lintas perangkat dengan pembacaan server terlebih dahulu agar snapshot lokal lama tidak menimpa data online.
- Transaksi offline baru akan di-upload saat belum ada di server. VOID offline dikirim saat koneksi kembali.
- 27 fixture KYONGSHIFT001–027 tetap lokal dan tidak dikirim ulang sebagai data server.
- Validasi server untuk ID/status karyawan, nilai transaksi, rumus total transaksi, dan selisih kas shift.
- PostgreSQL transaction block untuk operasi sinkronisasi dan penghapusan karyawan beserta akun.
- Jika API/database tidak tersedia, fungsi lokal tetap menjadi fallback.
- Web Push untuk notifikasi saat aplikasi tertutup tersedia setelah perangkat mengizinkan notifikasi dan server dikonfigurasi dengan VAPID.

## Database
Vercel membutuhkan environment variable database yang menunjuk ke PostgreSQL Neon. API menerima `WZDATABASE` (prioritas utama), `DATABASE_URL`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, atau `NEON_DATABASE_URL`, sehingga URL yang otomatis dibuat Vercel dapat langsung digunakan.

## Konfigurasi Web Push
Tambahkan environment variable berikut di Vercel sebelum memakai notifikasi saat aplikasi tertutup:
- `VAPID_PUBLIC_KEY`: public key VAPID.
- `VAPID_PRIVATE_KEY`: private key VAPID, hanya di server dan jangan dimasukkan ke repository.
- `VAPID_SUBJECT`: URL kontak, misalnya `mailto:admin@example.com`.

Buat pasangan key dengan `npx web-push generate-vapid-keys`. Setelah deployment, login di setiap perangkat, buka Pengaturan, lalu aktifkan Notifikasi Android. Perangkat akan menerima banner laporan shift saat aplikasi sedang tertutup selama browser/PWA dan sistem Android mengizinkan notifikasi.

## Akun seed
- owner / owner123
- manager / manager123
- rizky / rizky123
- alvin / alvin123
- kyong / kyong123
- iwan / iwan123
- dika / dika123

## Batasan scope
Modul pelanggan, layanan, keuangan, laporan, operasional, analisis, notifikasi, cabang, pengaturan, sistem/data, dan keamanan tetap menggunakan mesin UI/data lokal asli. Transaksi yang tersinkron membawa snapshot nama pelanggan, layanan, harga layanan, dan karyawan agar tampilan lintas perangkat tetap dapat dibaca. Ini belum berarti seluruh master data modul tersebut menjadi server-authoritative.

## QA final
- JavaScript API syntax check: wajib lulus.
- Kedua blok JavaScript di `app/index.html`: wajib lulus syntax check.
- Script tag HTML seimbang.
- Offline reference harus identik dengan file sumber asli 135,284 byte.
- Fungsi inti tidak boleh terduplikasi.
- Fixture KYONGSHIFT001–027 harus tetap lengkap.
