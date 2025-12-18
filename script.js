// ==========================================
// 1. KONFIGURASI SUPABASE
// ==========================================
// Ganti dengan URL dan API Key proyek Supabase Anda
const supabaseUrl = 'https://mbccvmalvbdxbornqtqc.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1iY2N2bWFsdmJkeGJvcm5xdHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5MDc1MzEsImV4cCI6MjA4MTQ4MzUzMX0.FicPHqOtziJuac5OrNvTc9OG7CEK4Bn_G9F9CYR-N3s';
const db = supabase.createClient(supabaseUrl, supabaseKey);

// ==========================================
// 2. SISTEM AUTH & GLOBAL VARIABLES
// ==========================================
let currentUser = null;
let allStocks = [];       // Data Pasar
let myPortfolio = [];     // Data Portofolio User
let currentFilter = 'ALL';

async function checkSession() {
    const { data: { session } } = await db.auth.getSession();
    if (!session) {
        window.location.href = 'login.html';
    } else {
        currentUser = session.user;
        console.log("Logged in:", currentUser.email);
        loadData(); // Mulai load data setelah login confirmed
    }
}
checkSession();

// Logout Listener
const btnLogout = document.getElementById('btn-logout');
if(btnLogout) {
    btnLogout.addEventListener('click', async () => {
        if(confirm("Logout?")) {
            await db.auth.signOut();
            window.location.href = 'login.html';
        }
    });
}

// ==========================================
// 3. LOAD DATA (PASAR + PORTOFOLIO)
// ==========================================
async function loadData() {
    showAlert('primary', 'Sinkronisasi data pasar & portofolio...');
    
    // 1. Ambil Data Saham (Market)
    const marketReq = db
        .from('data_saham')
        .select('*')
        .order('kode_saham', { ascending: true })
        .limit(1000);

    // 2. Ambil Data Portofolio (Owned)
    const portfolioReq = db
        .from('portfolio')
        .select('*');

    // Jalankan request paralel
    const [marketRes, portfolioRes] = await Promise.all([marketReq, portfolioReq]);

    if (marketRes.error) {
        showAlert('danger', 'Gagal load market: ' + marketRes.error.message);
        return;
    }

    allStocks = marketRes.data;
    myPortfolio = portfolioRes.data || [];

    applyFilterAndRender();
    
    if(allStocks.length === 0) {
        showAlert('warning', 'Data kosong. Silakan upload file "Ringkasan Saham" (CSV).');
    } else {
        showAlert('success', `Data siap! Market: ${allStocks.length}, Owned: ${myPortfolio.length}`);
    }
}

// ==========================================
// 4. LOGIKA ANALISA & GABUNG DATA
// ==========================================
function setFilter(type) {
    currentFilter = type;
    applyFilterAndRender();
}

function applyFilterAndRender() {
    // 1. Mapping Data Pasar + Data Portofolio
    const processedData = allStocks.map(stock => {
        const owned = myPortfolio.find(p => p.kode_saham === stock.kode_saham);
        return analyzeStock(stock, owned);
    });

    // 2. Filtering
    let filteredData = [];
    if (currentFilter === 'ALL') {
        filteredData = processedData;
    } else if (currentFilter === 'BUY') {
        filteredData = processedData.filter(s => s.signal === 'BUY');
    } else if (currentFilter === 'SELL') {
        filteredData = processedData.filter(s => s.signal === 'SELL');
    } else if (currentFilter === 'OWNED') {
        filteredData = processedData.filter(s => s.isOwned);
    }

    renderTable(filteredData);
}

function analyzeStock(stock, ownedData) {
    const close = Number(stock.penutupan) || 0;
    const prev = Number(stock.sebelumnya) || close; // Ambil dari kolom 'sebelumnya'
    
    // Hitung Perubahan
    const change = close - prev;
    const chgPercent = prev === 0 ? 0 : (change / prev) * 100;

    // Logika Sinyal Simple
    let signal = 'NEUTRAL';
    let powerScore = 50;

    if (chgPercent >= 1) { signal = 'BUY'; powerScore = 75 + chgPercent; }
    else if (chgPercent <= -1) { signal = 'SELL'; powerScore = 25 + chgPercent; }

    // Clamp Power Score 0-100
    powerScore = Math.min(Math.max(Math.round(powerScore), 0), 100);

    // Analisa Portofolio
    let portfolioInfo = null;
    if (ownedData) {
        const avgPrice = Number(ownedData.avg_price);
        const lots = Number(ownedData.lots);
        const marketVal = close * lots * 100; // 1 lot = 100 lembar
        const buyVal = avgPrice * lots * 100;
        const plVal = marketVal - buyVal;
        const plPercent = (plVal / buyVal) * 100;

        portfolioInfo = {
            avg: avgPrice,
            lots: lots,
            plVal: plVal,
            plPercent: plPercent
        };
    }

    return {
        ...stock,
        change, chgPercent, signal, powerScore,
        isOwned: !!ownedData,
        portfolio: portfolioInfo
    };
}

