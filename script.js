// ==========================================
// 1. KONFIGURASI SUPABASE
// ==========================================
// Ganti dengan URL dan API Key proyek Supabase Anda
const supabaseUrl = 'MASUKKAN_URL_SUPABASE_ANDA_DISINI';
const supabaseKey = 'MASUKKAN_ANON_KEY_ANDA_DISINI';

// Inisialisasi Client
const db = supabase.createClient(supabaseUrl, supabaseKey);

// ==========================================
// 2. SISTEM AUTH (LOGIN / LOGOUT)
// ==========================================

// Cek apakah user sudah login saat halaman dibuka
async function checkSession() {
    const { data: { session } } = await db.auth.getSession();
    
    // Jika tidak ada session, tendang ke login page
    if (!session) {
        window.location.href = 'login.html';
    } else {
        console.log("Logged in as:", session.user.email);
    }
}
// Jalankan pengecekan segera
checkSession();

// Event Listener untuk Tombol Logout
const btnLogout = document.getElementById('btn-logout');
if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
        if(confirm("Yakin ingin keluar?")) {
            await db.auth.signOut();
            window.location.href = 'login.html';
        }
    });
}

// ==========================================
// 3. GLOBAL VARIABLES & DOM ELEMENTS
// ==========================================

let allStocks = [];       // Menyimpan seluruh data saham (cache memory)
let currentFilter = 'ALL'; // Menyimpan status filter aktif

const tableBody = document.getElementById('table-body');
const statusAlert = document.getElementById('status-alert');
const footerInfo = document.getElementById('footer-info');
const csvInput = document.getElementById('csv-file-input');

// ==========================================
// 4. LOGIKA UTAMA (LOAD & ANALYZE)
// ==========================================

// Load Data dari Supabase saat aplikasi mulai
async function loadSaham() {
    showAlert('primary', 'Sedang memuat data dan menganalisa pasar...');
    
    // Ambil data sampai 1000 baris
    const { data, error } = await db
        .from('data_saham')
        .select('*')
        .order('kode_saham', { ascending: true })
        .limit(1000);

    if (error) {
        showAlert('danger', 'Gagal memuat data: ' + error.message);
        return;
    }

    // Simpan ke variabel global
    allStocks = data;

    // Jalankan Analisa & Render Tabel
    applyFilterAndRender();
    
    // Feedback ke user
    if (data.length === 0) {
        showAlert('warning', 'Database kosong. Silakan upload CSV.');
    } else {
        showAlert('success', `Berhasil memuat dan menganalisa ${data.length} saham.`);
    }
}

// Fungsi yang dipanggil saat tombol Filter diklik
function setFilter(type) {
    currentFilter = type;
    applyFilterAndRender(); // Render ulang tabel sesuai filter baru
}

// Fungsi Penggabung: Analisa -> Filter -> Render
function applyFilterAndRender() {
    // 1. Analisa setiap saham (tambah properti signal & score)
    const analyzedData = allStocks.map(stock => analyzeStock(stock));

    // 2. Filter data berdasarkan tombol yang dipilih
    let filteredData = [];
    
    if (currentFilter === 'ALL') {
        filteredData = analyzedData;
    } else if (currentFilter === 'BUY') {
        filteredData = analyzedData.filter(s => s.signal === 'BUY');
    } else if (currentFilter === 'SELL') {
        filteredData = analyzedData.filter(s => s.signal === 'SELL');
    } else if (currentFilter === 'OWNED') {
        // Placeholder untuk Fase 4
        filteredData = [];
        showAlert('info', 'Fitur Portofolio (Owned) akan aktif di tahap selanjutnya.');
        renderTable([]); // Kosongkan tabel
        return;
    }

    // 3. Tampilkan ke layar
    renderTable(filteredData);
}

// Engine Analisa Teknikal (Sederhana untuk Fase 3)
function analyzeStock(stock) {
    const close = Number(stock.penutupan) || 0;
    const prev = Number(stock.sebelumnya) || close; // Jika data prev kosong, anggap sama
    
    const change = close - prev;
    // Hindari pembagian dengan nol
    const chgPercent = prev === 0 ? 0 : (change / prev) * 100;

    // Logika Sinyal Mockup (Nanti diganti Rumus MA/RSI sungguhan)
    let signal = 'NEUTRAL';
    let powerScore = 50; // Default score

    if (chgPercent >= 1) {
        signal = 'BUY';
        powerScore = 70 + chgPercent; // Score naik jika persen naik tinggi
    } else if (chgPercent <= -1) {
        signal = 'SELL';
        powerScore = 30 + chgPercent; // Score turun jika persen drop
    }

    // Batasi Power Score min 0 max 100
    powerScore = Math.min(Math.max(Math.round(powerScore), 0), 100);

    return {
        ...stock, // Copy data asli
        change: change,
        chgPercent: chgPercent,
        signal: signal,
        powerScore: powerScore
    };
}

