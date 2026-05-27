const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));
app.use(express.json());

// --- Database (SQLite) ---
// Jika Render, data akan disimpan di volume mount '/data'
const dataPath = process.env.RENDER_VOLUME_PATH || './data';
const dbPath = path.join(dataPath, 'db.sqlite');

// Pastikan folder 'data' ada
const fs = require('fs');
if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dataPath, { recursive: true });
}

const db = new sqlite3.Database(dbPath);

// Create tables
db.run(`
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE,
        password TEXT,
        name TEXT,
        phone_wa TEXT,
        email TEXT,
        bank_name TEXT,
        bank_number TEXT,
        balance INTEGER,
        isAdmin INTEGER DEFAULT 0
    )
`);

// Create admin user if not exists
db.get("SELECT * FROM users WHERE username = 'admin'", (err, row) => {
    if (!row) {
        const hashedPassword = bcrypt.hashSync('admin123', 10);
        db.run(`
            INSERT INTO users (id, username, password, name, phone_wa, email, bank_name, bank_number, balance, isAdmin)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, ['admin', 'admin', hashedPassword, 'Administrator', '', '', '', '', 999999, 1]);
        console.log('✅ Admin account created');
    }
});

console.log('✅ SQLite database connected at:', dbPath);

// --- Helper Functions (Deck & Card Logic) ---
class Deck {
    constructor() {
        this.cards = [];
        for (let rank = 1; rank <= 13; rank++) {
            this.cards.push({ rank });
        }
        this.cards = [...this.cards, ...this.cards, ...this.cards, ...this.cards];
    }
    shuffle() {
        for (let i = this.cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
        }
    }
}

function getCardValue(rank) {
    if (rank === 1) return 1;
    if (rank >= 10) return 10;
    return rank;
}

function calculateValue(hand) {
    let sum = hand.reduce((total, card) => total + getCardValue(card.rank), 0);
    return sum % 10;
}

// --- 100 Tables in memory ---
let tables = {};
for (let i = 1; i <= 100; i++) {
    const stake = i <= 20 ? 1000 : (i <= 50 ? 5000 : (i <= 80 ? 10000 : 50000));
    tables[i] = {
        id: i,
        stake: stake,
        players: [],
        botId: `bot_${i}`,
        deck: null,
        status: 'waiting',
        maxPlayers: 8
    };
    // Add Bot
    tables[i].players.push({
        id: tables[i].botId,
        name: '🤖 Bot Bandar',
        chips: 999999,
        hand: [],
        isBot: true,
        tableId: i
    });
}

// --- API Routes (SQLite) ---

app.post('/api/register', (req, res) => {
    const { username, password, confirm_password, name, phone_wa, email, bank_name, bank_number } = req.body;
    if (!username || !password || !confirm_password || !name || !phone_wa || !email || !bank_name || !bank_number) {
        return res.status(400).json({ error: 'Semua field harus diisi' });
    }
    if (password !== confirm_password) {
        return res.status(400).json({ error: 'Password tidak cocok' });
    }
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, row) => {
        if (row) {
            return res.status(400).json({ error: 'Username sudah digunakan' });
        }
        const hashedPassword = bcrypt.hashSync(password, 10);
        const id = 'user_' + Date.now();
        db.run(`
            INSERT INTO users (id, username, password, name, phone_wa, email, bank_name, bank_number, balance, isAdmin)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [id, username, hashedPassword, name, phone_wa, email, bank_name, bank_number, 10000, 0], (err) => {
            if (err) {
                return res.status(500).json({ error: 'Gagal mendaftar: ' + err.message });
            }
            res.json({
                success: true,
                user: { id, username, name, phone_wa, email, bank_name, bank_number, balance: 10000, isAdmin: false }
            });
        });
    });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, row) => {
        if (!row) return res.status(401).json({ error: 'Username/password salah' });
        if (!bcrypt.compareSync(password, row.password)) return res.status(401).json({ error: 'Username/password salah' });
        res.json({
            success: true,
            user: {
                id: row.id,
                username: row.username,
                name: row.name,
                phone_wa: row.phone_wa,
                email: row.email,
                bank_name: row.bank_name,
                bank_number: row.bank_number,
                balance: row.balance,
                isAdmin: row.isAdmin === 1
            }
        });
    });
});

app.post('/api/profile', (req, res) => {
    const { userId, name, phone_wa, email, bank_name, bank_number } = req.body;
    db.run(`
        UPDATE users SET name = ?, phone_wa = ?, email = ?, bank_name = ?, bank_number = ? WHERE id = ?
    `, [name, phone_wa, email, bank_name, bank_number, userId], (err) => {
        if (err) return res.status(500).json({ error: 'Gagal update profil' });
        db.get("SELECT * FROM users WHERE id = ?", [userId], (err, row) => {
            res.json({
                success: true,
                user: {
                    id: row.id,
                    username: row.username,
                    name: row.name,
                    phone_wa: row.phone_wa,
                    email: row.email,
                    bank_name: row.bank_name,
                    bank_number: row.bank_number,
                    balance: row.balance,
                    isAdmin: row.isAdmin === 1
                }
            });
        });
    });
});

// Admin routes (SQLite)
app.get('/api/admin/users', (req, res) => {
    db.all("SELECT id, username, name, phone_wa, email, bank_name, bank_number, balance, isAdmin FROM users", [], (err, rows) => {
        res.json(rows);
    });
});

