const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'games.db');

// Ensure data directory exists
const fs = require('fs');
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

const getRecentGames = db.prepare(`
  SELECT * FROM games ORDER BY created_at DESC LIMIT ?
`);

module.exports = {
  saveGame: (gameData) => {
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
  },

  getRecentGames: (limit = 50) => {
    return getRecentGames.all(limit);
  }
};
