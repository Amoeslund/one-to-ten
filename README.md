# One to Ten

A real-time two-player guessing game with cryptographic fairness guarantees.

## How to Play

1. **Player 1** creates a room and shares the code/link with a friend
2. **Player 1** picks a secret number (1-10) and writes a challenge (e.g., "I down my beer")
3. **Player 2** joins, sees the challenge, and picks a number
4. If the numbers **match**, Player 1 must do the challenge!

## Why Can't the Server Cheat?

This game uses a **cryptographic commitment scheme** to ensure fair play:

1. When Player 1 picks their number, the app generates a random salt and creates a hash: `SHA-256(number + salt)`
2. Only this hash is sent to the server - the actual number stays in Player 1's browser
3. After Player 2 guesses, Player 1's browser reveals the number and salt
4. Both players can verify the hash matches, proving Player 1 didn't change their number

**The server never knows Player 1's number until after Player 2 has guessed.**

## Self-Hosting

### Using Docker (recommended)

```bash
docker run -d -p 3000:3000 -v one-to-ten-data:/app/data ghcr.io/amoeslund/one-to-ten:latest
```

### Using Docker Compose

```yaml
services:
  one-to-ten:
    image: ghcr.io/amoeslund/one-to-ten:latest
    ports:
      - "3000:3000"
    volumes:
      - game-data:/app/data
    restart: unless-stopped

volumes:
  game-data:
```

Then run:
```bash
docker compose up -d
```

### Building from Source

```bash
git clone https://github.com/Amoeslund/one-to-ten.git
cd one-to-ten
npm install
npm start
```

## Tech Stack

- **Backend**: Node.js, Express, Socket.io
- **Frontend**: Vanilla HTML/CSS/JS
- **Database**: SQLite (game history only)
- **Styling**: Neo-brutalism

## License

MIT
