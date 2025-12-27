const CONFIG = {
    user: 'rifqydev235',
    repo: 'RifqyMusic-Backup',
    basePath: 'songs',
    folders: ['lossless'] // Hanya Folder FLAC
};

// UI Elements
const audioPlayer = new Audio();
const homeList = document.getElementById('home-list');
const savedList = document.getElementById('saved-list');
const fullPlayer = document.getElementById('view-player');
const miniPlayer = document.getElementById('mini-player');
const searchInput = document.getElementById('search-input');

// Info Elements
const fullTitle = document.getElementById('full-title');
const fullArtist = document.getElementById('full-artist');
const miniTitle = document.getElementById('mini-title');
const miniArtist = document.getElementById('mini-artist');
const progressBar = document.getElementById('progress-bar');
const currentTimeEl = document.getElementById('current-time');
const durationEl = document.getElementById('duration');
const fullPlayIcon = document.getElementById('full-play-icon');
const miniPlayIcon = document.getElementById('mini-play-icon');
const shuffleBtn = document.getElementById('shuffle-btn');
const repeatBtn = document.getElementById('repeat-btn');

// State
let allSongs = [];
let savedSongs = JSON.parse(localStorage.getItem('savedSongs')) || [];
let currentIndex = 0;
let isShuffle = false;
let isRepeat = false;

// --- INIT APP ---
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
        
        // --- EDIT: SUPPORT FLAC & MP3 ---
        allSongs = results.flat().filter(f => {
            const name = f.name.toLowerCase();
            return name.endsWith('.flac') || name.endsWith('.mp3');
        });

        if (allSongs.length > 0) {
            document.getElementById('loading-text').style.display = 'none';
            renderHomeList(allSongs);
            renderSavedList();
        } else {
            document.getElementById('loading-text').innerText = "Tidak ada lagu ditemukan.";
        }
    } catch (e) {
        console.error(e);
        document.getElementById('loading-text').innerText = "Gagal memuat: " + e.message;
    }
}

// --- RENDER UI ---
function renderHomeList(songs) {
    homeList.innerHTML = "";
    songs.forEach((song, index) => {
        const isSaved = savedSongs.includes(song.name);
        const title = parseTitle(song.name).title;
        
        // --- EDIT: DETEKSI FORMAT ---
        const isFlac = song.name.toLowerCase().endsWith('.flac');
        const badgeText = isFlac ? 'FLAC' : 'HQ'; 
        
        const div = document.createElement('div');
        div.className = 'list-item';
        div.innerHTML = `
            <div class="list-img" onclick="playSong(${index})">
                <span class="material-icons-round" style="color:#666;">audiotrack</span>
                <div class="badge-flac">${badgeText}</div>
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
    if(savedSongs.length === 0) {
        savedList.innerHTML = '<p style="text-align:center; color:#666; margin-top:20px;">Belum ada lagu disimpan.</p>';
        return;
    }

    const mySavedSongs = allSongs.filter(s => savedSongs.includes(s.name));
    mySavedSongs.forEach((song) => {
        const originalIndex = allSongs.findIndex(s => s.name === song.name);
        const title = parseTitle(song.name).title;
        
        const div = document.createElement('div');
        div.className = 'list-item';
        div.innerHTML = `
            <div class="list-img" onclick="playSong(${originalIndex})">
                <span class="material-icons-round" style="color:#666;">audiotrack</span>
            </div>
            <div class="list-info" onclick="playSong(${originalIndex})">
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

// --- PLAYER LOGIC ---
function playSong(index) {
    currentIndex = index;
    const song = allSongs[index];
    const meta = parseTitle(song.name);
    
    const songUrl = `./${song.folderPath}/${encodeURIComponent(song.name)}`;
    audioPlayer.src = songUrl;
    audioPlayer.load();
    audioPlayer.play();

    fullTitle.innerText = meta.title;
    fullArtist.innerText = meta.artist;
    miniTitle.innerText = meta.title;
    miniArtist.innerText = meta.artist;
    
    miniPlayer.classList.remove('hidden');
    maximizePlayer();
    updatePlayIcon(true);
}

function togglePlay() {
    if (audioPlayer.paused) {
        if(audioPlayer.src) { audioPlayer.play(); updatePlayIcon(true); }
    } else {
        audioPlayer.pause();
        updatePlayIcon(false);
    }
}

function updatePlayIcon(isPlaying) {
    const icon = isPlaying ? "pause" : "play_arrow";
    fullPlayIcon.innerText = icon;
    miniPlayIcon.innerText = icon;
}

function maximizePlayer() { fullPlayer.classList.add('show'); }
function minimizePlayer() { fullPlayer.classList.remove('show'); }

function playNext() {
    if (allSongs.length === 0) return;
    if (isShuffle) {
        playSong(Math.floor(Math.random() * allSongs.length));
    } else {
        currentIndex < allSongs.length - 1 ? playSong(currentIndex + 1) : playSong(0);
    }
}

function playPrev() {
    currentIndex > 0 ? playSong(currentIndex - 1) : playSong(allSongs.length - 1);
}

function toggleShuffle() {
    isShuffle = !isShuffle;
    shuffleBtn.style.color = isShuffle ? '#00ff00' : '#fff';
}

function toggleRepeat() {
    isRepeat = !isRepeat;
    repeatBtn.style.color = isRepeat ? '#00ff00' : '#666';
}

// --- UTILS ---
function toggleSave(songName) {
    if(savedSongs.includes(songName)) {
        savedSongs = savedSongs.filter(name => name !== songName);
    } else {
        savedSongs.push(songName);
    }
    localStorage.setItem('savedSongs', JSON.stringify(savedSongs));
    renderHomeList(allSongs);
    renderSavedList();
}

function switchTab(tab) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById(`view-${tab}`).classList.add('active');
    document.getElementById(`nav-${tab}`).classList.add('active');
}

function handleSearch() {
    const term = searchInput.value.toLowerCase();
    const filtered = allSongs.filter(s => s.name.toLowerCase().includes(term));
    renderHomeList(filtered);
}

function parseTitle(filename) {
    const raw = filename.replace(/\.[^/.]+$/, "").replace(/-/g, " "); 
    return { title: raw, artist: "RifqyMusic" };
}

// --- EVENTS ---
audioPlayer.ontimeupdate = () => {
    if (audioPlayer.duration) {
        progressBar.value = (audioPlayer.currentTime / audioPlayer.duration) * 100;
        currentTimeEl.innerText = formatTime(audioPlayer.currentTime);
        durationEl.innerText = formatTime(audioPlayer.duration);
    }
};
audioPlayer.onended = () => isRepeat ? audioPlayer.play() : playNext();
progressBar.oninput = () => audioPlayer.currentTime = (progressBar.value / 100) * audioPlayer.duration;

function formatTime(s) {
    let m = Math.floor(s / 60);
    let sec = Math.floor(s % 60);
    return `${m}:${sec < 10 ? '0'+sec : sec}`;
}

init();
