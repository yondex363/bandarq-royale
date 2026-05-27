require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.static('public'));
app.use(express.json());

// --- Koneksi MongoDB ---
const MONGODB_URI = process.env.MONGODB_URI;

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB error:', err));

// --- Schema User (Tambahkan field avatar) ---
const userSchema = new mongoose.Schema({
  id: String,
  username: { type: String, unique: true },
  password: String,
  name: String,
  phone_wa: String,
  email: String,
  bank_name: String,
  bank_number: String,
  balance: Number,
  isAdmin: Boolean,
  avatar: { type: String, default: 'https://ui-avatars.com/api/?name=User&background=random' }
});
const User = mongoose.model('User', userSchema);

// --- Buat admin jika belum ada ---
(async () => {
  const admin = await User.findOne({ username: 'admin' });
  if (!admin) {
    const hashedPassword = bcrypt.hashSync('admin123', 10);
    const newAdmin = new User({
      id: 'admin',
      username: 'admin',
      password: hashedPassword,
      name: 'Administrator',
      phone_wa: '',
      email: '',
      bank_name: '',
      bank_number: '',
      balance: 999999,
      isAdmin: true,
      avatar: 'https://ui-avatars.com/api/?name=Admin&background=ffc107&color=000'
    });
    await newAdmin.save();
    console.log('✅ Admin account created');
  }
})();

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

// --- 100 Tables ---
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
  tables[i].players.push({
    id: tables[i].botId,
    name: '🤖 Bot Bandar',
    chips: 999999,
    hand: [],
    isBot: true,
    tableId: i
  });
}

// --- API Routes ---

// Register
app.post('/api/register', async (req, res) => {
  const { username, password, confirm_password, name, phone_wa, email, bank_name, bank_number } = req.body;
  if (!username || !password || !confirm_password || !name || !phone_wa || !email || !bank_name || !bank_number) {
    return res.status(400).json({ error: 'Semua field harus diisi' });
  }
  if (password !== confirm_password) {
    return res.status(400).json({ error: 'Password tidak cocok' });
  }

  const existing = await User.findOne({ username });
  if (existing) return res.status(400).json({ error: 'Username sudah digunakan' });

  const hashedPassword = bcrypt.hashSync(password, 10);
  const newUser = new User({
    id: 'user_' + Date.now(),
    username,
    password: hashedPassword,
    name,
    phone_wa,
    email,
    bank_name,
    bank_number,
    balance: 10000,
    isAdmin: false,
    avatar: `https://ui-avatars.com/api/?name=${name}&background=random`
  });
  await newUser.save();

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
      isAdmin: newUser.isAdmin,
      avatar: newUser.avatar
    }
  });
});

// Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
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
      isAdmin: user.isAdmin,
      avatar: user.avatar
    }
  });
});

// Update Profile (Termasuk Avatar)
app.post('/api/profile', async (req, res) => {
  const { userId, name, phone_wa, email, bank_name, bank_number, avatar } = req.body;
  await User.updateOne(
    { id: userId },
    { $set: { name, phone_wa, email, bank_name, bank_number, avatar } }
  );
  const user = await User.findOne({ id: userId });
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
      isAdmin: user.isAdmin,
      avatar: user.avatar
    }
  });
});

// Admin routes
app.get('/api/admin/users', async (req, res) => {
  const users = await User.find({}, { password: 0 });
  res.json(users);
});

app.post('/api/admin/update-balance', async (req, res) => {
  const { userId, amount } = req.body;
  await User.updateOne({ id: userId }, { $set: { balance: amount } });
  res.json({ success: true });
});

app.post('/api/admin/delete-user', async (req, res) => {
  const { userId } = req.body;
  await User.deleteOne({ id: userId });
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
    if (!table || table.players.length >= table.maxPlayers) {
      return socket.emit('error', 'Meja penuh');
    }
    User.findOne({ id: userId }).then(user => {
      if (!user) return;
      const newPlayer = {
        id: userId,
        name: user.name,
        chips: user.balance,
        hand: [],
        isBot: false,
        tableId: tableId,
        username: user.username,
        avatar: user.avatar
      };
      table.players.push(newPlayer);
      socket.join(`table_${tableId}`);
      io.to(`table_${tableId}`).emit('updateTable', {
        players: table.players.map(p => ({
          id: p.id,
          name: p.name,
          chips: p.chips,
          hand: p.hand,
          isBot: p.isBot,
          avatar: p.avatar
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
    io.to(`table_${tableId}`).emit('updateTable', { players: table.players.map(p => ({ id: p.id, name: p.name, chips: p.chips, hand: p.hand, isBot: p.isBot, avatar: p.avatar })), stake: table.stake, status: table.status });
    io.emit('tableList', Object.values(tables).map(t => ({ id: t.id, stake: t.stake, playerCount: t.players.length, status: t.status, maxPlayers: t.maxPlayers })));
  });

  socket.on('dealCards', (data) => {
    const { tableId, userId } = data;
    const table = tables[tableId];
    if (!table || table.status !== 'waiting') return;
    User.findOne({ id: userId }).then(user => {
      if (!user || user.balance < table.stake) return socket.emit('error', 'Saldo tidak cukup');
      const newBalance = user.balance - table.stake;
      User.updateOne({ id: userId }, { $set: { balance: newBalance } }).then(() => {
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
        const updates = table.players.filter(p => !p.isBot).map(p => 
          User.updateOne({ id: p.id }, { $set: { balance: p.chips } })
        );
        Promise.all(updates).then(() => {
          table.status = 'playing';
          io.to(`table_${tableId}`).emit('gameResult', {
            players: table.players.map(p => ({ id: p.id, name: p.name, chips: p.chips, hand: p.hand, isBot: p.isBot, avatar: p.avatar })),
            results: results,
            bandarVal: bandarVal
          });
          setTimeout(() => {
            table.status = 'waiting';
            for (let p of table.players) p.hand = [];
            io.to(`table_${tableId}`).emit('updateTable', {
              players: table.players.map(p => ({ id: p.id, name: p.name, chips: p.chips, hand: p.hand, isBot: p.isBot, avatar: p.avatar })),
              stake: table.stake,
              status: 'waiting'
            });
            io.emit('tableList', Object.values(tables).map(t => ({ id: t.id, stake: t.stake, playerCount: t.players.length, status: t.status, maxPlayers: t.maxPlayers })));
          }, 8000);
        });
      });
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
