# PRIORA — Dashboard Prioritas Kesiapsiagaan Banjir

Dashboard demonstrasi **ISIF 2026** untuk membantu pengguna menyusun prioritas
kesiapsiagaan banjir kabupaten/kota satu bulan ke depan. Antarmuka menggabungkan:

- probabilitas laporan banjir terkalibrasi sebagai **Hazard (H)**;
- indikator sosial-ekonomi sebagai **Vulnerability (V)**;
- indeks ketahanan daerah sebagai **Capacity (C)**;
- pemeringkatan kebijakan TOPSIS dengan bobot awal H 40%, V 30%, C 30%.

Dashboard ini adalah alat bantu prioritisasi, bukan sistem peringatan dini dan
bukan pengganti keputusan BNPB/BPBD.

## Menjalankan dashboard

### Cara termudah di Windows

Klik dua kali `START_PRIORA.bat`. Browser akan membuka:

`http://127.0.0.1:8765/`

Biarkan jendela terminal tetap terbuka selama dashboard digunakan.

### Melalui terminal

```powershell
cd "C:\path\ke\PRIORA-dashboard"
python -m http.server 8765 --bind 127.0.0.1
```

Lalu buka `http://127.0.0.1:8765/`. Jangan membuka `index.html` langsung melalui
`file://`, karena browser perlu mengambil berkas data JSON dan GeoJSON melalui HTTP.

Semua aset aplikasi bersifat lokal. Setelah folder tersedia, demo lokal tidak
memerlukan CDN atau koneksi internet.

## Alur demo yang disarankan (3 menit)

1. Perkenalkan PRIORA sebagai pusat kendali prioritas kesiapsiagaan banjir nasional.
2. Jelaskan empat KPI utama dan cakupan pemantauan 514 kabupaten/kota.
3. Gunakan kontrol eksplorasi untuk menunjukkan satu provinsi atau mencari wilayah.
4. Pilih satu wilayah pada peta atau daftar Top 10 untuk membuka alasan prioritas.
5. Tutup dengan perbedaan antara probabilitas risiko dan indeks prioritas intervensi.

## Fitur utama

- peta SVG Indonesia lokal dengan 514 wilayah dan tooltip interaktif;
- filter provinsi, pencarian wilayah, serta status prioritas;
- daftar Top 10 dengan kontribusi H/V/C dan perubahan peringkat;
- tabel 25 baris per halaman agar tetap cepat;
- detail wilayah dengan ringkasan keputusan, profil, tren 12 bulan, dan aksi;
- light executive dashboard dan layout responsif untuk laptop maupun telepon;
- tabel eksplorasi dengan sorting pada setiap kolom data;
- navigasi keyboard, focus state, label aksesibel, dan reduced-motion support.

## Cara membaca waktu dan hasil

Label *prioritas* berasal dari peringkat TOPSIS, sedangkan peluang banjir berasal
dari model terkalibrasi. Keduanya ditampilkan terpisah agar indeks prioritas tidak
disalahartikan sebagai probabilitas kejadian.

Kode `region_id` pada dashboard adalah kode internal boundary legacy untuk join
spasial. Kode tersebut tidak boleh ditafsirkan sebagai kode administrasi resmi
terkini, khususnya untuk provinsi hasil pemekaran Papua.

## Struktur berkas

```text
PRIORA-dashboard/
├── index.html
├── styles.css
├── app.js
├── START_PRIORA.bat
├── data/
│   ├── priora_data_fast.json
│   └── priora_regions.geojson
└── tools/
    └── build_map_geojson.py
```

`priora_data_fast.json` berisi kontrak data dashboard pada resolusi wilayah-bulan.
`priora_regions.geojson` adalah geometri boundary yang telah disederhanakan untuk
visualisasi web, bukan untuk analisis spasial presisi.

## Hosting dan QR code

Untuk QR code yang dapat dipindai juri, unggah seluruh isi folder ke hosting statis
seperti GitHub Pages atau Cloudflare Pages. Arahkan QR code ke URL HTTPS permanen
hasil deployment. Komputer lokal tidak perlu menjalankan Python ketika dashboard
sudah di-host; Python hanya diperlukan untuk demo lokal.

Sebelum hari presentasi, uji URL dan QR code dari telepon yang tidak terhubung ke
akun pengembang, lalu siapkan demo lokal sebagai cadangan apabila internet venue
tidak stabil.
