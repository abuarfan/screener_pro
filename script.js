// ==========================================
// 1. KONFIGURASI SUPABASE
// ==========================================
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

// Logout
document.getElementById('btn-logout')?.addEventListener('click', async () => {
    if(confirm("Logout?")) {
        await db.auth.signOut();
        window.location.href = 'login.html';
    }
});

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

    // Jalankan kedua request secara paralel (biar cepat)
    const [marketRes, portfolioRes] = await Promise.all([marketReq, portfolioReq]);

    if (marketRes.error) {
        showAlert('danger', 'Gagal load market: ' + marketRes.error.message);
        return;
    }

    allStocks = marketRes.data;
    myPortfolio = portfolioRes.data || []; // Kalau kosong/error, set array kosong

    // Render
    applyFilterAndRender();
    showAlert('success', `Data siap! Market: ${allStocks.length}, Owned: ${myPortfolio.length}`);
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
        // Cek apakah saham ini ada di portofolio user?
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
        // Hanya ambil yang punya data 'owned'
        filteredData = processedData.filter(s => s.isOwned);
    }

    renderTable(filteredData);
}

function analyzeStock(stock, ownedData) {
    const close = Number(stock.penutupan) || 0;
    const prev = Number(stock.sebelumnya) || close;
    
    // Analisa Teknikal Dasar
    const change = close - prev;
    const chgPercent = prev === 0 ? 0 : (change / prev) * 100;

    let signal = 'NEUTRAL';
    let powerScore = 50;

    if (chgPercent >= 1) { signal = 'BUY'; powerScore = 75; }
    else if (chgPercent <= -1) { signal = 'SELL'; powerScore = 25; }

    // Analisa Portofolio (Jika user punya)
    let portfolioInfo = null;
    if (ownedData) {
        const avgPrice = Number(ownedData.avg_price);
        const lots = Number(ownedData.lots);
        const marketVal = close * lots * 100; // 1 lot = 100 lembar
        const buyVal = avgPrice * lots * 100;
        const plVal = marketVal - buyVal; // Rupiah Profit/Loss
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
        isOwned: !!ownedData, // Boolean true/false
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

        // LOGIKA TAMPILAN DINAMIS
        // Jika sedang mode "OWNED", tampilkan P/L. Jika mode biasa, tampilkan Chg Harian.
        let mainMetricHtml = '';
        
        if (currentFilter === 'OWNED' && item.isOwned) {
            // Tampilan Khusus Portofolio (P/L)
            const pl = item.portfolio.plPercent;
            const plColor = pl >= 0 ? 'text-success' : 'text-danger';
            mainMetricHtml = `
                <div class="${plColor} fw-bold">${pl >= 0 ? '+' : ''}${fmtDec(pl)}%</div>
                <small class="text-muted" style="font-size:11px">Avg: ${fmt(item.portfolio.avg)}</small>
            `;
        } else {
            // Tampilan Biasa (Perubahan Harian)
            const chgColor = item.change >= 0 ? 'text-success' : 'text-danger';
            mainMetricHtml = `
                <div class="${chgColor} fw-bold">${item.change > 0 ? '+' : ''}${fmtDec(item.chgPercent)}%</div>
            `;
        }

        // Badge Sinyal
        let signalBadge = `<span class="badge bg-secondary">WAIT</span>`;
        if(item.signal === 'BUY') signalBadge = `<span class="badge bg-success">BUY</span>`;
        if(item.signal === 'SELL') signalBadge = `<span class="badge bg-danger">SELL</span>`;

        // Tombol Add/Edit Portfolio
        // Jika sudah punya (Owned), warnanya biru solid. Jika belum, outline.
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
                <button class="btn btn-sm ${btnClass}" onclick="openPortfolioModal('${item.kode_saham}')" title="Atur Portofolio">${btnIcon}</button>
            </td>
        `;
        tableBody.appendChild(row);
    });

    if (data.length === 0) {
        if (currentFilter === 'OWNED') footerInfo.innerText = "Belum ada saham di portofolio.";
        else footerInfo.innerText = "Tidak ada data.";
    } else {
        footerInfo.innerText = `Menampilkan ${data.length} saham.`;
    }
}

// ==========================================
// 6. MODAL & SAVE PORTFOLIO
// ==========================================
const portfolioModal = new bootstrap.Modal(document.getElementById('portfolioModal'));
const formKode = document.getElementById('input-kode');
const formAvg = document.getElementById('input-avg');
const formLots = document.getElementById('input-lots');
const labelModalKode = document.getElementById('modal-kode-saham');
const btnDelete = document.getElementById('btn-delete-portfolio');

// Buka Modal
window.openPortfolioModal = (kode) => {
    // Cari data saham ini
    const stock = allStocks.find(s => s.kode_saham === kode);
    const owned = myPortfolio.find(p => p.kode_saham === kode);

    // Isi form
    labelModalKode.innerText = kode;
    formKode.value = kode;
    
    if (owned) {
        formAvg.value = owned.avg_price;
        formLots.value = owned.lots;
        btnDelete.style.display = 'block'; // Tampilkan tombol hapus
    } else {
        formAvg.value = stock.penutupan; // Default isi harga sekarang
        formLots.value = 1;
        btnDelete.style.display = 'none'; // Sembunyikan tombol hapus
    }

    portfolioModal.show();
};

// Simpan Data
document.getElementById('portfolio-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const kode = formKode.value;
    const avg = formAvg.value;
    const lots = formLots.value;

    showAlert('info', 'Menyimpan portofolio...');
    portfolioModal.hide();

    // Upsert ke Supabase
    const { error } = await db.from('portfolio').upsert({
        user_id: currentUser.id,
        kode_saham: kode,
        avg_price: avg,
        lots: lots
    }, { onConflict: 'user_id, kode_saham' });

    if (error) {
        showAlert('danger', 'Gagal simpan: ' + error.message);
    } else {
        await loadData(); // Reload data biar tabel update
        showAlert('success', 'Portofolio berhasil disimpan!');
    }
});

// Hapus Data
btnDelete.addEventListener('click', async () => {
    if(!confirm("Hapus saham ini dari portofolio?")) return;
    
    const kode = formKode.value;
    portfolioModal.hide();
    showAlert('warning', 'Menghapus...');

    const { error } = await db.from('portfolio')
        .delete()
        .match({ user_id: currentUser.id, kode_saham: kode });

    if (error) {
        showAlert('danger', 'Gagal hapus: ' + error.message);
    } else {
        await loadData();
        showAlert('success', 'Saham dihapus dari portofolio.');
    }
});

// Helper Alert
function showAlert(type, msg) {
    const alertBox = document.getElementById('status-alert');
    if(alertBox) {
        alertBox.className = `alert alert-${type}`;
        alertBox.innerHTML = msg;
        alertBox.classList.remove('d-none');
    }
}

// Fitur CSV Upload (Tetap ada, disingkat disini agar muat, paste kode lama jika perlu atau biarkan kosong jika fokus portfolio)
const csvInput = document.getElementById('csv-file-input');
if(csvInput) { /* ...Paste logika CSV PapaParse dari kode sebelumnya disini... */ }
