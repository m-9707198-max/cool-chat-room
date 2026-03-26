const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, { maxHttpBufferSize: 10 * 1024 * 1024 });
const fs = require('fs');
const os = require('os');

const INVITE_CODE = "666";
const ADMIN_PASSWORD = "admin123";
const HISTORY_FILE = 'chat_history.json';
const USERS_FILE = 'users.json';
const BADGES_FILE = 'badges.json';

const getTodayStr = () => new Date().toDateString();
const getWeekStr = () => {
    let d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    return d.getFullYear() + '-W' + Math.ceil((((d - new Date(d.getFullYear(), 0, 1)) / 86400000) + 1) / 7);
};

const PRESET_MEDALS = {
    "👑 传奇王者": "medal-legend",
    "✨ 神话传说": "medal-mythic",
    "🐉 屠龙勇士": "medal-dragon",
    "🔥 不死凤凰": "medal-phoenix",
    "🌑 虚空行者": "medal-void",
    "⭐ 星辰使者": "medal-celestial",
    "👸 皇家贵族": "medal-royal",
    "🌙 暗影刺客": "medal-shadow",
    "⚡ 雷霆战神": "medal-thunder",
    "❄️ 冰霜女皇": "medal-ice",
    "🔥 烈焰魔王": "medal-flame",
    "🌿 自然守护": "medal-nature",
    "🌙 月神祝福": "medal-moon",
    "☀️ 太阳之子": "medal-sun",
    "⭐ 星光璀璨": "medal-star",
    "💚 霓虹未来": "medal-neon",
    "🩸 血族亲王": "medal-blood",
    "👻 幽灵鬼魅": "medal-ghost",
    "🤖 赛博朋克": "medal-cyber",
    "✨ 神圣天使": "medal-divine"
};

let usersDB = {};
if (fs.existsSync(USERS_FILE)) try { usersDB = JSON.parse(fs.readFileSync(USERS_FILE)); } catch(e){}
const saveUsers = () => fs.writeFileSync(USERS_FILE, JSON.stringify(usersDB));

let chatHistory = [];
if (fs.existsSync(HISTORY_FILE)) try { chatHistory = JSON.parse(fs.readFileSync(HISTORY_FILE)); } catch(e){}
const saveHistory = () => fs.writeFileSync(HISTORY_FILE, JSON.stringify(chatHistory));

let badgesDB = {};
if (fs.existsSync(BADGES_FILE)) try { badgesDB = JSON.parse(fs.readFileSync(BADGES_FILE)); } catch(e){}
for (let badge in PRESET_MEDALS) {
    if (!badgesDB[badge]) {
        badgesDB[badge] = { colorClass: PRESET_MEDALS[badge] };
    }
}
const saveBadges = () => fs.writeFileSync(BADGES_FILE, JSON.stringify(badgesDB));
saveBadges();

app.use(express.static('public'));
app.get('/', (req, res) => res.sendFile(__dirname + '/index.html'));

function getLeaderboards() {
    let usersArray = Object.keys(usersDB).map(name => ({ name, ...usersDB[name] }));
    let today = getTodayStr();
    let thisWeek = getWeekStr();
    let dailyBoard = usersArray.filter(u => u.stats.lastDay === today && u.stats.daily > 0).sort((a, b) => b.stats.daily - a.stats.daily);
    let weeklyBoard = usersArray.filter(u => u.stats.lastWeek === thisWeek && u.stats.weekly > 0).sort((a, b) => b.stats.weekly - a.stats.weekly);
    return { dailyBoard, weeklyBoard };
}

function cleanExpiredAuths() {
    let now = Date.now();
    for (let user in usersDB) {
        if (!usersDB[user].auths) usersDB[user].auths = [];
        usersDB[user].auths = usersDB[user].auths.filter(a => !a.expires || a.expires > now);
    }
    saveUsers();
}

