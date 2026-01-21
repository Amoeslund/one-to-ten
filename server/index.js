const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { nanoid } = require('nanoid');
const db = require('./db');

const app = express();
const server = createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// API endpoint for game history
app.get('/api/history', (req, res) => {
  const games = db.getRecentGames(50);
  res.json(games);
});

// In-memory room storage (rooms are ephemeral, only history persists)
const rooms = new Map();

// Room states: 'waiting' | 'challenge_set' | 'completed'

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Create a new room
  socket.on('create-room', (callback) => {
    const roomCode = nanoid(6).toUpperCase();
    rooms.set(roomCode, {
      state: 'waiting',
      player1: {
        socketId: socket.id,
        name: null,
        numberHash: null,
        salt: null,
        number: null
      },
      player2: null,
      challenge: null,
      maxNumber: 10,
      createdAt: Date.now()
    });
    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.playerRole = 'player1';
    callback({ success: true, roomCode });
    console.log(`Room created: ${roomCode}`);
  });

  // Join an existing room
  socket.on('join-room', (roomCode, callback) => {
    const code = roomCode.toUpperCase();
    const room = rooms.get(code);

    if (!room) {
      callback({ success: false, error: 'Room not found' });
      return;
    }

    if (room.player2) {
      callback({ success: false, error: 'Room is full' });
      return;
    }

    if (room.state !== 'waiting' && room.state !== 'challenge_set') {
      callback({ success: false, error: 'Game already completed' });
      return;
    }

    room.player2 = {
      socketId: socket.id,
      name: null,
      number: null
    };

    socket.join(code);
    socket.roomCode = code;
    socket.playerRole = 'player2';

    callback({
      success: true,
      roomCode: code,
      hasChallenge: room.state === 'challenge_set',
      challenge: room.challenge,
      maxNumber: room.maxNumber,
      player1Name: room.player1.name
    });

    // Notify player 1 that someone joined
    io.to(room.player1.socketId).emit('player-joined');
    console.log(`Player joined room: ${code}`);
  });

  // Player 1 sets their name
  socket.on('set-name', (name, callback) => {
    const room = rooms.get(socket.roomCode);
    if (!room) {
      callback({ success: false, error: 'Room not found' });
      return;
    }

    if (socket.playerRole === 'player1') {
      room.player1.name = name;
    } else if (socket.playerRole === 'player2') {
      room.player2.name = name;
      // Notify player 1 of player 2's name
      io.to(room.player1.socketId).emit('player2-named', name);
    }

    callback({ success: true });
  });

  // Player 1 submits challenge with commitment
  socket.on('submit-challenge', ({ challenge, maxNumber, numberHash }, callback) => {
    const room = rooms.get(socket.roomCode);
    if (!room || socket.playerRole !== 'player1') {
      callback({ success: false, error: 'Invalid operation' });
      return;
    }

    room.challenge = challenge;
    room.maxNumber = maxNumber;
    room.player1.numberHash = numberHash;
    room.state = 'challenge_set';

    callback({ success: true });

    // If player 2 is already in the room, send them the challenge
    if (room.player2) {
      io.to(room.player2.socketId).emit('challenge-ready', {
        challenge: room.challenge,
        maxNumber: room.maxNumber,
        player1Name: room.player1.name
      });
    }

    console.log(`Challenge set in room ${socket.roomCode}`);
  });

  // Player 2 submits their number guess
  socket.on('submit-guess', ({ number }, callback) => {
    const room = rooms.get(socket.roomCode);
    if (!room || socket.playerRole !== 'player2') {
      callback({ success: false, error: 'Invalid operation' });
      return;
    }

    room.player2.number = number;

    callback({ success: true });

    // Tell player 1 that player 2 has guessed, request reveal
    io.to(room.player1.socketId).emit('guess-submitted', {
      player2Name: room.player2.name
    });

    console.log(`Player 2 guessed in room ${socket.roomCode}`);
  });

  // Player 1 reveals their number
  socket.on('reveal-number', ({ number, salt }, callback) => {
    const room = rooms.get(socket.roomCode);
    if (!room || socket.playerRole !== 'player1') {
      callback({ success: false, error: 'Invalid operation' });
      return;
    }

    room.player1.number = number;
    room.player1.salt = salt;
    room.state = 'completed';

    const matched = room.player1.number === room.player2.number;

    // Save to history
    try {
      db.saveGame({
        roomCode: socket.roomCode,
        player1Name: room.player1.name,
        player2Name: room.player2.name,
        challenge: room.challenge,
        maxNumber: room.maxNumber,
        player1Number: room.player1.number,
        player2Number: room.player2.number,
        matched
      });
    } catch (err) {
      console.error('Failed to save game:', err);
    }

    const result = {
      player1Number: number,
      player2Number: room.player2.number,
      salt: salt,
      numberHash: room.player1.numberHash,
      matched,
      challenge: room.challenge,
      player1Name: room.player1.name,
      player2Name: room.player2.name
    };

    // Send result to both players
    callback({ success: true, result });
    io.to(room.player2.socketId).emit('game-result', result);

    console.log(`Game completed in room ${socket.roomCode}: ${matched ? 'MATCH!' : 'No match'}`);

    // Clean up room after a delay
    setTimeout(() => {
      rooms.delete(socket.roomCode);
    }, 60000); // Keep room for 1 minute for reconnection
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    const room = rooms.get(socket.roomCode);
    if (room) {
      // Notify other player
      if (socket.playerRole === 'player1' && room.player2) {
        io.to(room.player2.socketId).emit('opponent-disconnected');
      } else if (socket.playerRole === 'player2') {
        io.to(room.player1.socketId).emit('opponent-disconnected');
      }
    }
  });
});

// Cleanup old rooms periodically
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    // Remove rooms older than 1 hour
    if (now - room.createdAt > 60 * 60 * 1000) {
      rooms.delete(code);
      console.log(`Cleaned up stale room: ${code}`);
    }
  }
}, 60000);

server.listen(PORT, () => {
  console.log(`One to Ten server running on port ${PORT}`);
});
