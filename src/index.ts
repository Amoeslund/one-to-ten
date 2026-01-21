import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import path from 'path';
import { nanoid } from 'nanoid';
import { saveGame, getRecentGames, GameData } from './db';

// Extend Socket type to include custom properties
interface GameSocket extends Socket {
  roomCode?: string;
  playerRole?: 'player1' | 'player2' | 'spectator';
  sessionId?: string;
}

// Room types
type RoomState = 'waiting' | 'challenge_set' | 'completed';

interface Player1 {
  socketId: string;
  sessionId: string;
  name: string | null;
  numberHash: string | null;
  salt: string | null;
  number: number | null;
}

interface Player2 {
  socketId: string;
  sessionId: string;
  name: string | null;
  number: number | null;
}

interface GameResult {
  player1Number: number;
  player2Number: number;
  salt: string;
  numberHash: string;
  matched: boolean;
  challenge: string;
  player1Name: string;
  player2Name: string;
}

interface Room {
  state: RoomState;
  player1: Player1;
  player2: Player2 | null;
  spectators: string[];
  challenge: string | null;
  maxNumber: number;
  result: GameResult | null;
  createdAt: number;
}

interface ActiveRoom {
  roomCode: string;
  player1Name: string | null;
  challenge: string | null;
  maxNumber: number;
  createdAt: number;
}

const app = express();
const server = createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// API endpoint for game history
app.get('/api/history', (_req: Request, res: Response) => {
  const games = getRecentGames(50);
  res.json(games);
});

// In-memory room storage (rooms are ephemeral, only history persists)
const rooms = new Map<string, Room>();

// API endpoint for active rooms waiting for player 2
app.get('/api/rooms', (_req: Request, res: Response) => {
  const activeRooms: ActiveRoom[] = [];
  for (const [code, room] of rooms.entries()) {
    // Only show rooms that have a challenge set but no player 2 yet
    if (room.state === 'challenge_set' && !room.player2) {
      activeRooms.push({
        roomCode: code,
        player1Name: room.player1.name,
        challenge: room.challenge,
        maxNumber: room.maxNumber,
        createdAt: room.createdAt
      });
    }
  }
  // Sort by newest first
  activeRooms.sort((a, b) => b.createdAt - a.createdAt);
  res.json(activeRooms);
});

// Room states: 'waiting' | 'challenge_set' | 'completed'

