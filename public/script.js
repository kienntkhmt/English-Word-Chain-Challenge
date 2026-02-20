const socket = io();
let mySocketId = '';

// DOM Elements
const lobbyArea = document.getElementById('lobbyArea');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const roomCodeInput = document.getElementById('roomCodeInput');
const lobbyMessage = document.getElementById('lobbyMessage');
const setMaxPlayers = document.getElementById('setMaxPlayers');
const setMinLength = document.getElementById('setMinLength');
const setMaxLength = document.getElementById('setMaxLength');
const setTurnTime = document.getElementById('setTurnTime');

const gameArea = document.getElementById('gameArea');
const displayRoomCode = document.getElementById('displayRoomCode');
const startGameBtn = document.getElementById('startGameBtn');
const turnIndicator = document.getElementById('turnIndicator');
const targetLetterEl = document.getElementById('targetLetter');
const wordInput = document.getElementById('wordInput');
const submitBtn = document.getElementById('submitBtn');
const gameMessage = document.getElementById('gameMessage');
const historyList = document.getElementById('historyList');
const playersScoreContainer = document.getElementById('playersScoreContainer');
const timerDisplay = document.getElementById('timerDisplay');
const ruleBox = document.getElementById('ruleBox');
const leaveRoomBtn = document.getElementById('leaveRoomBtn');

socket.on('connect', () => { mySocketId = socket.id; });

// --- TẠO VÀ VÀO PHÒNG ---
createRoomBtn.addEventListener('click', () => {
    const settings = {
        maxPlayers: setMaxPlayers.value,
        minLength: setMinLength.value,
        maxLength: setMaxLength.value,
        turnTime: setTurnTime.value
    };
    socket.emit('createRoom', settings);
});

joinRoomBtn.addEventListener('click', () => {
    const code = roomCodeInput.value.trim();
    if (code.length === 4) socket.emit('joinRoom', code);
    else lobbyMessage.textContent = "Mã phòng phải gồm 4 chữ số!";
});

// Chủ phòng bấm Bắt đầu
startGameBtn.addEventListener('click', () => {
    socket.emit('startGame');
});

socket.on('roomCreated', (code) => {
    displayRoomCode.textContent = code;
    lobbyArea.classList.add('hidden');
    gameArea.classList.remove('hidden');
});

leaveRoomBtn.addEventListener('click', () => {
    if(confirm("Rời phòng sẽ làm kết thúc trò chơi. Bạn chắc chứ?")) {
        socket.emit('leaveRoom');
    }
});
socket.on('leftRoomSuccess', () => { location.reload(); });

// --- RENDER DỮ LIỆU GAME ĐỘNG TỪ SERVER ---
socket.on('gameStateUpdate', (room) => {
    lobbyArea.classList.add('hidden');
    gameArea.classList.remove('hidden');
    displayRoomCode.textContent = room.id;

    ruleBox.textContent = `Tối đa ${room.settings.maxPlayers} người | Từ ${room.settings.minLength}-${room.settings.maxLength} ký tự | ${room.settings.turnTime}s/lượt`;

    // 1. RENDER DANH SÁCH NGƯỜI CHƠI (SCOREBOARD)
    playersScoreContainer.innerHTML = '';
    room.players.forEach((player, index) => {
        const badge = document.createElement('div');
        badge.className = 'player-badge';
        
        // Hightlight nếu người này đang tới lượt (và game đã bắt đầu)
        if (room.status === 'playing' && index === room.turnIndex) {
            badge.classList.add('active-turn');
        }
        // Đánh dấu nếu đây là bản thân mình
        if (player.id === mySocketId) {
            badge.classList.add('is-me');
            badge.textContent = `${player.name} (Bạn): ${player.score}đ`;
        } else {
            badge.textContent = `${player.name}: ${player.score}đ`;
        }
        
        playersScoreContainer.appendChild(badge);
    });

    // 2. RENDER LỊCH SỬ TỪ
    targetLetterEl.textContent = room.currentTargetLetter ? room.currentTargetLetter.toUpperCase() : "?";
    historyList.innerHTML = '';
    room.historyWords.forEach(word => {
        const span = document.createElement('span');
        span.className = 'history-item';
        span.textContent = word;
        historyList.appendChild(span);
    });

    // 3. QUẢN LÝ LƯỢT VÀ GIAO DIỆN
    if (room.status === 'waiting') {
        // NẾU ĐANG CHỜ TRONG LOBBY
        wordInput.disabled = true;
        submitBtn.disabled = true;
        timerDisplay.textContent = "⏳ --s";

        // Chỉ Chủ phòng mới thấy nút Bắt đầu, và phải có >= 2 người
        if (room.hostId === mySocketId) {
            if (room.players.length >= 2) {
                turnIndicator.textContent = "Đã đủ người, bạn có thể bắt đầu!";
                turnIndicator.className = 'turn-indicator my-turn';
                startGameBtn.classList.remove('hidden');
            } else {
                turnIndicator.textContent = `Đang chờ người chơi... (${room.players.length}/${room.settings.maxPlayers})`;
                turnIndicator.className = 'turn-indicator waiting-turn';
                startGameBtn.classList.add('hidden');
            }
        } else {
            turnIndicator.textContent = "Đang chờ Chủ phòng bắt đầu game...";
            turnIndicator.className = 'turn-indicator waiting-turn';
            startGameBtn.classList.add('hidden');
        }
    } else {
        // NẾU GAME ĐANG CHƠI
        startGameBtn.classList.add('hidden'); // Ẩn nút Start đi
        const currentPlayerId = room.players[room.turnIndex].id;
        
        if (currentPlayerId === mySocketId) {
            turnIndicator.textContent = "🔥 Tới lượt của bạn! Nhập ngay!";
            turnIndicator.className = 'turn-indicator my-turn';
            wordInput.disabled = false;
            submitBtn.disabled = false;
            wordInput.focus();
        } else {
            // Tìm tên người đang đánh để hiển thị cho thân thiện
            const currentName = room.players[room.turnIndex].name;
            turnIndicator.textContent = `⏳ Đang đợi ${currentName} nhập từ...`;
            turnIndicator.className = 'turn-indicator opponent-turn';
            wordInput.disabled = true;
            submitBtn.disabled = true;
        }
    }
    gameMessage.textContent = ""; 
});

socket.on('timeUpdate', (timeLeft) => {
    timerDisplay.textContent = `⏳ ${timeLeft}s`;
    if(timeLeft <= 5) timerDisplay.style.color = "#ff4d4d";
    else timerDisplay.style.color = "#b026ff";
});

socket.on('wordAccepted', () => {
    wordInput.value = "";
    confetti({ particleCount: 50, spread: 60, origin: { y: 0.6 }});
});

socket.on('errorMessage', (msg) => {
    if (!gameArea.classList.contains('hidden')) {
        gameMessage.textContent = msg;
        gameMessage.style.color = "#ff4d4d";
        wordInput.classList.remove('shake');
        void wordInput.offsetWidth;
        wordInput.classList.add('shake');
    } else {
        lobbyMessage.textContent = msg;
        lobbyMessage.style.color = "#ff4d4d";
    }
});

socket.on('timeoutEvent', (msg) => {
    gameMessage.textContent = msg;
    gameMessage.style.color = "#ff9900";
    wordInput.value = ""; 
});

socket.on('playerLeft', (msg) => {
    alert(msg);
    location.reload(); 
});

function handleSubmit() {
    const word = wordInput.value.trim();
    if (word) {
        socket.emit('submitWord', word);
        wordInput.value = '';
    }
}

submitBtn.addEventListener('click', handleSubmit);
wordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSubmit();
});