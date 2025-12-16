// 1. Konfigurasi Supabase
const supabaseUrl = 'YOUR_SUPABASE_URL'; 
const supabaseKey = 'YOUR_SUPABASE_ANON_KEY';
const supabase = supabase.createClient(supabaseUrl, supabaseKey);

// Elemen DOM
const tableBody = document.getElementById('table-body');
const statusAlert = document.getElementById('status-alert');

// 2. Fungsi Mengambil Data Saham
async function loadSaham() {
    statusAlert.className = 'alert alert-info';
    statusAlert.innerText = 'Sedang memuat data...';
    tableBody.innerHTML = ''; // Kosongkan tabel

    // Query ke tabel 'data_saham', ambil 50 data pertama dulu biar ringan
    const { data, error } = await supabase
        .from('data_saham')
        .select('*')
        .order('kode_saham', { ascending: true })
        .limit(50);

    if (error) {
        console.error('Error fetching data:', error);
        statusAlert.className = 'alert alert-danger';
        statusAlert.innerText = 'Gagal mengambil data: ' + error.message;
        return;
    }

    if (data.length === 0) {
        statusAlert.className = 'alert alert-warning';
        statusAlert.innerText = 'Data kosong. Silakan upload data CSV atau insert manual di Supabase.';
        return;
    }

    // Render Data ke Tabel
    data.forEach(saham => {
        const row = document.createElement('tr');
        
        // Format angka sederhana
        const closePrice = new Intl.NumberFormat('id-ID').format(saham.penutupan);
        const selisih = saham.selisih || 0;
        const volume = new Intl.NumberFormat('id-ID').format(saham.volume);
        
        // Warna untuk naik/turun (Simple logic)
        let colorClass = 'text-dark';
        if(selisih > 0) colorClass = 'text-success fw-bold';
        if(selisih < 0) colorClass = 'text-danger fw-bold';

        row.innerHTML = `
            <td class="fw-bold">${saham.kode_saham}</td>
            <td>${closePrice}</td>
            <td class="${colorClass}">${selisih}</td>
            <td>${volume}</td>
            <td>${saham.tanggal_perdagangan_terakhir}</td>
        `;
        tableBody.appendChild(row);
    });

    statusAlert.className = 'alert alert-success';
    statusAlert.innerText = `Berhasil memuat ${data.length} data saham.`;
}

// Jalankan saat halaman dimuat
document.addEventListener('DOMContentLoaded', loadSaham);