// Fungsi Render HTML Tabel
function renderTable(data) {
    tableBody.innerHTML = ''; // Reset isi tabel
    
    data.forEach(item => {
        const row = document.createElement('tr');
        
        // Formatter Angka Indonesia
        const fmt = (num) => new Intl.NumberFormat('id-ID').format(num);
        const fmtDec = (num) => new Intl.NumberFormat('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(num);

        // Styling Warna Harga
        let colorClass = 'text-secondary';
        if (item.change > 0) colorClass = 'text-success fw-bold';
        if (item.change < 0) colorClass = 'text-danger fw-bold';

        // Badge Sinyal
        let signalBadge = '<span class="badge bg-secondary">WAIT</span>';
        if (item.signal === 'BUY') signalBadge = '<span class="badge bg-success">BUY 🚀</span>';
        if (item.signal === 'SELL') signalBadge = '<span class="badge bg-danger">SELL 🔻</span>';

        // Power Score Bar
        let barColor = item.powerScore >= 50 ? 'bg-success' : 'bg-danger';
        const powerBar = `
            <div class="progress" style="height: 6px; width: 60px; margin: auto;" title="Score: ${item.powerScore}">
                <div class="progress-bar ${barColor}" role="progressbar" style="width: ${item.powerScore}%"></div>
            </div>
        `;

        // Susun Baris HTML
        row.innerHTML = `
            <td class="fw-bold">${item.kode_saham}</td>
            <td>${fmt(item.penutupan)}</td>
            <td class="text-end ${colorClass}">
                ${item.change > 0 ? '+' : ''}${fmtDec(item.chgPercent)}%
            </td>
            <td class="text-center">${signalBadge}</td>
            <td class="text-center align-middle">${powerBar}</td>
            <td class="text-end small">${fmt(item.volume)}</td>
            <td>
                <button class="btn btn-sm btn-outline-primary" onclick="showDetail('${item.kode_saham}')">🔍</button>
            </td>
        `;
        tableBody.appendChild(row);
    });
    
    if (data.length > 0) {
        footerInfo.innerText = `Menampilkan ${data.length} saham (Filter: ${currentFilter})`;
    } else if (currentFilter !== 'OWNED') {
        footerInfo.innerText = 'Tidak ada saham yang cocok dengan filter ini.';
    }
}

function showDetail(kode) {
    alert(`Fitur Detail Chart untuk ${kode} akan dibuat di Fase 5!`);
}

// ==========================================
// 5. FITUR UPLOAD CSV (Mapping Fleksibel)
// ==========================================

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
                console.log("CSV Raw:", rawData);
                
                // Mapping Header CSV ke Kolom Database
                const formattedData = rawData.map(row => {
                    // Helper cari key (case insensitive)
                    const findKey = (keywords) => {
                        const keys = Object.keys(row);
                        return keys.find(k => keywords.some(w => k.toLowerCase().includes(w)));
                    };

                    const keyKode = findKey(['kode', 'code', 'symbol', 'ticker']) || 'Kode';
                    const keyClose = findKey(['close', 'penutupan', 'last', 'price']) || 'Close';
                    const keyVol = findKey(['vol', 'volume']) || 'Volume';
                    const keyName = findKey(['name', 'nama', 'perusahaan']) || 'Nama';

                    // Bersihkan angka (hapus koma)
                    const cleanNum = (val) => {
                        if (!val) return 0;
                        if (typeof val === 'number') return val;
                        return parseFloat(val.toString().replace(/,/g, ''));
                    };

                    return {
                        kode_saham: row[keyKode] || 'UNKNOWN',
                        nama_perusahaan: row[keyName] || '',
                        penutupan: cleanNum(row[keyClose]),
                        volume: cleanNum(row[keyVol]),
                        tanggal_perdagangan_terakhir: new Date().toISOString().split('T')[0],
                        sebelumnya: 0, // Default 0 karena CSV harian biasanya tidak bawa data kemarin
                        selisih: 0
                    };
                }).filter(item => item.kode_saham !== 'UNKNOWN' && item.kode_saham !== undefined);

                if (formattedData.length > 0) {
                    await uploadToSupabase(formattedData);
                } else {
                    showAlert('danger', 'Format CSV tidak dikenali. Pastikan ada kolom Kode & Close.');
                }
            }
        });
    });
}

async function uploadToSupabase(dataSaham) {
    showAlert('warning', `Mengupload ${dataSaham.length} data ke Supabase...`);

    // Upsert: Update jika ada, Insert jika baru
    const { data, error } = await db
        .from('data_saham')
        .upsert(dataSaham, { onConflict: 'kode_saham' }); 

    if (error) {
        console.error("Upload Error:", error);
        showAlert('danger', 'Gagal upload: ' + error.message);
    } else {
        showAlert('success', 'Upload Selesai! Halaman akan dimuat ulang...');
        csvInput.value = ''; // Reset input
        // Tunggu 1 detik lalu reload data
        setTimeout(loadSaham, 1500);
    }
}

// ==========================================
// 6. HELPER FUNCTIONS
// ==========================================

function showAlert(type, message) {
    if (statusAlert) {
        statusAlert.className = `alert alert-${type}`;
        statusAlert.innerHTML = message; // Gunakan innerHTML agar bisa pakai <b> dll
        statusAlert.classList.remove('d-none');
    }
}

// ==========================================
// 7. INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', loadSaham);