io.on('connection', (baseSocket: Socket) => {
  const socket = baseSocket as GameSocket;
  console.log(`Client connected: ${socket.id}`);

  // Create a new room
  socket.on('create-room', (callback: (response: { success: boolean; roomCode?: string; sessionId?: string; error?: string }) => void) => {
    const roomCode = nanoid(6).toUpperCase();
    const sessionId = nanoid(16);
    rooms.set(roomCode, {
      state: 'waiting',
      player1: {
        socketId: socket.id,
        sessionId: sessionId,
        name: null,
        numberHash: null,
        salt: null,
        number: null
      },
      player2: null,
      spectators: [],
      challenge: null,
      maxNumber: 10,
      result: null,
      createdAt: Date.now()
    });
    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.playerRole = 'player1';
    socket.sessionId = sessionId;
    callback({ success: true, roomCode, sessionId });
    console.log(`Room created: ${roomCode}`);
  });

  // Rejoin a room with session ID
  socket.on('rejoin-room', ({ roomCode, sessionId }: { roomCode: string; sessionId: string }, callback: (response: any) => void) => {
    const code = roomCode.toUpperCase();
    const room = rooms.get(code);

    if (!room) {
      callback({ success: false, error: 'Room not found' });
      return;
    }

    // Check if this is player 1 rejoining
    if (room.player1.sessionId === sessionId) {
      room.player1.socketId = socket.id;
      socket.join(code);
      socket.roomCode = code;
      socket.playerRole = 'player1';
      socket.sessionId = sessionId;

      callback({
        success: true,
        role: 'player1',
        state: room.state,
        challenge: room.challenge,
        maxNumber: room.maxNumber,
        result: room.result,
        player2Name: room.player2?.name
      });
      console.log(`Player 1 rejoined room: ${code}`);
      return;
    }

    // Check if this is player 2 rejoining
    if (room.player2?.sessionId === sessionId) {
      room.player2.socketId = socket.id;
      socket.join(code);
      socket.roomCode = code;
      socket.playerRole = 'player2';
      socket.sessionId = sessionId;

      callback({
        success: true,
        role: 'player2',
        state: room.state,
        challenge: room.challenge,
        maxNumber: room.maxNumber,
        result: room.result,
        player1Name: room.player1.name
      });
      console.log(`Player 2 rejoined room: ${code}`);
      return;
    }

    callback({ success: false, error: 'Invalid session' });
  });

  // Join an existing room (as player 2 or spectator)
  socket.on('join-room', (roomCode: string, callback: (response: any) => void) => {
    const code = roomCode.toUpperCase();
    const room = rooms.get(code);

    if (!room) {
      callback({ success: false, error: 'Room not found' });
      return;
    }

    // Room is full - join as spectator
    if (room.player2) {
      socket.join(code);
      socket.roomCode = code;
      socket.playerRole = 'spectator';
      room.spectators.push(socket.id);

      callback({
        success: true,
        roomCode: code,
        role: 'spectator',
        state: room.state,
        challenge: room.challenge,
        maxNumber: room.maxNumber,
        player1Name: room.player1.name,
        player2Name: room.player2.name,
        result: room.result
      });
      console.log(`Spectator joined room: ${code}`);
      return;
    }

    if (room.state === 'completed') {
      // Join as spectator for completed games
      socket.join(code);
      socket.roomCode = code;
      socket.playerRole = 'spectator';
      room.spectators.push(socket.id);

      callback({
        success: true,
        roomCode: code,
        role: 'spectator',
        state: room.state,
        result: room.result
      });
      return;
    }

    const sessionId = nanoid(16);
    room.player2 = {
      socketId: socket.id,
      sessionId: sessionId,
      name: null,
      number: null
    };

    socket.join(code);
    socket.roomCode = code;
    socket.playerRole = 'player2';
    socket.sessionId = sessionId;

    callback({
      success: true,
      roomCode: code,
      role: 'player2',
      sessionId: sessionId,
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
  socket.on('set-name', (name: string, callback: (response: { success: boolean; error?: string }) => void) => {
    const room = socket.roomCode ? rooms.get(socket.roomCode) : undefined;
    if (!room) {
      callback({ success: false, error: 'Room not found' });
      return;
    }

    if (socket.playerRole === 'player1') {
      room.player1.name = name;
    } else if (socket.playerRole === 'player2' && room.player2) {
      room.player2.name = name;
      // Notify player 1 of player 2's name
      io.to(room.player1.socketId).emit('player2-named', name);
    }

    callback({ success: true });
  });

  // Player 1 submits challenge with commitment
  socket.on('submit-challenge', ({ challenge, maxNumber, numberHash }: { challenge: string; maxNumber: number; numberHash: string }, callback: (response: { success: boolean; error?: string }) => void) => {
    const room = socket.roomCode ? rooms.get(socket.roomCode) : undefined;
    if (!room || socket.playerRole !== 'player1') {
      callback({ success: false, error: 'Invalid operation' });
      return;
    }

    // Validate required fields
    if (!challenge || !numberHash) {
      callback({ success: false, error: 'Challenge and number are required' });
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
  socket.on('submit-guess', ({ number }: { number: number }, callback: (response: { success: boolean; error?: string }) => void) => {
    const room = socket.roomCode ? rooms.get(socket.roomCode) : undefined;
    if (!room || socket.playerRole !== 'player2' || !room.player2) {
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
  socket.on('reveal-number', ({ number, salt }: { number: number; salt: string }, callback: (response: { success: boolean; result?: GameResult; error?: string }) => void) => {
    const room = socket.roomCode ? rooms.get(socket.roomCode) : undefined;
    if (!room || socket.playerRole !== 'player1' || !room.player2) {
      callback({ success: false, error: 'Invalid operation' });
      return;
    }

    room.player1.number = number;
    room.player1.salt = salt;
    room.state = 'completed';

    const matched = room.player1.number === room.player2.number;

    // Save to history
    try {
      const gameData: GameData = {
        roomCode: socket.roomCode!,
        player1Name: room.player1.name || 'Player 1',
        player2Name: room.player2.name || 'Player 2',
        challenge: room.challenge || '',
        maxNumber: room.maxNumber,
        player1Number: room.player1.number,
        player2Number: room.player2.number!,
        matched
      };
      saveGame(gameData);
    } catch (err) {
      console.error('Failed to save game:', err);
    }

    const result: GameResult = {
      player1Number: number,
      player2Number: room.player2.number!,
      salt: salt,
      numberHash: room.player1.numberHash!,
      matched,
      challenge: room.challenge!,
      player1Name: room.player1.name || 'Player 1',
      player2Name: room.player2.name || 'Player 2'
    };

    // Store result for rejoins and spectators
    room.result = result;

    // Send result to both players and all spectators
    callback({ success: true, result });
    io.to(room.player2.socketId).emit('game-result', result);
    room.spectators.forEach(spectatorId => {
      io.to(spectatorId).emit('game-result', result);
    });

    console.log(`Game completed in room ${socket.roomCode}: ${matched ? 'MATCH!' : 'No match'}`);

    // Clean up room after a delay
    const roomCode = socket.roomCode;
    setTimeout(() => {
      if (roomCode) {
        rooms.delete(roomCode);
      }
    }, 300000); // Keep room for 5 minutes for reconnection
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    const room = socket.roomCode ? rooms.get(socket.roomCode) : undefined;
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