function triggerSettle() {
    cleanExpiredAuths();
    let boards = getLeaderboards();
    let now = Date.now();
    let logs = [];

    if (boards.dailyBoard[0]) {
        let name = boards.dailyBoard[0].name;
        usersDB[name].auths.push({ text: "🔥 日榜冠军", colorClass: "medal-flame", expires: now + 86400000 });
        logs.push(`🥇 恭喜【${name}】夺得今日活跃榜冠军！`);
    }
    if (boards.weeklyBoard[0]) {
        let name = boards.weeklyBoard[0].name;
        usersDB[name].auths.push({ text: "👑 周榜王者", colorClass: "medal-royal", expires: now + 604800000 });
        logs.push(`👑 恭喜【${name}】夺得本周活跃榜冠军！`);
    }

    for (let name in usersDB) {
        usersDB[name].stats.daily = 0;
        usersDB[name].stats.lastDay = getTodayStr();
    }
    saveUsers();

    let msg = logs.length > 0 ? "📢 榜单结算完毕！\n" + logs.join("\n") : "📢 今日榜单结算完毕！";
    io.emit('announcement', msg);
    io.emit('system msg', msg);
}

function updateBadgeDirectory() {
    let directory = {};
    for (let name in usersDB) {
        if (usersDB[name].auths) {
            usersDB[name].auths.forEach(auth => {
                if (!directory[auth.text]) {
                    directory[auth.text] = { colorClass: auth.colorClass, count: 0, holders: [] };
                }
                directory[auth.text].count++;
                if (!directory[auth.text].holders.includes(name)) {
                    directory[auth.text].holders.push(name);
                }
            });
        }
    }
    return directory;
}