// ==========================================
// 5. RENDER TABEL
// ==========================================
const tableBody = document.getElementById('table-body');
const footerInfo = document.getElementById('footer-info');

function renderTable(data) {
    tableBody.innerHTML = '';
    
    data.forEach(item => {
        const row = document.createElement('tr');
        const fmt = (n) => new Intl.NumberFormat('id-ID').format(n);
        const fmtDec = (n) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(n);

        // Tampilan Dinamis (P/L atau Chg%)
        let mainMetricHtml = '';
        if (currentFilter === 'OWNED' && item.isOwned) {
            const pl = item.portfolio.plPercent;
            const plColor = pl >= 0 ? 'text-success' : 'text-danger';
            mainMetricHtml = `
                <div class="${plColor} fw-bold">${pl >= 0 ? '+' : ''}${fmtDec(pl)}%</div>
                <small class="text-muted" style="font-size:11px">Avg: ${fmt(item.portfolio.avg)}</small>
            `;
        } else {
            const chgColor = item.change >= 0 ? 'text-success' : 'text-danger';
            mainMetricHtml = `
                <div class="${chgColor} fw-bold">${item.change > 0 ? '+' : ''}${fmtDec(item.chgPercent)}%</div>
            `;
        }

        // Badge Sinyal
        let signalBadge = `<span class="badge bg-secondary">WAIT</span>`;
        if(item.signal === 'BUY') signalBadge = `<span class="badge bg-success">BUY</span>`;
        if(item.signal === 'SELL') signalBadge = `<span class="badge bg-danger">SELL</span>`;

        // Tombol Action
        const btnClass = item.isOwned ? 'btn-primary' : 'btn-outline-primary';
        const btnIcon = item.isOwned ? '✏️' : '+';

        row.innerHTML = `
            <td class="fw-bold">${item.kode_saham}</td>
            <td>${fmt(item.penutupan)}</td>
            <td class="text-end">${mainMetricHtml}</td>
            <td class="text-center">${signalBadge}</td>
            <td class="text-center">
                <div class="progress" style="height: 5px; width: 50px; margin: auto;">
                    <div class="progress-bar ${item.powerScore > 50 ? 'bg-success' : 'bg-danger'}" style="width: ${item.powerScore}%"></div>
                </div>
            </td>
            <td class="text-end small">${fmt(item.volume)}</td>
            <td class="text-center">
                <button class="btn btn-sm ${btnClass}" onclick="openPortfolioModal('${item.kode_saham}')">${btnIcon}</button>
            </td>
        `;
        tableBody.appendChild(row);
    });

    footerInfo.innerText = `Menampilkan ${data.length} saham.`;
}

// ==========================================
// 6. MODAL & SAVE PORTFOLIO
// ==========================================
// Pastikan elemen modal ada di HTML sebelum memanggil ini
let portfolioModal; 
try {
    portfolioModal = new bootstrap.Modal(document.getElementById('portfolioModal'));
} catch(e) { console.log("Modal belum di-render HTML"); }

const formKode = document.getElementById('input-kode');
const formAvg = document.getElementById('input-avg');
const formLots = document.getElementById('input-lots');
const labelModalKode = document.getElementById('modal-kode-saham');
const btnDelete = document.getElementById('btn-delete-portfolio');

window.openPortfolioModal = (kode) => {
    const stock = allStocks.find(s => s.kode_saham === kode);
    const owned = myPortfolio.find(p => p.kode_saham === kode);

    labelModalKode.innerText = kode;
    formKode.value = kode;
    
    if (owned) {
        formAvg.value = owned.avg_price;
        formLots.value = owned.lots;
        if(btnDelete) btnDelete.style.display = 'block';
    } else {
        formAvg.value = stock.penutupan;
        formLots.value = 1;
        if(btnDelete) btnDelete.style.display = 'none';
    }
    portfolioModal.show();
};

