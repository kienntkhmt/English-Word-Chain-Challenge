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

// --- LOGIC MỚI: XỬ LÝ KHI HẾT GIỜ ---
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
            
            // Tìm ra người vừa làm hết giờ
            const loser = room.players[room.turnIndex];

            // Đặt lại trạng thái phòng về "Đang chờ" để có thể chơi ván mới
            room.status = 'waiting';
            room.historyWords = [];
            room.currentTargetLetter = '';
            room.turnIndex = 0;
            
            // Đặt lại điểm số của tất cả người chơi về 0
            room.players.forEach(p => p.score = 0);

            // Bắn tín hiệu Game Over cho cả phòng
            io.to(roomCode).emit('gameOver', `💥 End gem.\n[${loser.name}] quá óc chó đã không tìm được từ nối.\nTrò chơi kết thúc!`);
            
            // Đồng bộ lại giao diện (sẽ tự động đưa mọi người về sảnh chờ trong phòng)
            io.to(roomCode).emit('gameStateUpdate', room);
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
        io.to(roomCode).emit('playerLeft', 'Một người chơi đã rời phòng. Trò chơi kết thúc!');
        delete rooms[roomCode];
    }
    delete playerRooms[socketId];
}

io.on('connection', (socket) => {
    
    socket.on('createRoom', (data) => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            id: roomCode,
            hostId: socket.id,
            settings: {
                minLength: parseInt(data.settings.minLength) || 2,
                maxLength: parseInt(data.settings.maxLength) || 15,
                turnTime: parseInt(data.settings.turnTime) || 20,
                maxPlayers: parseInt(data.settings.maxPlayers) || 4
            },
            players: [{ id: socket.id, score: 0, name: data.playerName }],
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

    socket.on('joinRoom', (data) => {
        const room = rooms[data.roomCode];
        if (!room) return socket.emit('errorMessage', 'Không tìm thấy phòng này!');
        if (room.status === 'playing') return socket.emit('errorMessage', 'Phòng này đang chơi rồi!');
        if (room.players.length >= room.settings.maxPlayers) return socket.emit('errorMessage', 'Phòng đã đầy!');

        room.players.push({ id: socket.id, score: 0, name: data.playerName });
        
        socket.join(data.roomCode);
        playerRooms[socket.id] = data.roomCode;

        io.to(data.roomCode).emit('gameStateUpdate', room);
    });

    socket.on('startGame', () => {
        const roomCode = playerRooms[socket.id];
        const room = rooms[roomCode];
        if (room && room.hostId === socket.id && room.players.length >= 2) {
            room.status = 'playing';
            io.to(roomCode).emit('gameStateUpdate', room);
            startTurnTimer(roomCode);
        }
    });

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
        room.turnIndex = (room.turnIndex + 1) % room.players.length;

        startTurnTimer(roomCode);
        io.to(roomCode).emit('gameStateUpdate', room);
        io.to(roomCode).emit('wordAccepted', { word: word });
    });

    socket.on('sendChatMessage', (message) => {
        const roomCode = playerRooms[socket.id];
        const room = rooms[roomCode];
        if (!room) return;
        const player = room.players.find(p => p.id === socket.id);
        if (player) {
            io.to(roomCode).emit('receiveChatMessage', {
                senderId: socket.id,
                senderName: player.name,
                message: message
            });
        }
    });

    socket.on('leaveRoom', () => { handlePlayerLeave(socket.id); socket.emit('leftRoomSuccess'); });
    socket.on('disconnect', () => { handlePlayerLeave(socket.id); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server chạy tại http://localhost:${PORT}`));