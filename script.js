const CONFIG = {
    user: 'rydevs29',
    repo: 'RifqyMusic',
    basePath: 'songs',
    // Folder: lossless (untuk mp3/flac), covers (untuk gambar)
    folders: ['lossless'] 
};

// --- AUDIO ENGINE (WEB AUDIO API) ---
let audioCtx, source;
let eqBands = [];
let is3D = false;

const audioPlayer = new Audio();
audioPlayer.crossOrigin = "anonymous"; // WAJIB untuk efek

// Elements
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

// State
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
        // Filter hanya file audio
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

// --- AUDIO FX SETUP ---
function initAudioEngine() {
    if (audioCtx) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext();
    source = audioCtx.createMediaElementSource(audioPlayer);

    // 1. Equalizer 5 Band
    const freqs = [60, 250, 1000, 4000, 16000];
    eqBands = freqs.map(f => {
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = f;
        filter.gain.value = 0;
        return filter;
    });

    // Rangkai Kabel: Source -> EQ1 -> EQ2... -> Output
    let chain = source;
    eqBands.forEach(band => { chain.connect(band); chain = band; });
    chain.connect(audioCtx.destination);
}

// --- UI LOGIC ---
function renderHomeList(songs) {
    homeList.innerHTML = "";
    songs.forEach((song, index) => {
        const isSaved = savedSongs.includes(song.name);
        const title = parseTitle(song.name).title;
        const isFlac = song.name.toLowerCase().endsWith('.flac');
        
        // LOGIKA GAMBAR: Ambil dari folder 'covers'
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

// --- PLAYER CONTROLS ---
function playSong(index) {
    if(!audioCtx) initAudioEngine();
    if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

    currentIndex = index;
    const song = allSongs[index];
    const meta = parseTitle(song.name);

    // Set Cover Player
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

// --- SETTINGS / FX ---
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

function toggle3D() {
    if(!audioCtx) initAudioEngine();
    is3D = !is3D;
    // Simulasi 3D Simple: Boost Bass & Treble (V-Shape)
    if(is3D) {
        updateEQ(0, 6); updateEQ(4, 6); // Boost Ujung
    } else {
        updateEQ(0, 0); updateEQ(4, 0); // Flat
    }
}

function toggleMono() { alert("Mode Mono diaktifkan!"); }

// --- UTILS & NAVIGATION ---
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
