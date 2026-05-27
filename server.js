const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcryptjs');
const { Low, JSONFile } = require('lowdb');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));
app.use(express.json());

// --- Database (Lowdb JSON) ---
const dataPath = process.env.RENDER_VOLUME_PATH || './data';
const dbFile = path.join(dataPath, 'db.json');

// Buat folder data jika belum ada
if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dataPath, { recursive: true });
}

// Inisialisasi Lowdb
const adapter = new JSONFile(dbFile);
const db = new Low(adapter);

// Inisialisasi data default
async function initDB() {
    await db.read();
    db.data = db.data || { users: [] };
    
    // Cek apakah admin sudah ada
    const adminExists = db.data.users.find(u => u.username === 'admin');
    if (!adminExists) {
        const hashedPassword = bcrypt.hashSync('admin123', 10);
        db.data.users.push({
            id: 'admin',
            username: 'admin',
            password: hashedPassword,
            name: 'Administrator',
            phone_wa: '',
            email: '',
            bank_name: '',
            bank_number: '',
            balance: 999999,
            isAdmin: true
        });
        await db.write();
        console.log('✅ Admin account created');
    }
    console.log('✅ Database ready at:', dbFile);
}
initDB();

// --- Deck Logic ---
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

// --- 100 Tables (In-Memory) ---
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
    // Add Bot to each table
    tables[i].players.push({
        id: tables[i].botId,
        name: '🤖 Bot Bandar',
        chips: 999999,
        hand: [],
        isBot: true,
        tableId: i
    });
}

// --- Helper: Find User ---
async function findUserById(id) {
    await db.read();
    return db.data.users.find(u => u.id === id);
}

async function findUserByUsername(username) {
    await db.read();
    return db.data.users.find(u => u.username === username);
}

// --- API Routes ---

app.post('/api/register', async (req, res) => {
    const { username, password, confirm_password, name, phone_wa, email, bank_name, bank_number } = req.body;
    
    if (!username || !password || !confirm_password || !name || !phone_wa || !email || !bank_name || !bank_number) {
        return res.status(400).json({ error: 'Semua field harus diisi' });
    }
    if (password !== confirm_password) {
        return res.status(400).json({ error: 'Password tidak cocok' });
    }

    await db.read();
    if (db.data.users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'Username sudah digunakan' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const newUser = {
        id: 'user_' + uuidv4(),
        username,
        password: hashedPassword,
        name,
        phone_wa,
        email,
        bank_name,
        bank_number,
        balance: 10000,
        isAdmin: false
    };
    db.data.users.push(newUser);
    await db.write();

    res.json({
        success: true,
        user: {
            id: newUser.id,
            username: newUser.username,
            name: newUser.name,
            phone_wa: newUser.phone_wa,
            email: newUser.email,
            bank_name: newUser.bank_name,
            bank_number: newUser.bank_number,
            balance: newUser.balance,
            isAdmin: newUser.isAdmin
        }
    });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    await db.read();
    const user = db.data.users.find(u => u.username === username);
    if (!user || !bcrypt.compareSync(password, user.password)) {
        return res.status(401).json({ error: 'Username/password salah' });
    }
    res.json({
        success: true,
        user: {
            id: user.id,
            username: user.username,
            name: user.name,
            phone_wa: user.phone_wa,
            email: user.email,
            bank_name: user.bank_name,
            bank_number: user.bank_number,
            balance: user.balance,
            isAdmin: user.isAdmin
        }
    });
});

app.post('/api/profile', async (req, res) => {
    const { userId, name, phone_wa, email, bank_name, bank_number } = req.body;
    await db.read();
    const userIndex = db.data.users.findIndex(u => u.id === userId);
    if (userIndex === -1) return res.status(404).json({ error: 'User not found' });
    
    db.data.users[userIndex].name = name || db.data.users[userIndex].name;
    db.data.users[userIndex].phone_wa = phone_wa || db.data.users[userIndex].phone_wa;
    db.data.users[userIndex].email = email || db.data.users[userIndex].email;
    db.data.users[userIndex].bank_name = bank_name || db.data.users[userIndex].bank_name;
    db.data.users[userIndex].bank_number = bank_number || db.data.users[userIndex].bank_number;
    await db.write();

    const user = db.data.users[userIndex];
    res.json({
        success: true,
        user: {
            id: user.id,
            username: user.username,
            name: user.name,
            phone_wa: user.phone_wa,
            email: user.email,
            bank_name: user.bank_name,
            bank_number: user.bank_number,
            balance: user.balance,
            isAdmin: user.isAdmin
        }
    });
});

// Admin Routes
app.get('/api/admin/users', async (req, res) => {
    await db.read();
    const userList = db.data.users.map(u => ({
        id: u.id,
        username: u.username,
        name: u.name,
        phone_wa: u.phone_wa,
        email: u.email,
        bank_name: u.bank_name,
        bank_number: u.bank_number,
        balance: u.balance,
        isAdmin: u.isAdmin
    }));
    res.json(userList);
});

app.post('/api/admin/update-balance', async (req, res) => {
    const { userId, amount } = req.body;
    await db.read();
    const userIndex = db.data.users.findIndex(u => u.id === userId);
    if (userIndex === -1) return res.status(404).json({ error: 'User not found' });
    db.data.users[userIndex].balance = amount;
    await db.write();
    res.json({ success: true });
});

app.post('/api/admin/delete-user', async (req, res) => {
    const { userId } = req.body;
    await db.read();
    db.data.users = db.data.users.filter(u => u.id !== userId);
    await db.write();
    res.json({ success: true });
});

// --- Socket.IO (Game Logic) ---
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
        
        findUserById(userId).then(user => {
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
        
        findUserById(userId).then(user => {
            if (!user || user.balance < table.stake) {
                socket.emit('error', 'Saldo tidak cukup');
                return;
            }
            // Deduct balance
            const newBalance = user.balance - table.stake;
            db.read().then(() => {
                const userIndex = db.data.users.findIndex(u => u.id === userId);
                if (userIndex !== -1) {
                    db.data.users[userIndex].balance = newBalance;
                    db.write();
                }
            });
            const player = table.players.find(p => p.id === userId);
            if (player) player.chips = newBalance;
            
            // Reset hands
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
            // Update balances in DB
            db.read().then(() => {
                for (let p of table.players) {
                    if (!p.isBot) {
                        const idx = db.data.users.findIndex(u => u.id === p.id);
                        if (idx !== -1) {
                            db.data.users[idx].balance = p.chips;
                        }
                    }
                }
                db.write();
            });
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
            tables[key].players = tables[key].players.filter(p => p.id !== socket.id);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log('👑 Admin: admin / admin123');
});