app.post('/api/admin/update-balance', (req, res) => {
    const { userId, amount } = req.body;
    db.run("UPDATE users SET balance = ? WHERE id = ?", [amount, userId], (err) => {
        res.json({ success: true });
    });
});

app.post('/api/admin/delete-user', (req, res) => {
    const { userId } = req.body;
    db.run("DELETE FROM users WHERE id = ?", [userId], (err) => {
        res.json({ success: true });
    });
});

// --- Socket.IO (Game Logic - unchanged from before) ---
// [Saya tidak mengubah logika game dari kode sebelumnya untuk menghemat panjang]
// Silakan gunakan logika game dari kode sebelumnya di sini
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    socket.on('requestTables', () => {
        const tableList = Object.values(tables).map(t => ({
            id: t.id,
            stake: t.stake,
            playerCount: t.players.length,
            status: t.status,
            maxPlayers: t.maxPlayers
        }));
        socket.emit('tableList', tableList);
    });

    socket.on('joinTable', (data) => {
        const { tableId, userId } = data;
        const table = tables[tableId];
        if (!table) return;
        if (table.players.length >= table.maxPlayers) {
            socket.emit('error', 'Meja penuh');
            return;
        }
        db.get("SELECT * FROM users WHERE id = ?", [userId], (err, user) => {
            if (!user) return;
            const newPlayer = {
                id: userId,
                name: user.name,
                chips: user.balance,
                hand: [],
                isBot: false,
                tableId: tableId,
                username: user.username
            };
            table.players.push(newPlayer);
            socket.join(`table_${tableId}`);
            io.to(`table_${tableId}`).emit('updateTable', {
                players: table.players.map(p => ({
                    id: p.id,
                    name: p.name,
                    chips: p.chips,
                    hand: p.hand,
                    isBot: p.isBot
                })),
                stake: table.stake,
                status: table.status
            });
            io.emit('tableList', Object.values(tables).map(t => ({
                id: t.id,
                stake: t.stake,
                playerCount: t.players.length,
                status: t.status,
                maxPlayers: t.maxPlayers
            })));
        });
    });

    socket.on('leaveTable', (data) => {
        const { tableId, userId } = data;
        const table = tables[tableId];
        if (!table) return;
        table.players = table.players.filter(p => p.id !== userId);
        io.to(`table_${tableId}`).emit('updateTable', {
            players: table.players.map(p => ({
                id: p.id,
                name: p.name,
                chips: p.chips,
                hand: p.hand,
                isBot: p.isBot
            })),
            stake: table.stake,
            status: table.status
        });
        io.emit('tableList', Object.values(tables).map(t => ({
            id: t.id,
            stake: t.stake,
            playerCount: t.players.length,
            status: t.status,
            maxPlayers: t.maxPlayers
        })));
    });

    socket.on('dealCards', (data) => {
        const { tableId, userId } = data;
        const table = tables[tableId];
        if (!table || table.status !== 'waiting') return;
        db.get("SELECT * FROM users WHERE id = ?", [userId], (err, user) => {
            if (!user) return;
            if (user.balance < table.stake) {
                socket.emit('error', 'Saldo tidak cukup');
                return;
            }
            const newBalance = user.balance - table.stake;
            db.run("UPDATE users SET balance = ? WHERE id = ?", [newBalance, userId]);
            const player = table.players.find(p => p.id === userId);
            if (player) player.chips = newBalance;
            for (let p of table.players) p.hand = [];
            table.deck = new Deck();
            table.deck.shuffle();
            for (let p of table.players) {
                p.hand.push(table.deck.cards.pop());
                p.hand.push(table.deck.cards.pop());
            }
            const bandar = table.players.find(p => p.isBot);
            const bandarVal = calculateValue(bandar.hand);
            let results = [];
            for (let p of table.players) {
                if (p.isBot) continue;
                const val = calculateValue(p.hand);
                if (val > bandarVal) {
                    results.push({ id: p.id, status: 'Win', amount: table.stake * 2 });
                    p.chips += table.stake * 2;
                } else if (val < bandarVal) {
                    results.push({ id: p.id, status: 'Lose', amount: 0 });
                } else {
                    results.push({ id: p.id, status: 'Tie', amount: table.stake });
                    p.chips += table.stake;
                }
            }
            for (let p of table.players) {
                if (!p.isBot) {
                    db.run("UPDATE users SET balance = ? WHERE id = ?", [p.chips, p.id]);
                }
            }
            table.status = 'playing';
            io.to(`table_${tableId}`).emit('gameResult', {
                players: table.players.map(p => ({
                    id: p.id,
                    name: p.name,
                    chips: p.chips,
                    hand: p.hand,
                    isBot: p.isBot
                })),
                results: results,
                bandarVal: bandarVal
            });
            setTimeout(() => {
                table.status = 'waiting';
                for (let p of table.players) p.hand = [];
                io.to(`table_${tableId}`).emit('updateTable', {
                    players: table.players.map(p => ({
                        id: p.id,
                        name: p.name,
                        chips: p.chips,
                        hand: p.hand,
                        isBot: p.isBot
                    })),
                    stake: table.stake,
                    status: 'waiting'
                });
                io.emit('tableList', Object.values(tables).map(t => ({
                    id: t.id,
                    stake: t.stake,
                    playerCount: t.players.length,
                    status: t.status,
                    maxPlayers: t.maxPlayers
                })));
            }, 8000);
        });
    });

    socket.on('disconnect', () => {
        for (let key in tables) {
            const table = tables[key];
            table.players = table.players.filter(p => p.id !== socket.id);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log('👑 Admin: admin / admin123');
});
