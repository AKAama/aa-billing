const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'data.db');
const db = new sqlite3.Database(dbPath);

// 初始化数据库
function initDatabase() {
    db.serialize(() => {
        // 创建账单表
        db.run(`
            CREATE TABLE IF NOT EXISTS bills (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                description TEXT NOT NULL,
                amount REAL NOT NULL,
                payer INTEGER NOT NULL,
                participants TEXT NOT NULL, -- 存储userId数组的JSON字符串
                per_person REAL NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 创建图片表
        db.run(`
            CREATE TABLE IF NOT EXISTS bill_images (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bill_id INTEGER NOT NULL,
                filename TEXT NOT NULL,
                original_name TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (bill_id) REFERENCES bills (id) ON DELETE CASCADE
            )
        `);

        // 创建评论表
        db.run(`
            CREATE TABLE IF NOT EXISTS bill_comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bill_id INTEGER NOT NULL,
                commenter INTEGER NOT NULL, -- userId
                content TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (bill_id) REFERENCES bills (id) ON DELETE CASCADE
            )
        `);

        // 创建账单确认状态表
        db.run(`
            CREATE TABLE IF NOT EXISTS bill_approvals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bill_id INTEGER NOT NULL,
                participant INTEGER NOT NULL, -- userId
                approved_by INTEGER NOT NULL, -- userId
                approved_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (bill_id) REFERENCES bills (id) ON DELETE CASCADE,
                UNIQUE(bill_id, participant)
            )
        `);

        // 创建用户表
        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                display_name TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 删除旧的participants表（如果存在）
        db.run('DROP TABLE IF EXISTS participants');
    });
}

// 添加账单
function addBill(description, amount, payerId, participantIds) {
    return new Promise((resolve, reject) => {
        const participantsJson = JSON.stringify(participantIds);
        const perPerson = amount / participantIds.length;
        db.run(
            'INSERT INTO bills (description, amount, payer, participants, per_person) VALUES (?, ?, ?, ?, ?)',
            [description, amount, payerId, participantsJson, perPerson],
            function (err) {
                if (err) reject(err);
                else resolve(this.lastID);
            }
        );
    });
}

// 获取所有账单
function getBills() {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM bills ORDER BY created_at DESC', async (err, rows) => {
            if (err) reject(err);
            else {
                // 获取所有用户信息
                db.all('SELECT id, display_name FROM users', (err, users) => {
                    if (err) reject(err);
                    else {
                        const userMap = {};
                        users.forEach(u => userMap[u.id] = u.display_name);
                        const bills = rows.map(row => {
                            const participantIds = JSON.parse(row.participants);
                            return {
                                ...row,
                                payer: row.payer,
                                payerName: userMap[row.payer] || row.payer,
                                participants: participantIds,
                                participantNames: participantIds.map(id => userMap[id] || id)
                            };
                        });
                        resolve(bills);
                    }
                });
            }
        });
    });
}

// 删除账单
function deleteBill(id) {
    return new Promise((resolve, reject) => {
        db.run('DELETE FROM bills WHERE id = ?', [id], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

// 添加图片
function addBillImage(billId, filename, originalName) {
    return new Promise((resolve, reject) => {
        db.run(
            'INSERT INTO bill_images (bill_id, filename, original_name) VALUES (?, ?, ?)',
            [billId, filename, originalName],
            function (err) {
                if (err) reject(err);
                else resolve(this.lastID);
            }
        );
    });
}

// 获取账单的图片
function getBillImages(billId) {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM bill_images WHERE bill_id = ? ORDER BY created_at', [billId], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// 删除图片
function deleteBillImage(imageId) {
    return new Promise((resolve, reject) => {
        db.run('DELETE FROM bill_images WHERE id = ?', [imageId], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

// 添加评论
function addBillComment(billId, commenter, content) {
    return new Promise((resolve, reject) => {
        db.run(
            'INSERT INTO bill_comments (bill_id, commenter, content) VALUES (?, ?, ?)',
            [billId, commenter, content],
            function (err) {
                if (err) reject(err);
                else resolve(this.lastID);
            }
        );
    });
}

// 获取账单评论
function getBillComments(billId) {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM bill_comments WHERE bill_id = ? ORDER BY created_at DESC', [billId], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// 删除评论
function deleteBillComment(commentId) {
    return new Promise((resolve, reject) => {
        db.run('DELETE FROM bill_comments WHERE id = ?', [commentId], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

// 确认账单参与者
function approveBillParticipant(billId, participant, approvedBy) {
    return new Promise((resolve, reject) => {
        db.run(
            'INSERT OR REPLACE INTO bill_approvals (bill_id, participant, approved_by) VALUES (?, ?, ?)',
            [billId, participant, approvedBy],
            function (err) {
                if (err) reject(err);
                else resolve(this.lastID);
            }
        );
    });
}

// 取消确认账单参与者
function unapproveBillParticipant(billId, participant) {
    return new Promise((resolve, reject) => {
        db.run('DELETE FROM bill_approvals WHERE bill_id = ? AND participant = ?', [billId, participant], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

// 获取账单确认状态
function getBillApprovals(billId) {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM bill_approvals WHERE bill_id = ?', [billId], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// 检查账单是否完全确认
function isBillFullyApproved(billId, participants) {
    return new Promise((resolve, reject) => {
        db.all('SELECT participant FROM bill_approvals WHERE bill_id = ?', [billId], (err, rows) => {
            if (err) reject(err);
            else {
                const approvedParticipants = rows.map(row => row.participant);
                const isFullyApproved = participants.every(participant =>
                    approvedParticipants.includes(participant)
                );
                resolve(isFullyApproved);
            }
        });
    });
}

// 用户相关函数
function createUser(username, password, displayName) {
    return new Promise((resolve, reject) => {
        db.run(
            'INSERT INTO users (username, password, display_name) VALUES (?, ?, ?)',
            [username, password, displayName],
            function (err) {
                if (err) reject(err);
                else resolve(this.lastID);
            }
        );
    });
}

function getUserByUsername(username) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function getAllUsers() {
    return new Promise((resolve, reject) => {
        db.all('SELECT * FROM users ORDER BY display_name', (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function deleteUser(userId) {
    return new Promise((resolve, reject) => {
        db.run('DELETE FROM users WHERE id = ?', [userId], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function changeUserPassword(userId, oldPassword, newPassword) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM users WHERE id = ?', [userId], (err, user) => {
            if (err) {
                return reject({ type: 'db', error: err });
            }
            if (!user) {
                return reject({ type: 'notfound' });
            }
            if (user.password !== oldPassword) {
                return reject({ type: 'wrongpw', dbPassword: user.password });
            }
            db.run('UPDATE users SET password = ? WHERE id = ?', [newPassword, userId], function (err2) {
                if (err2) {
                    return reject({ type: 'update', error: err2 });
                }
                resolve();
            });
        });
    });
}

module.exports = {
    initDatabase,
    addBill,
    getBills,
    deleteBill,
    addBillImage,
    getBillImages,
    deleteBillImage,
    addBillComment,
    getBillComments,
    deleteBillComment,
    approveBillParticipant,
    unapproveBillParticipant,
    getBillApprovals,
    isBillFullyApproved,
    createUser,
    getUserByUsername,
    getAllUsers,
    deleteUser,
    changeUserPassword
};