io.on('connection', (socket) => {
    socket.emit('announcement', "📢 欢迎来到炫酷聊天室！");

    socket.on('register', (data, cb) => {
        if (usersDB[data.user]) return cb({ status: 'fail', msg: '名字被注册啦！' });
        usersDB[data.user] = {
            pass: data.pass,
            avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${data.user}`,
            auths: [],
            coins: 100,
            bubble: "bubble-default",
            tail: "tail-default",
            frame: "",
            stats: { daily: 0, weekly: 0, lastDay: getTodayStr(), lastWeek: getWeekStr() }
        };
        saveUsers();
        cb({ status: 'ok', msg: '注册成功！' });
        io.emit('update users list', Object.keys(usersDB));
    });

    socket.on('login', (data, cb) => {
        cleanExpiredAuths();
        let userObj = usersDB[data.user];
        if (!userObj || userObj.pass !== data.pass) return cb({ status: 'fail', msg: '账号或密码错误！' });

        let isAdm = (data.inviteCode === ADMIN_PASSWORD);
        cb({ status: 'ok', isAdmin: isAdm, userData: userObj, history: chatHistory });
        if (isAdm) {
            io.emit('update users list', Object.keys(usersDB));
            io.emit('update badges list', Object.keys(badgesDB));
        }
    });

    socket.on('set user', (user) => { socket.user = user; });

    socket.on('change avatar', (data) => {
        if (usersDB[data.user]) {
            usersDB[data.user].avatar = data.avatarData;
            saveUsers();
        }
    });

    socket.on('change name', (data, cb) => {
        if (!usersDB[data.oldName]) return cb({ status: 'fail', msg: '用户不存在' });
        if (usersDB[data.newName]) return cb({ status: 'fail', msg: '昵称已被使用' });
        if (data.newName.length < 2 || data.newName.length > 12) return cb({ status: 'fail', msg: '昵称长度需2-12字符' });

        let userData = usersDB[data.oldName];
        delete usersDB[data.oldName];
        usersDB[data.newName] = userData;
        saveUsers();

        chatHistory.forEach(msg => { if (msg.user === data.oldName) msg.user = data.newName; });
        saveHistory();

        cb({ status: 'ok', msg: '改名成功' });
        io.emit('system msg', `📢 ${data.oldName} 改名为 ${data.newName}`);
        io.emit('update users list', Object.keys(usersDB));
    });

    socket.on('get users list', (cb) => { cb(Object.keys(usersDB)); });
    socket.on('get badges list', (cb) => { cb(Object.keys(badgesDB)); });

    socket.on('chat message', (data) => {
        if (usersDB[data.user]) {
            cleanExpiredAuths();
            let u = usersDB[data.user];
            let today = getTodayStr();
            let thisWeek = getWeekStr();

            if (u.stats.lastDay !== today) { u.stats.daily = 0; u.stats.lastDay = today; }
            if (u.stats.lastWeek !== thisWeek) { u.stats.weekly = 0; u.stats.lastWeek = thisWeek; }

            u.stats.daily++;
            u.stats.weekly++;
            saveUsers();

            let msgData = {
                id: Date.now() + "-" + Math.floor(Math.random() * 10000),
                user: data.user,
                type: data.type,
                content: data.content,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                avatar: u.avatar,
                auths: u.auths,
                bubble: data.bubble || u.bubble,
                tail: data.tail || u.tail,
                frame: u.frame
            };

            io.emit('chat message', msgData);
            chatHistory.push(msgData);
            if (chatHistory.length > 100) chatHistory.shift();
            saveHistory();
        }
    });

    // 管理员赠送金币
    socket.on('admin give coins', (data, cb) => {
        if (data.adminPass !== ADMIN_PASSWORD) return cb({ status: 'fail', msg: '权限不足' });
        if (!usersDB[data.targetUser]) return cb({ status: 'fail', msg: '用户不存在' });

        usersDB[data.targetUser].coins = (usersDB[data.targetUser].coins || 0) + data.amount;
        saveUsers();

        io.to(data.targetUser).emit('private notification', {
            title: '💰 金币赠送',
            message: `官方赠送您 ${data.amount} 金币，请查收！当前金币: ${usersDB[data.targetUser].coins}`,
            coins: usersDB[data.targetUser].coins
        });

        io.emit('system msg', `📢 管理员赠送了 ${data.amount} 金币给【${data.targetUser}】`);
        cb({ status: 'ok', msg: `已赠送 ${data.amount} 金币给 ${data.targetUser}` });
    });

    // 购买商品
    socket.on('buy item', (data, cb) => {
        if (!usersDB[data.user]) return cb({ status: 'fail', msg: '用户不存在' });

        let user = usersDB[data.user];
        if (user.coins < data.price) return cb({ status: 'fail', msg: '金币不足' });

        user.coins -= data.price;

        if (data.type === 'bubble') {
            user.bubble = data.itemId;
        } else if (data.type === 'tail') {
            user.tail = data.itemId;
        } else if (data.type === 'frame') {
            user.frame = data.itemId;
        }

        saveUsers();

        let itemNames = {
            "bubble-default": "默认气泡", "bubble-pink": "梦幻粉红", "bubble-blue": "天空之蓝",
            "bubble-purple": "神秘紫色", "bubble-gold": "黄金贵族", "bubble-rainbow": "彩虹流光",
            "bubble-dark": "暗夜星辰", "tail-default": "无尾灯", "tail-star": "星光闪耀",
            "tail-heart": "爱心飞舞", "tail-fire": "火焰之舞", "tail-crown": "皇冠加冕",
            "": "无边框", "frame-gold": "黄金边框", "frame-silver": "白银边框",
            "frame-rainbow": "彩虹边框", "frame-diamond": "钻石边框", "frame-flame": "烈焰边框"
        };
        let itemName = itemNames[data.itemId] || data.itemId;

        cb({ status: 'ok', newCoins: user.coins, itemName: itemName });
    });

    // 官方认证管理
    socket.on('admin create badge', (data) => {
        if (data.adminPass === ADMIN_PASSWORD) {
            badgesDB[data.name] = { colorClass: data.colorClass };
            saveBadges();
            io.emit('system msg', `📜 管理员创建了新认证：[${data.name}]`);
            io.emit('update badges list', Object.keys(badgesDB));
        }
    });

    socket.on('admin give auth', (data, cb) => {
        if (data.adminPass !== ADMIN_PASSWORD) return cb({ status: 'fail', msg: '权限不足' });
        if (!usersDB[data.targetUser]) return cb({ status: 'fail', msg: '用户不存在' });

        if (data.type === 'give') {
            if (!badgesDB[data.badgeName]) return cb({ status: 'fail', msg: '认证不存在' });
            usersDB[data.targetUser].auths.push({ text: data.badgeName, colorClass: badgesDB[data.badgeName].colorClass, expires: null });
            io.emit('system msg', `🎊 恭喜【${data.targetUser}】获得认证：[${data.badgeName}]`);
            cb({ status: 'ok', msg: `已发放认证` });
        } else if (data.type === 'remove') {
            usersDB[data.targetUser].auths = usersDB[data.targetUser].auths.filter(a => PRESET_MEDALS[a.text] ? true : false);
            io.emit('system msg', `📢 【${data.targetUser}】的认证已被清空`);
            cb({ status: 'ok', msg: `已清空认证` });
        }
        saveUsers();
    });

    // 炫酷徽章管理
    socket.on('admin give medal', (data, cb) => {
        if (data.adminPass !== ADMIN_PASSWORD) return cb({ status: 'fail', msg: '权限不足' });
        if (!usersDB[data.targetUser]) return cb({ status: 'fail', msg: '用户不存在' });

        if (data.type === 'give') {
            if (!PRESET_MEDALS[data.medalName]) return cb({ status: 'fail', msg: '徽章不存在' });
            usersDB[data.targetUser].auths.push({ text: data.medalName, colorClass: PRESET_MEDALS[data.medalName], expires: null });
            io.emit('system msg', `🎊 恭喜【${data.targetUser}】获得徽章：【${data.medalName}】`);
            cb({ status: 'ok', msg: `已发放徽章` });
        } else if (data.type === 'remove') {
            let before = usersDB[data.targetUser].auths.length;
            usersDB[data.targetUser].auths = usersDB[data.targetUser].auths.filter(a => a.text !== data.medalName);
            if (before > usersDB[data.targetUser].auths.length) {
                saveUsers();
                io.emit('system msg', `📢 收回了【${data.targetUser}】的徽章：【${data.medalName}】`);
                cb({ status: 'ok', msg: `已收回徽章` });
            } else {
                cb({ status: 'fail', msg: `用户没有此徽章` });
            }
        } else if (data.type === 'clear') {
            usersDB[data.targetUser].auths = usersDB[data.targetUser].auths.filter(a => badgesDB[a.text] ? true : false);
            saveUsers();
            io.emit('system msg', `📢 清空了【${data.targetUser}】的所有炫酷徽章`);
            cb({ status: 'ok', msg: `已清空徽章` });
        }
        saveUsers();
    });

    socket.on('admin delete message', (data) => {
        if (data.adminPass === ADMIN_PASSWORD) {
            chatHistory = chatHistory.filter(m => m.id !== data.msgId);
            saveHistory();
            io.emit('delete message', data.msgId);
        }
    });

    socket.on('admin clear messages', (data) => {
        if (data.adminPass === ADMIN_PASSWORD) {
            chatHistory = [];
            saveHistory();
            io.emit('system msg', '📢 管理员清空了所有聊天记录');
        }
    });

    socket.on('admin trigger settle', (data) => {
        if (data.adminPass === ADMIN_PASSWORD) triggerSettle();
    });

    socket.on('get data panels', (cb) => {
        cleanExpiredAuths();
        let boards = getLeaderboards();
        let badgeDirectory = updateBadgeDirectory();
        
        let richBoard = Object.keys(usersDB).map(name => ({
            name: name,
            avatar: usersDB[name].avatar,
            coins: usersDB[name].coins || 0
        })).sort((a, b) => b.coins - a.coins).slice(0, 20);
        
        cb({ boards, stats: { badgeDirectory }, richBoard });
    });
});

function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (let devName in interfaces) {
        for (let i = 0; i < interfaces[devName].length; i++) {
            let alias = interfaces[devName][i];
            if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) return alias.address;
        }
    }
    return '127.0.0.1';
}

const PORT = 3000;
http.listen(PORT, "0.0.0.0", () => {
    console.log(`\n✨ 炫酷聊天室已启动！`);
    console.log(`📱 访问地址: http://${getLocalIP()}:${PORT}`);
    console.log(`🔑 管理员密码: ${ADMIN_PASSWORD}`);
    console.log(`💰 新用户赠送100金币！`);
    console.log(`🎖️ 预设了20个炫酷徽章！`);
});