const CONFIG = {
    user: 'rydevs29',
    repo: 'RifqyMusic',
    basePath: 'songs',
    folders: ['lossless'] 
};

// --- ULTIMATE AUDIO ENGINE (WEB AUDIO API) ---
let audioCtx, source;
// Node Audio FX
let eqBands = []; // 5 Equalizer
let reverbNode, reverbGainNode; // 3D Surround
let monoMergerNode, masterGainNode; // Mono & Master
let boosterNode; // Volume Boost 200%
let analyzer, dataArray, canvas, canvasCtx; // Visualizer

// Status FX & App
let is3D = false;
let isMono = false;
let currentQuality = 'Hi-Fi'; // Default: Hi-Fi (Folder 'lossless'/'high')

const audioPlayer = new Audio();
audioPlayer.crossOrigin = "anonymous"; 

// UI Elements
const homeList = document.getElementById('home-list');
const savedList = document.getElementById('saved-list');
const fullPlayer = document.getElementById('view-player');
const miniPlayer = document.getElementById('mini-player');
const searchInput = document.getElementById('search-input');
const fullTitle = document.getElementById('full-title');
const fullArtist = document.getElementById('full-artist'); // New Element
const fullCover = document.getElementById('full-cover');
const progressBar = document.getElementById('progress-bar');
const currentTimeEl = document.getElementById('current-time');
const durationEl = document.getElementById('duration');

// State App
let allSongs = [];
let savedSongs = JSON.parse(localStorage.getItem('savedSongs')) || [];
let currentIndex = 0;
let isShuffle = false;
let isRepeat = false;

// --- INITIALIZATION ---
async function init() {
    try {
        const fetchPromises = CONFIG.folders.map(async folder => {
            const url = `https://api.github.com/repos/${CONFIG.user}/${CONFIG.repo}/contents/${CONFIG.basePath}/${folder}?t=${Date.now()}`;
            const res = await fetch(url);
            if (!res.ok) return [];
            const files = await res.json();
            return Array.isArray(files) ? files.map(f => ({ ...f, folderPath: `${CONFIG.basePath}/${folder}` })) : [];
        });

        const results = await Promise.all(fetchPromises);
        allSongs = results.flat().filter(f => f.name.toLowerCase().endsWith('.flac') || f.name.toLowerCase().endsWith('.mp3'));

        if (allSongs.length > 0) {
            document.getElementById('loading-text').style.display = 'none';
            renderHomeList(allSongs);
            renderSavedList();
        } else {
            document.getElementById('loading-text').innerText = "Tidak ada lagu.";
        }
    } catch (e) {
        document.getElementById('loading-text').innerText = "Error: " + e.message;
    }
}

// --- SETUP AUDIO ENGINE CANGGIH (UPDATED) ---
function initAudioEngine() {
    if (audioCtx) return; 
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext();
    source = audioCtx.createMediaElementSource(audioPlayer);

    // 1. SETUP EQUALIZER
    const freqs = [60, 250, 1000, 4000, 16000];
    eqBands = freqs.map(f => {
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = f;
        filter.gain.value = 0; 
        return filter;
    });
    let eqChain = source;
    eqBands.forEach(band => { eqChain.connect(band); eqChain = band; });
    const eqOutput = eqChain; 

    // 2. SETUP 3D REVERB
    reverbNode = audioCtx.createConvolver();
    reverbGainNode = audioCtx.createGain();
    reverbGainNode.gain.value = 0; 

    const duration = 2;
    const length = audioCtx.sampleRate * duration;
    const impulse = audioCtx.createBuffer(2, length, audioCtx.sampleRate);
    for (let i = 0; i < length; i++) {
        const decay = Math.pow(1 - i / length, 2);
        impulse.getChannelData(0)[i] = (Math.random() * 2 - 1) * decay;
        impulse.getChannelData(1)[i] = (Math.random() * 2 - 1) * decay;
    }
    reverbNode.buffer = impulse;

    // 3. SETUP VOLUME BOOST (NEW)
    boosterNode = audioCtx.createGain();
    boosterNode.gain.value = 1; // Default 100%

    // 4. SETUP ANALYZER (VISUALIZER) (NEW)
    analyzer = audioCtx.createAnalyser();
    analyzer.fftSize = 64; // Jumlah batang visualizer
    const bufferLength = analyzer.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);

    // 5. SETUP MASTER & ROUTING
    monoMergerNode = audioCtx.createChannelMerger(1); 
    masterGainNode = audioCtx.createGain(); 

    // Rangkai Kabel Audio:
    // EQ -> Booster
    eqOutput.connect(boosterNode);
    // EQ -> Reverb -> ReverbGain -> Booster
    eqOutput.connect(reverbNode);
    reverbNode.connect(reverbGainNode);
    reverbGainNode.connect(boosterNode);
    
    // Booster -> Master
    boosterNode.connect(masterGainNode);

    // Master -> Analyzer (Visualizer)
    masterGainNode.connect(analyzer);

    // Master -> Speaker (Final)
    connectFinalOutput();
    
    // Mulai Gambar Visualizer
    initVisualizerCanvas();
}

