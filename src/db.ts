import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export interface GameData {
  roomCode: string;
  player1Name: string;
  player2Name: string;
  challenge: string;
  maxNumber: number;
  player1Number: number;
  player2Number: number;
  matched: boolean;
}

export interface GameRecord {
  id: number;
  room_code: string;
  player1_name: string;
  player2_name: string;
  challenge: string;
  max_number: number;
  player1_number: number;
  player2_number: number;
  matched: number;
  created_at: string;
}

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'games.db');

// Ensure data directory exists
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);

// Initialize the database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_code TEXT NOT NULL,
    player1_name TEXT NOT NULL,
    player2_name TEXT NOT NULL,
    challenge TEXT NOT NULL,
    max_number INTEGER NOT NULL DEFAULT 10,
    player1_number INTEGER NOT NULL,
    player2_number INTEGER NOT NULL,
    matched INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Prepared statements for better performance
const insertGame = db.prepare(`
  INSERT INTO games (room_code, player1_name, player2_name, challenge, max_number, player1_number, player2_number, matched)
  VALUES (@roomCode, @player1Name, @player2Name, @challenge, @maxNumber, @player1Number, @player2Number, @matched)
`);

const getRecentGamesStmt = db.prepare(`
  SELECT * FROM games ORDER BY created_at DESC LIMIT ?
`);

export function saveGame(gameData: GameData): Database.RunResult {
  return insertGame.run({
    roomCode: gameData.roomCode,
    player1Name: gameData.player1Name,
    player2Name: gameData.player2Name,
    challenge: gameData.challenge,
    maxNumber: gameData.maxNumber,
    player1Number: gameData.player1Number,
    player2Number: gameData.player2Number,
    matched: gameData.matched ? 1 : 0
  });
}

export function getRecentGames(limit: number = 50): GameRecord[] {
  return getRecentGamesStmt.all(limit) as GameRecord[];
}
