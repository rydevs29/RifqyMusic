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
let reverbNode, reverbGainNode; // Untuk 3D Real
let monoMergerNode, masterGainNode; // Untuk Mono & Master Volume

// Status FX
let is3D = false;
let isMono = false;

const audioPlayer = new Audio();
audioPlayer.crossOrigin = "anonymous"; // WAJIB

// UI Elements (Sama seperti sebelumnya)
const homeList = document.getElementById('home-list');
const savedList = document.getElementById('saved-list');
const fullPlayer = document.getElementById('view-player');
const miniPlayer = document.getElementById('mini-player');
const searchInput = document.getElementById('search-input');
const fullTitle = document.getElementById('full-title');
const fullArtist = document.getElementById('full-artist');
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

// --- SETUP AUDIO ENGINE CANGGIH ---
function initAudioEngine() {
    if (audioCtx) return; // Cegah double init
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext();
    source = audioCtx.createMediaElementSource(audioPlayer);

    // 1. SETUP EQUALIZER (5 Band Series)
    const freqs = [60, 250, 1000, 4000, 16000];
    eqBands = freqs.map(f => {
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = f;
        filter.gain.value = 0; // Default Flat
        return filter;
    });
    // Rangkai EQ secara seri: Source -> EQ1 -> EQ2... -> EQ5
    let eqChain = source;
    eqBands.forEach(band => { eqChain.connect(band); eqChain = band; });
    const eqOutput = eqChain; // Output akhir dari rantai EQ

    // 2. SETUP 3D REVERB (Convolver - Gema Nyata)
    reverbNode = audioCtx.createConvolver();
    reverbGainNode = audioCtx.createGain();
    reverbGainNode.gain.value = 0; // Default Mati (Dry)

    // Membuat impuls gema buatan (Hall Effect 2 detik)
    const duration = 2;
    const length = audioCtx.sampleRate * duration;
    const impulse = audioCtx.createBuffer(2, length, audioCtx.sampleRate);
    for (let i = 0; i < length; i++) {
        // Noise yang mengecil secara eksponensial untuk simulasi gema
        const decay = Math.pow(1 - i / length, 2);
        impulse.getChannelData(0)[i] = (Math.random() * 2 - 1) * decay;
        impulse.getChannelData(1)[i] = (Math.random() * 2 - 1) * decay;
    }
    reverbNode.buffer = impulse;

    // 3. SETUP MONO & MASTER
    monoMergerNode = audioCtx.createChannelMerger(1); // Paksa jadi 1 channel
    masterGainNode = audioCtx.createGain(); // Volume Akhir sebelum speaker

    // --- ROUTING KABEL AUDIO (PENTING!) ---
    // Jalur 1 (Dry/Asli): EQ Output langsung ke Master
    eqOutput.connect(masterGainNode);
    
    // Jalur 2 (Wet/3D): EQ Output -> Reverb -> Reverb Volume -> Master
    eqOutput.connect(reverbNode);
    reverbNode.connect(reverbGainNode);
    reverbGainNode.connect(masterGainNode);

    // Jalur Akhir: Master -> Speaker (Default Stereo)
    connectFinalOutput();
}

// Fungsi Routing Akhir (Stereo vs Mono)
function connectFinalOutput() {
    // Putus dulu koneksi lama biar gak numpuk
    masterGainNode.disconnect();
    monoMergerNode.disconnect();

    if (isMono) {
        // Jika Mono Aktif: Master -> Merger (jadi 1) -> Speaker
        masterGainNode.connect(monoMergerNode);
        monoMergerNode.connect(audioCtx.destination);
    } else {
        // Jika Stereo (Default): Master -> Speaker langsung
        masterGainNode.connect(audioCtx.destination);
    }
}

// --- LOGIKA UI & PLAYER (Sama seperti sebelumnya) ---
function renderHomeList(songs) {
    homeList.innerHTML = "";
    songs.forEach((song, index) => {
        const isSaved = savedSongs.includes(song.name);
        const title = parseTitle(song.name).title;
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
                <h4>${title}</h4>
                <p>RifqyMusic</p>
            </div>
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
        const title = parseTitle(song.name).title;
        const div = document.createElement('div');
        div.className = 'list-item';
        div.innerHTML = `
            <div class="list-img" onclick="playSong(${idx})">
                <span class="material-icons-round" style="color:#666;">audiotrack</span>
            </div>
            <div class="list-info" onclick="playSong(${idx})">
                <h4>${title}</h4>
                <p>Tersimpan</p>
            </div>
            <button class="btn-save active" onclick="toggleSave('${song.name}')">
                <span class="material-icons-round">bookmark</span>
            </button>
        `;
        savedList.appendChild(div);
    });
}

function playSong(index) {
    // Wajib init engine saat user interaksi pertama
    if(!audioCtx) initAudioEngine();
    if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

    currentIndex = index;
    const song = allSongs[index];
    const meta = parseTitle(song.name);
    const fileNameNoExt = song.name.replace(/\.[^/.]+$/, "");
    fullCover.src = `./songs/covers/${encodeURIComponent(fileNameNoExt)}.jpg`;

    audioPlayer.src = `./${song.folderPath}/${encodeURIComponent(song.name)}`;
    audioPlayer.play();

    fullTitle.innerText = meta.title;
    fullArtist.innerText = meta.artist;
    document.getElementById('mini-title').innerText = meta.title;
    document.getElementById('mini-artist').innerText = meta.artist;
    miniPlayer.classList.remove('hidden');
    maximizePlayer();
    updatePlayIcon(true);
}

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

// --- SETTINGS & FX CONTROLS (REAL TIME) ---
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
    // Jika 3D aktif, matikan visualnya juga karena EQ direset
    if(is3D) {
        document.getElementById('btn-3d').click(); 
    }
}

// TOGGLE REAL 3D SURROUND
function toggle3D() {
    if(!audioCtx) initAudioEngine();
    is3D = !is3D;
    if(is3D) {
        // Aktifkan: Naikkan volume jalur Reverb (Wet Signal)
        // Dan sedikit boost EQ ujung untuk efek "lebar"
        reverbGainNode.gain.setTargetAtTime(0.6, audioCtx.currentTime, 0.1); // 60% Gema
        updateEQ(0, parseFloat(document.querySelectorAll('.eq-slider')[0].value) + 4);
        updateEQ(4, parseFloat(document.querySelectorAll('.eq-slider')[4].value) + 4);
    } else {
        // Matikan: Volume reverb jadi 0
        reverbGainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
        updateEQ(0, parseFloat(document.querySelectorAll('.eq-slider')[0].value) - 4);
        updateEQ(4, parseFloat(document.querySelectorAll('.eq-slider')[4].value) - 4);
    }
}

// TOGGLE REAL MONO AUDIO
function toggleMono() {
    if(!audioCtx) initAudioEngine();
    isMono = !isMono;
    // Ubah routing akhir secara real-time
    connectFinalOutput();
}

// --- UTILS ---
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
function parseTitle(filename) {
    return { title: filename.replace(/\.[^/.]+$/, "").replace(/-/g, " "), artist: "RifqyMusic" };
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