function connectFinalOutput() {
    masterGainNode.disconnect();
    monoMergerNode.disconnect();
    if (isMono) {
        masterGainNode.connect(monoMergerNode);
        monoMergerNode.connect(audioCtx.destination);
    } else {
        masterGainNode.connect(audioCtx.destination);
    }
}

// --- VISUALIZER ENGINE (NEW) ---
function initVisualizerCanvas() {
    canvas = document.getElementById('visualizer');
    if(!canvas) return; // Cek kalau user belum pasang canvas di HTML
    canvasCtx = canvas.getContext('2d');
    drawVisualizer();
}

function drawVisualizer() {
    requestAnimationFrame(drawVisualizer);
    if(!analyzer) return;

    analyzer.getByteFrequencyData(dataArray);
    canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

    let barWidth = (canvas.width / dataArray.length) * 2.5;
    let barHeight;
    let x = 0;

    // Warna Visualizer Berdasarkan Kualitas
    let barColor = '#4CAF50'; // Standard (Hijau)
    if (currentQuality === 'Data Saving') barColor = '#2196F3'; // Biru
    if (currentQuality === 'Hi-Fi') barColor = '#FFD700'; // Emas (Glow)

    // Efek Glow
    canvasCtx.shadowBlur = currentQuality === 'Hi-Fi' ? 15 : 0;
    canvasCtx.shadowColor = barColor;

    for (let i = 0; i < dataArray.length; i++) {
        barHeight = dataArray[i] / 2;
        canvasCtx.fillStyle = barColor;
        canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        x += barWidth + 1;
    }
}

// --- LOGIKA UI & PLAYER (UPDATED) ---
function renderHomeList(songs) {
    homeList.innerHTML = "";
    songs.forEach((song, index) => {
        const isSaved = savedSongs.includes(song.name);
        // Pakai Smart Parser Baru
        const meta = parseSongInfo(song.name); 
        const isFlac = song.name.toLowerCase().endsWith('.flac');
        const fileNameNoExt = song.name.replace(/\.[^/.]+$/, "");
        const coverUrl = `./songs/covers/${encodeURIComponent(fileNameNoExt)}.jpg`;

        const div = document.createElement('div');
        div.className = 'list-item';
        div.innerHTML = `
            <div class="list-img" onclick="playSong(${index})">
                <img src="${coverUrl}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" class="song-cover">
                <div class="placeholder-box" style="display:none; width:100%; height:100%; align-items:center; justify-content:center; background:#111;">
                    <span class="material-icons-round" style="color:#333; font-size:24px;">audiotrack</span>
                </div>
                <div class="badge-flac">${isFlac ? 'FLAC' : 'HQ'}</div>
            </div>
            <div class="list-info" onclick="playSong(${index})">
                <h4>${meta.title}</h4>
                <p>${meta.artist}</p> </div>
            <button class="btn-save ${isSaved ? 'active' : ''}" onclick="toggleSave('${song.name}')">
                <span class="material-icons-round">${isSaved ? 'bookmark' : 'bookmark_border'}</span>
            </button>
        `;
        homeList.appendChild(div);
    });
}