const pfForm = document.getElementById('portfolio-form');
if(pfForm) {
    pfForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        showAlert('info', 'Menyimpan...');
        portfolioModal.hide();

        const { error } = await db.from('portfolio').upsert({
            user_id: currentUser.id,
            kode_saham: formKode.value,
            avg_price: formAvg.value,
            lots: formLots.value
        }, { onConflict: 'user_id, kode_saham' });

        if (error) showAlert('danger', error.message);
        else {
            await loadData();
            showAlert('success', 'Tersimpan!');
        }
    });
}

if(btnDelete) {
    btnDelete.addEventListener('click', async () => {
        if(!confirm("Hapus?")) return;
        portfolioModal.hide();
        const { error } = await db.from('portfolio').delete().match({ user_id: currentUser.id, kode_saham: formKode.value });
        if(!error) { await loadData(); showAlert('success', 'Dihapus.'); }
    });
}

// ==========================================
// 7. FIX: UPLOAD CSV (SESUAI FORMAT ANDA)
// ==========================================
const csvInput = document.getElementById('csv-file-input');
if (csvInput) {
    csvInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;

        showAlert('info', 'Membaca file Ringkasan Saham...');

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async function(results) {
                const rawData = results.data;
                console.log("Header ditemukan:", results.meta.fields);

                const formattedData = rawData.map(row => {
                    // Helper cari key case-insensitive
                    const findKey = (keywords) => {
                        const keys = Object.keys(row);
                        return keys.find(k => keywords.some(w => k.toLowerCase().includes(w)));
                    };

                    // KEYWORDS KHUSUS FILE ANDA
                    const keyKode = findKey(['kode saham', 'kode']) || 'Kode Saham';
                    const keyName = findKey(['nama perusahaan', 'nama']) || 'Nama Perusahaan';
                    const keyClose = findKey(['penutupan', 'close']) || 'Penutupan';
                    const keyVol = findKey(['volume']) || 'Volume';
                    // Kolom 'Sebelumnya' ada di file Anda, ini penting!
                    const keyPrev = findKey(['sebelumnya', 'previous']) || 'Sebelumnya';
                    const keyDate = findKey(['tanggal', 'date']) || 'Tanggal Perdagangan Terakhir';

                    const cleanNum = (val) => {
                        if (!val) return 0;
                        if (typeof val === 'number') return val;
                        return parseFloat(val.toString().replace(/,/g, ''));
                    };

                    // Skip jika kode saham kosong
                    if(!row[keyKode]) return null;

                    return {
                        kode_saham: row[keyKode],
                        nama_perusahaan: row[keyName] || '',
                        penutupan: cleanNum(row[keyClose]),
                        volume: cleanNum(row[keyVol]),
                        sebelumnya: cleanNum(row[keyPrev]), // Ambil data sebelumnya
                        tanggal_perdagangan_terakhir: row[keyDate] || new Date().toISOString().split('T')[0],
                        selisih: cleanNum(row[keyClose]) - cleanNum(row[keyPrev])
                    };
                }).filter(item => item !== null && item.kode_saham !== 'UNKNOWN');

                if (formattedData.length > 0) {
                    await uploadToSupabase(formattedData);
                } else {
                    showAlert('danger', 'Format CSV tidak cocok. Pastikan pakai file Ringkasan Saham IDX.');
                }
            }
        });
    });
}

async function uploadToSupabase(dataSaham) {
    showAlert('warning', `Mengupload ${dataSaham.length} baris data...`);
    
    const { error } = await db
        .from('data_saham')
        .upsert(dataSaham, { onConflict: 'kode_saham' }); 

    if (error) {
        console.error("Upload Error:", error);
        showAlert('danger', 'Gagal upload: ' + error.message);
    } else {
        showAlert('success', 'Upload Berhasil! Refreshing...');
        csvInput.value = '';
        setTimeout(loadData, 1500);
    }
}

// Helper Alert
function showAlert(type, msg) {
    const alertBox = document.getElementById('status-alert');
    if(alertBox) {
        alertBox.className = `alert alert-${type}`;
        alertBox.innerHTML = msg;
        alertBox.classList.remove('d-none');
    }
}
