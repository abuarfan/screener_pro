// --- 1. KONFIGURASI ---
const supabaseUrl = 'https://mbccvmalvbdxbornqtqc.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1iY2N2bWFsdmJkeGJvcm5xdHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5MDc1MzEsImV4cCI6MjA4MTQ4MzUzMX0.FicPHqOtziJuac5OrNvTc9OG7CEK4Bn_G9F9CYR-N3s';

// PERBAIKAN: Kita ganti nama variabel client menjadi 'db' agar tidak error
const db = supabase.createClient(supabaseUrl, supabaseKey);

// Elemen DOM
const tableBody = document.getElementById('table-body');
const statusAlert = document.getElementById('status-alert');
const csvInput = document.getElementById('csv-file-input');
const footerInfo = document.getElementById('footer-info');

// --- 2. FUNGSI UTAMA: LOAD DATA ---
async function loadSaham() {
    showAlert('primary', 'Memuat data dari database...');
    
    // Ganti 'supabase' menjadi 'db' di sini
    const { data, error } = await db
        .from('data_saham')
        .select('*')
        .order('kode_saham', { ascending: true })
        .limit(100);

    if (error) {
        console.error("Fetch Error:", error);
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
        
        // Format Angka
        const fmt = (num) => new Intl.NumberFormat('id-ID').format(num);
        const close = item.penutupan || 0;
        const prev = item.sebelumnya || close; 
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
    
    if (data.length > 0) {
        footerInfo.innerText = `Menampilkan ${data.length} baris data.`;
    }
}

// --- 4. LOGIKA UPLOAD CSV ---
if (csvInput) {
    csvInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;

        showAlert('info', 'Sedang memproses file CSV...');

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async function(results) {
                const rawData = results.data;
                console.log("Data CSV Mentah:", rawData);
                
                // Mapping Data
                const formattedData = rawData.map(row => {
                    const findKey = (keywords) => {
                        const keys = Object.keys(row);
                        return keys.find(k => keywords.some(w => k.toLowerCase().includes(w)));
                    };

                    const keyKode = findKey(['kode', 'code', 'symbol']) || 'Kode';
                    const keyClose = findKey(['close', 'penutupan', 'last']) || 'Close';
                    const keyVol = findKey(['vol', 'volume']) || 'Volume';
                    const keyName = findKey(['name', 'nama']) || 'Nama';

                    // Bersihkan data angka dari koma atau titik jika format string
                    const cleanNum = (val) => {
                        if(!val) return 0;
                        if(typeof val === 'number') return val;
                        return parseFloat(val.toString().replace(/,/g, ''));
                    }

                    return {
                        kode_saham: row[keyKode] || 'UNKNOWN',
                        nama_perusahaan: row[keyName] || '',
                        penutupan: cleanNum(row[keyClose]),
                        volume: cleanNum(row[keyVol]),
                        tanggal_perdagangan_terakhir: new Date().toISOString().split('T')[0],
                        sebelumnya: 0,
                        selisih: 0
                    };
                }).filter(item => item.kode_saham !== 'UNKNOWN');

                if (formattedData.length > 0) {
                    await uploadToSupabase(formattedData);
                } else {
                    showAlert('danger', 'Gagal membaca format CSV.');
                }
            }
        });
    });
}

async function uploadToSupabase(dataSaham) {
    showAlert('warning', `Sedang mengupload ${dataSaham.length} data ke Supabase...`);

    // Ganti 'supabase' menjadi 'db' di sini juga
    const { data, error } = await db
        .from('data_saham')
        .upsert(dataSaham, { onConflict: 'kode_saham' }); 

    if (error) {
        console.error("Upload Error:", error);
        showAlert('danger', 'Gagal upload: ' + error.message);
    } else {
        showAlert('success', 'Upload Selesai! Data telah diperbarui.');
        csvInput.value = '';
        loadSaham(); 
    }
}

// Helper: Tampilkan Alert
function showAlert(type, message) {
    if(statusAlert) {
        statusAlert.className = `alert alert-${type}`;
        statusAlert.innerText = message;
        statusAlert.classList.remove('d-none');
    }
}

// Jalankan saat start
document.addEventListener('DOMContentLoaded', loadSaham);