function renderSavedList() {
    savedList.innerHTML = "";
    const mySavedSongs = allSongs.filter(s => savedSongs.includes(s.name));
    mySavedSongs.forEach((song) => {
        const idx = allSongs.findIndex(s => s.name === song.name);
        const meta = parseSongInfo(song.name);
        const div = document.createElement('div');
        div.className = 'list-item';
        div.innerHTML = `
            <div class="list-img" onclick="playSong(${idx})">
                <span class="material-icons-round" style="color:#666;">audiotrack</span>
            </div>
            <div class="list-info" onclick="playSong(${idx})">
                <h4>${meta.title}</h4>
                <p>${meta.artist}</p>
            </div>
            <button class="btn-save active" onclick="toggleSave('${song.name}')">
                <span class="material-icons-round">bookmark</span>
            </button>
        `;
        savedList.appendChild(div);
    });
}

// SMART PARSER (Format: Artis - Judul atau Judul saja)
function parseSongInfo(filename) {
    let cleanName = filename.replace(/\.[^/.]+$/, "").replace(/_/g, " "); // Hapus ekstensi
    let parts = cleanName.split(" - ");
    
    if (parts.length >= 2) {
        // Asumsi format: Artis - Judul
        return { artist: parts[0].trim(), title: parts[1].trim() };
    } else {
        // Format biasa
        return { artist: "RifqyMusic", title: cleanName };
    }
}

function playSong(index) {
    if(!audioCtx) initAudioEngine();
    if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

    currentIndex = index;
    const song = allSongs[index];
    const meta = parseSongInfo(song.name);
    const fileNameNoExt = song.name.replace(/\.[^/.]+$/, "");
    fullCover.src = `./songs/covers/${encodeURIComponent(fileNameNoExt)}.jpg`;

    // --- LOGIKA MUSIC QUALITY (FOLDER SWITCHING) ---
    // Hi-Fi = folder 'lossless' (sesuai config user)
    // Standard = folder 'med'
    // Data Saving = folder 'low'
    
    let targetFolder = 'lossless'; // Default (Hi-Fi)
    if (currentQuality === 'Standard') targetFolder = 'med';
    if (currentQuality === 'Data Saving') targetFolder = 'low';

    // Cek apakah pakai subfolder atau root 'songs'
    // Note: User harus buat folder 'med' dan 'low' di GitHub kalau mau fitur ini jalan
    audioPlayer.src = `./songs/${targetFolder}/${encodeURIComponent(song.name)}`;
    
    audioPlayer.play().catch(e => console.log("Menunggu interaksi user..."));

    fullTitle.innerText = meta.title;
    if(fullArtist) fullArtist.innerText = meta.artist; // Update Artis di Player
    document.getElementById('mini-title').innerText = meta.title;
    document.getElementById('mini-artist').innerText = meta.artist;
    miniPlayer.classList.remove('hidden');
    maximizePlayer();
    updatePlayIcon(true);
}

// --- NEW FEATURES CONTROL ---

// 1. VOLUME BOOST (100% - 200%)
function updateBoost(value) {
    // Value dari slider (1.0 sampai 2.0)
    if(boosterNode) {
        boosterNode.gain.setTargetAtTime(value, audioCtx.currentTime, 0.1);
    }
}

// 2. QUALITY SELECTOR
function selectQuality(quality) {
    currentQuality = quality;
    // Simpan waktu, reload lagu dengan folder baru
    const wasPlaying = !audioPlayer.paused;
    const currTime = audioPlayer.currentTime;
    
    playSong(currentIndex); // Reload dengan folder baru
    
    audioPlayer.currentTime = currTime;
    if(!wasPlaying) audioPlayer.pause();
    
    console.log("Quality Changed to: " + quality);
    // Tutup modal quality jika ada (panggil fungsi UI close)
    if(typeof closeQualitySheet === 'function') closeQualitySheet();
}

// --- EXISTING CONTROLS ---

function togglePlay() {
    if(!audioCtx) initAudioEngine();
    if (audioPlayer.paused) {
        if(audioPlayer.src) { audioPlayer.play(); updatePlayIcon(true); }
    } else {
        audioPlayer.pause();
        updatePlayIcon(false);
    }
}

