const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let dictionary = new Set();
try {
    const wordsArray = JSON.parse(fs.readFileSync('words.json', 'utf8'));
    dictionary = new Set(wordsArray.map(w => w.toLowerCase()));
    console.log(`Đã nạp ${dictionary.size} từ vào Server.`);
} catch (error) {
    console.error("Lỗi đọc file words.json:", error);
}

const rooms = {};
const playerRooms = {};
const roomTimers = {}; 

function generateRoomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

function startTurnTimer(roomCode) {
    const room = rooms[roomCode];
    if (!room || room.status !== 'playing') return;

    if (roomTimers[roomCode]) clearInterval(roomTimers[roomCode]);
    room.timeLeft = room.settings.turnTime;
    io.to(roomCode).emit('timeUpdate', room.timeLeft);

    roomTimers[roomCode] = setInterval(() => {
        room.timeLeft--;
        io.to(roomCode).emit('timeUpdate', room.timeLeft);

        if (room.timeLeft <= 0) {
            clearInterval(roomTimers[roomCode]);
            room.turnIndex = (room.turnIndex + 1) % room.players.length;
            io.to(roomCode).emit('timeoutEvent', '⏳ Hết giờ! Chuyển lượt cho người tiếp theo.');
            io.to(roomCode).emit('gameStateUpdate', room);
            startTurnTimer(roomCode); 
        }
    }, 1000);
}

function handlePlayerLeave(socketId) {
    const roomCode = playerRooms[socketId];
    if (roomCode && rooms[roomCode]) {
        if (roomTimers[roomCode]) {
            clearInterval(roomTimers[roomCode]); 
            delete roomTimers[roomCode];
        }
        // Để đơn giản: Bất kỳ ai thoát cũng làm kết thúc game để đảm bảo tính liên tục của chuỗi
        io.to(roomCode).emit('playerLeft', 'Một người chơi đã rời phòng. Trò chơi kết thúc!');
        delete rooms[roomCode];
    }
    delete playerRooms[socketId];
}

io.on('connection', (socket) => {
    
    // --- TẠO PHÒNG ---
    socket.on('createRoom', (settings) => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            id: roomCode,
            hostId: socket.id, // Lưu lại ID của chủ phòng
            settings: {
                minLength: parseInt(settings.minLength) || 2,
                maxLength: parseInt(settings.maxLength) || 15,
                turnTime: parseInt(settings.turnTime) || 20,
                maxPlayers: parseInt(settings.maxPlayers) || 4 // Số người tối đa
            },
            players: [{ id: socket.id, score: 0, name: "Player 1" }],
            historyWords: [],
            currentTargetLetter: '',
            turnIndex: 0,
            status: 'waiting',
            timeLeft: 0
        };
        
        socket.join(roomCode);
        playerRooms[socket.id] = roomCode;
        
        socket.emit('roomCreated', roomCode);
        socket.emit('gameStateUpdate', rooms[roomCode]);
    });

    // --- VÀO PHÒNG ---
    socket.on('joinRoom', (roomCode) => {
        const room = rooms[roomCode];
        if (!room) return socket.emit('errorMessage', 'Không tìm thấy phòng này!');
        if (room.status === 'playing') return socket.emit('errorMessage', 'Phòng này đang chơi rồi!');
        if (room.players.length >= room.settings.maxPlayers) return socket.emit('errorMessage', 'Phòng đã đầy!');

        // Đánh số thứ tự người chơi (Player 2, Player 3...)
        const playerNumber = room.players.length + 1;
        room.players.push({ id: socket.id, score: 0, name: `Player ${playerNumber}` });
        
        socket.join(roomCode);
        playerRooms[socket.id] = roomCode;

        io.to(roomCode).emit('gameStateUpdate', room);
    });

    // --- CHỦ PHÒNG BẮT ĐẦU GAME ---
    socket.on('startGame', () => {
        const roomCode = playerRooms[socket.id];
        const room = rooms[roomCode];
        
        if (room && room.hostId === socket.id && room.players.length >= 2) {
            room.status = 'playing';
            io.to(roomCode).emit('gameStateUpdate', room);
            startTurnTimer(roomCode);
        }
    });

    // --- XỬ LÝ NHẬP TỪ ---
    socket.on('submitWord', (word) => {
        const roomCode = playerRooms[socket.id];
        const room = rooms[roomCode];

        if (!room || room.status !== 'playing') return;

        const currentPlayer = room.players[room.turnIndex];
        if (socket.id !== currentPlayer.id) return socket.emit('errorMessage', 'Chưa tới lượt của bạn!');

        word = word.toLowerCase().trim();

        if (word.length < room.settings.minLength || word.length > room.settings.maxLength) {
            return socket.emit('errorMessage', `Từ phải dài từ ${room.settings.minLength} đến ${room.settings.maxLength} ký tự!`);
        }
        if (!dictionary.has(word)) return socket.emit('errorMessage', 'Từ không có trong từ điển!');
        if (room.historyWords.includes(word)) return socket.emit('errorMessage', 'Từ này đã được sử dụng rồi!');
        if (room.currentTargetLetter && !word.startsWith(room.currentTargetLetter)) {
            return socket.emit('errorMessage', `Phải bắt đầu bằng chữ '${room.currentTargetLetter.toUpperCase()}'!`);
        }

        room.historyWords.push(word);
        room.currentTargetLetter = word.slice(-1);
        currentPlayer.score += 50;
        
        // Vòng lặp lượt: Player 1 -> 2 -> 3 -> 4 -> Quay lại 1
        room.turnIndex = (room.turnIndex + 1) % room.players.length;

        startTurnTimer(roomCode);
        io.to(roomCode).emit('gameStateUpdate', room);
        io.to(roomCode).emit('wordAccepted', { word: word });
    });

    socket.on('leaveRoom', () => { handlePlayerLeave(socket.id); socket.emit('leftRoomSuccess'); });
    socket.on('disconnect', () => { handlePlayerLeave(socket.id); });
});

const PORT = 3000;
server.listen(PORT, () => console.log(`🚀 Server chạy tại http://localhost:${PORT}`));