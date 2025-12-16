// --- 1. KONFIGURASI ---
const supabaseUrl = 'https://mbccvmalvbdxbornqtqc.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1iY2N2bWFsdmJkeGJvcm5xdHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5MDc1MzEsImV4cCI6MjA4MTQ4MzUzMX0.FicPHqOtziJuac5OrNvTc9OG7CEK4Bn_G9F9CYR-N3s';
const supabase = supabase.createClient(supabaseUrl, supabaseKey);

// Elemen DOM
const tableBody = document.getElementById('table-body');
const statusAlert = document.getElementById('status-alert');
const csvInput = document.getElementById('csv-file-input');
const footerInfo = document.getElementById('footer-info');

// --- 2. FUNGSI UTAMA: LOAD DATA ---
async function loadSaham() {
    showAlert('primary', 'Memuat data dari database...');
    
    // Ambil data dari tabel data_saham
    const { data, error } = await supabase
        .from('data_saham')
        .select('*')
        .order('kode_saham', { ascending: true })
        .limit(100);

    if (error) {
        showAlert('danger', 'Error: ' + error.message);
        return;
    }

    renderTable(data);
    
    if (data.length === 0) {
        showAlert('warning', 'Data kosong. Silakan upload file CSV.');
    } else {
        showAlert('success', `Berhasil memuat ${data.length} data saham.`);
    }
}

// --- 3. RENDER TABEL ---
function renderTable(data) {
    tableBody.innerHTML = '';
    
    data.forEach(item => {
        const row = document.createElement('tr');
        
        // Format Angka (Rupiah/Indonesia)
        const fmt = (num) => new Intl.NumberFormat('id-ID').format(num);
        const close = item.penutupan || 0;
        const prev = item.sebelumnya || close; // jika data sebelumnya kosong, anggap sama
        const change = close - prev;
        
        // Warna text
        let colorClass = 'text-neutral';
        if (change > 0) colorClass = 'text-up';
        if (change < 0) colorClass = 'text-down';

        row.innerHTML = `
            <td class="fw-bold">${item.kode_saham}</td>
            <td>${item.nama_perusahaan || '-'}</td>
            <td class="text-end">${fmt(close)}</td>
            <td class="text-end ${colorClass}">${fmt(change)}</td>
            <td class="text-end">${fmt(item.volume)}</td>
            <td class="text-center text-muted small">${item.tanggal_perdagangan_terakhir || '-'}</td>
        `;
        tableBody.appendChild(row);
    });
    
    footerInfo.innerText = `Menampilkan ${data.length} baris data.`;
}

// --- 4. LOGIKA UPLOAD CSV (FLEKSIBEL) ---
csvInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;

    showAlert('info', 'Sedang memproses file CSV...');

    Papa.parse(file, {
        header: true, // Baris pertama dianggap header
        skipEmptyLines: true,
        complete: async function(results) {
            const rawData = results.data;
            console.log("Data CSV Mentah:", rawData);
            
            // Mapping Data: Mengubah header CSV sembarang menjadi kolom database kita
            // Kita coba mapping manual sederhana
            const formattedData = rawData.map(row => {
                // Cari key di object row yang mirip dengan target kita (case insensitive)
                const findKey = (keywords) => {
                    const keys = Object.keys(row);
                    return keys.find(k => keywords.some(w => k.toLowerCase().includes(w)));
                };

                // Keywords mapping (Fleksibel)
                const keyKode = findKey(['kode', 'code', 'symbol', 'ticker']) || 'Kode';
                const keyClose = findKey(['close', 'penutupan', 'price', 'last']) || 'Close';
                const keyVol = findKey(['vol', 'volume']) || 'Volume';
                const keyName = findKey(['name', 'nama', 'perusahaan']) || 'Nama';

                // Return object sesuai kolom Supabase
                return {
                    kode_saham: row[keyKode] || 'UNKNOWN',
                    nama_perusahaan: row[keyName] || '',
                    penutupan: parseFloat((row[keyClose] || '0').toString().replace(/,/g, '')), // Hapus koma jika ada
                    volume: parseInt((row[keyVol] || '0').toString().replace(/,/g, '')),
                    tanggal_perdagangan_terakhir: new Date().toISOString().split('T')[0], // Pakai tanggal hari ini
                    // Field lain bisa diset default dulu
                    sebelumnya: 0,
                    selisih: 0
                };
            }).filter(item => item.kode_saham !== 'UNKNOWN'); // Buang baris kosong/error

            if (formattedData.length > 0) {
                await uploadToSupabase(formattedData);
            } else {
                showAlert('danger', 'Gagal membaca format CSV. Pastikan ada kolom Kode, Close, dan Volume.');
            }
        }
    });
});

async function uploadToSupabase(dataSaham) {
    showAlert('warning', `Sedang mengupload ${dataSaham.length} data ke Supabase...`);

    // Upsert (Insert atau Update jika kode_saham sama)
    const { data, error } = await supabase
        .from('data_saham')
        .upsert(dataSaham, { onConflict: 'kode_saham' }); 

    if (error) {
        console.error("Upload Error:", error);
        showAlert('danger', 'Gagal upload: ' + error.message);
    } else {
        showAlert('success', 'Upload Selesai! Data telah diperbarui.');
        csvInput.value = ''; // Reset input file
        loadSaham(); // Reload tabel
    }
}

// Helper: Tampilkan Alert
function showAlert(type, message) {
    statusAlert.className = `alert alert-${type}`;
    statusAlert.innerText = message;
    statusAlert.classList.remove('d-none');
}

// Jalankan saat start
document.addEventListener('DOMContentLoaded', loadSaham);