function updatePlayIcon(isPlaying) {
    const icon = isPlaying ? "pause" : "play_arrow";
    document.getElementById('full-play-icon').innerText = icon;
    document.getElementById('mini-play-icon').innerText = icon;
}

function openSettings() {
    document.getElementById('settings-modal').classList.add('show');
    document.getElementById('settings-overlay').style.display = 'block';
}

function closeSettings() {
    document.getElementById('settings-modal').classList.remove('show');
    document.getElementById('settings-overlay').style.display = 'none';
}

function updateEQ(index, value) {
    if(!audioCtx) initAudioEngine();
    if(eqBands[index]) eqBands[index].gain.value = parseFloat(value);
}

function resetEQ() {
    if(!audioCtx) return;
    eqBands.forEach(band => band.gain.value = 0);
    document.querySelectorAll('.eq-slider').forEach(slider => slider.value = 0);
    if(is3D) document.getElementById('btn-3d').click(); 
}

function toggle3D() {
    if(!audioCtx) initAudioEngine();
    is3D = !is3D;
    if(is3D) {
        reverbGainNode.gain.setTargetAtTime(0.6, audioCtx.currentTime, 0.1); 
        updateEQ(0, parseFloat(document.querySelectorAll('.eq-slider')[0].value) + 4);
        updateEQ(4, parseFloat(document.querySelectorAll('.eq-slider')[4].value) + 4);
    } else {
        reverbGainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
        updateEQ(0, parseFloat(document.querySelectorAll('.eq-slider')[0].value) - 4);
        updateEQ(4, parseFloat(document.querySelectorAll('.eq-slider')[4].value) - 4);
    }
}

function toggleMono() {
    if(!audioCtx) initAudioEngine();
    isMono = !isMono;
    connectFinalOutput();
}

// UTILS
function toggleSave(name) {
    if(savedSongs.includes(name)) savedSongs = savedSongs.filter(n => n !== name);
    else savedSongs.push(name);
    localStorage.setItem('savedSongs', JSON.stringify(savedSongs));
    renderHomeList(allSongs);
    renderSavedList();
}
function maximizePlayer() { fullPlayer.classList.add('show'); }
function minimizePlayer() { fullPlayer.classList.remove('show'); }
function switchTab(tab) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById(`view-${tab}`).classList.add('active');
    document.getElementById(`nav-${tab}`).classList.add('active');
}
function handleSearch() {
    const term = searchInput.value.toLowerCase();
    renderHomeList(allSongs.filter(s => s.name.toLowerCase().includes(term)));
}
function playNext() {
    if (isShuffle) playSong(Math.floor(Math.random() * allSongs.length));
    else currentIndex < allSongs.length - 1 ? playSong(currentIndex + 1) : playSong(0);
}
function playPrev() {
    currentIndex > 0 ? playSong(currentIndex - 1) : playSong(allSongs.length - 1);
}
function toggleShuffle() { 
    isShuffle = !isShuffle; 
    document.getElementById('shuffle-btn').style.color = isShuffle ? '#00ff00' : '#fff'; 
}
function toggleRepeat() { 
    isRepeat = !isRepeat; 
    document.getElementById('repeat-btn').style.color = isRepeat ? '#00ff00' : '#666'; 
}
audioPlayer.ontimeupdate = () => {
    if (audioPlayer.duration) {
        const pct = (audioPlayer.currentTime / audioPlayer.duration) * 100;
        progressBar.value = pct;
        document.getElementById('mini-progress').style.width = pct + '%';
        currentTimeEl.innerText = formatTime(audioPlayer.currentTime);
        durationEl.innerText = formatTime(audioPlayer.duration);
    }
};
audioPlayer.onended = () => isRepeat ? audioPlayer.play() : playNext();
progressBar.oninput = () => audioPlayer.currentTime = (progressBar.value / 100) * audioPlayer.duration;
function formatTime(s) {
    let m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${m}:${sec < 10 ? '0'+sec : sec}`;
}

init();
