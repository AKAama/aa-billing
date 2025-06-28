const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { initDatabase, addBill, getBills, deleteBill, addParticipant, getParticipants, addBillImage, getBillImages, deleteBillImage, deleteParticipant, addBillComment, getBillComments, deleteBillComment, approveBillParticipant, unapproveBillParticipant, getBillApprovals, isBillFullyApproved, createUser, getUserByUsername, getAllUsers, deleteUser, changeUserPassword } = require('./database');

const app = express();
const PORT = 3000;

// 简单的内存会话存储（生产环境应使用Redis等）
const sessions = new Map();

// 创建uploads目录
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// 配置multer
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 20 * 1024 * 1024 // 限制20MB
    },
    fileFilter: function (req, file, cb) {
        // 只允许图片文件
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('只允许上传图片文件'));
        }
    }
});

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static('uploads'));

// 初始化数据库（必须在所有数据库操作之前）
initDatabase();

// 自动插入超级管理员用户
(async () => {
    const { getUserByUsername, createUser } = require('./database');
    const admin = await getUserByUsername('admin');
    if (!admin) {
        await createUser('admin', 'admin123', '超级管理员');
        console.log('已自动创建超级管理员账号：admin/admin123');
    }
})();

// 提供前端页面
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API路由

// 获取所有账单
app.get('/api/bills', async (req, res) => {
    try {
        const bills = await getBills();
        res.json(bills);
    } catch (error) {
        res.status(500).json({ error: '获取账单失败' });
    }
});

// 添加新账单
app.post('/api/bills', async (req, res) => {
    try {
        const { description, amount, payer, participants } = req.body;
        if (!description || !amount || !payer || !participants || participants.length === 0) {
            return res.status(400).json({ error: '请填写完整信息' });
        }
        const billId = await addBill(description, amount, payer, participants);
        res.json({ success: true, billId });
    } catch (error) {
        res.status(500).json({ error: '添加账单失败' });
    }
});

// 删除账单
app.delete('/api/bills/:id', async (req, res) => {
    try {
        await deleteBill(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: '删除账单失败' });
    }
});

// 获取参与者列表
app.get('/api/participants', async (req, res) => {
    try {
        const participants = await getParticipants();
        res.json(participants);
    } catch (error) {
        res.status(500).json({ error: '获取参与者失败' });
    }
});

// 添加参与者
app.post('/api/participants', async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) {
            return res.status(400).json({ error: '请输入姓名' });
        }

        await addParticipant(name);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: '添加参与者失败' });
    }
});

// 删除参与者
app.delete('/api/participants/:name', async (req, res) => {
    try {
        const name = decodeURIComponent(req.params.name);

        // 检查是否有账单包含此参与者
        const bills = await getBills();
        const hasBills = bills.some(bill =>
            bill.participants.includes(name) || bill.payer === name
        );

        if (hasBills) {
            return res.status(400).json({
                error: '无法删除参与者，该参与者参与了现有账单。请先删除相关账单。'
            });
        }

        await deleteParticipant(name);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: '删除参与者失败' });
    }
});

// 管理员验证
app.post('/api/admin/verify', async (req, res) => {
    try {
        const { password } = req.body;
        const adminPassword = process.env.ADMIN_PASSWORD || 'admin123'; // 默认密码，建议设置环境变量

        if (password === adminPassword) {
            res.json({ success: true });
        } else {
            res.status(401).json({ error: '密码错误' });
        }
    } catch (error) {
        res.status(500).json({ error: '验证失败' });
    }
});

// 添加账单图片
app.post('/api/bills/:id/images', upload.single('image'), async (req, res) => {
    try {
        const billId = req.params.id;
        const filename = req.file.filename;
        const originalName = req.file.originalname;

        await addBillImage(billId, filename, originalName);
        res.json({ success: true, filename });
    } catch (error) {
        res.status(500).json({ error: '添加账单图片失败' });
    }
});

// 获取账单图片
app.get('/api/bills/:id/images', async (req, res) => {
    try {
        const billId = req.params.id;
        const images = await getBillImages(billId);
        res.json(images);
    } catch (error) {
        res.status(500).json({ error: '获取账单图片失败' });
    }
});

// 删除账单图片
app.delete('/api/bills/:id/images/:imageId', async (req, res) => {
    try {
        const imageId = req.params.imageId;

        // 先获取图片信息
        const images = await getBillImages(req.params.id);
        const image = images.find(img => img.id == imageId);

        if (image) {
            // 删除文件
            const filePath = path.join(__dirname, image.filename);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }

            // 删除数据库记录
            await deleteBillImage(imageId);
        }

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: '删除账单图片失败' });
    }
});

// 添加账单评论
app.post('/api/bills/:id/comments', async (req, res) => {
    try {
        const billId = parseInt(req.params.id, 10);
        const { commenter, content } = req.body;

        if (!commenter || !content) {
            return res.status(400).json({ error: '请填写完整信息' });
        }

        // 验证留言人是否为账单参与者
        const bills = await getBills();
        const bill = bills.find(b => b.id == billId);

        if (!bill) {
            return res.status(404).json({ error: '账单不存在' });
        }

        // 🔧 确保所有ID都转换为整数进行比较
        const commenterUserId = parseInt(commenter, 10);
        const participantUserIds = bill.participants.map(id => parseInt(id, 10));

        console.log('commenterUserId:', commenterUserId, 'participantUserIds:', participantUserIds);

        if (!participantUserIds.includes(commenterUserId)) {
            return res.status(400).json({ error: '只有账单参与者才能留言' });
        }

        const commentId = await addBillComment(billId, commenterUserId, content);
        res.json({ success: true, commentId });
    } catch (error) {
        console.error('添加评论失败:', error);
        res.status(500).json({ error: '添加评论失败' });
    }
});

// 获取账单评论
app.get('/api/bills/:id/comments', async (req, res) => {
    try {
        const billId = req.params.id;
        const comments = await getBillComments(billId);
        res.json(comments);
    } catch (error) {
        res.status(500).json({ error: '获取评论失败' });
    }
});

// 删除账单评论
app.delete('/api/bills/:id/comments/:commentId', async (req, res) => {
    try {
        const commentId = req.params.commentId;
        await deleteBillComment(commentId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: '删除评论失败' });
    }
});

// 确认账单参与者
app.post('/api/bills/:id/approve/:participant', async (req, res) => {
    try {
        const billId = req.params.id;
        const participant = decodeURIComponent(req.params.participant);
        const { approvedBy } = req.body;

        if (!approvedBy) {
            return res.status(400).json({ error: '请提供确认人信息' });
        }

        await approveBillParticipant(billId, participant, approvedBy);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: '确认失败' });
    }
});

// 取消确认账单参与者
app.delete('/api/bills/:id/approve/:participant', async (req, res) => {
    try {
        const billId = req.params.id;
        const participant = decodeURIComponent(req.params.participant);

        await unapproveBillParticipant(billId, participant);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: '取消确认失败' });
    }
});

// 获取账单确认状态
app.get('/api/bills/:id/approvals', async (req, res) => {
    try {
        const billId = req.params.id;
        const approvals = await getBillApprovals(billId);
        res.json(approvals);
    } catch (error) {
        res.status(500).json({ error: '获取确认状态失败' });
    }
});

// 用户认证中间件
function requireAuth(req, res, next) {
    const sessionId = req.headers['x-session-id'];
    const session = sessions.get(sessionId);

    if (!session || !session.user) {
        return res.status(401).json({ error: '请先登录' });
    }

    req.user = session.user;
    next();
}

// 用户注册
app.post('/api/auth/register', async (req, res) => {
    try {
        const username = req.body.username ? req.body.username.trim() : '';
        const password = req.body.password ? req.body.password.trim() : '';
        const displayName = req.body.displayName ? req.body.displayName.trim() : '';

        if (!username || !password || !displayName) {
            return res.status(400).json({ error: '请填写完整信息' });
        }

        // 检查用户名是否已存在
        const existingUser = await getUserByUsername(username);
        if (existingUser) {
            return res.status(400).json({ error: '用户名已存在' });
        }

        await createUser(username, password, displayName);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: '注册失败' });
    }
});

// 用户登录
app.post('/api/auth/login', async (req, res) => {
    try {
        const username = req.body.username ? req.body.username.trim() : '';
        const password = req.body.password ? req.body.password.trim() : '';

        if (!username || !password) {
            return res.status(400).json({ error: '请填写用户名和密码' });
        }

        const user = await getUserByUsername(username);
        console.log('登录尝试:', { username, password, dbPassword: user && user.password, type1: typeof password, type2: typeof (user && user.password) });
        if (!user || String(user.password) !== String(password)) {
            console.log('登录失败: 密码不一致');
            return res.status(401).json({ error: '用户名或密码错误' });
        }
        console.log('登录成功');

        // 创建会话
        const sessionId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
        sessions.set(sessionId, { user: { id: user.id, username: user.username, displayName: user.display_name, isAdmin: user.username === 'admin' || user.display_name === '超级管理员' } });

        // await loadBills();
        res.json({
            success: true,
            sessionId,
            user: {
                id: user.id,
                username: user.username,
                displayName: user.display_name,
                isAdmin: user.username === 'admin' || user.display_name === '超级管理员'
            }
        });
        console.log('响应已发送');
    } catch (error) {
        console.error('登录接口异常:', error);
        res.status(500).json({ error: '登录失败' });
    }
});

// 用户登出
app.post('/api/auth/logout', (req, res) => {
    const sessionId = req.headers['x-session-id'];
    if (sessionId) {
        sessions.delete(sessionId);
    }
    res.json({ success: true });
});

// 获取当前用户信息
app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
});

// 获取所有用户（仅id和display_name）
app.get('/api/users', async (req, res) => {
    try {
        const users = await getAllUsers();
        res.json(users.map(u => ({ id: u.id, display_name: u.display_name })));
    } catch (error) {
        res.status(500).json({ error: '获取用户失败' });
    }
});

// 删除用户（参与者）
app.delete('/api/users/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        // 检查是否有账单包含此用户
        const bills = await getBills();
        const hasBills = bills.some(bill =>
            bill.participants.includes(Number(userId)) || bill.payer == userId
        );
        if (hasBills) {
            return res.status(400).json({ error: '无法删除参与者，该用户参与了现有账单。请先删除相关账单。' });
        }
        await deleteUser(userId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: '删除用户失败' });
    }
});

// 修改密码
app.post('/api/users/change-password', async (req, res) => {
    try {
        const sessionId = req.headers['x-session-id'];
        if (!sessionId || !sessions.has(sessionId)) {
            console.error('未登录，sessionId:', sessionId);
            return res.status(401).json({ error: '未登录' });
        }
        const userId = sessions.get(sessionId).user.id;
        const { oldPassword, newPassword } = req.body;
        if (!oldPassword || !newPassword) {
            console.error('缺少参数', { userId, oldPassword, newPassword });
            return res.status(400).json({ error: '请填写完整信息' });
        }
        changeUserPassword(userId, oldPassword, newPassword)
            .then(() => {
                console.log('密码修改成功', { userId });
                res.json({ success: true });
            })
            .catch(err => {
                if (err.type === 'db') {
                    console.error('查用户出错', err.error, { userId });
                    return res.status(500).json({ error: '数据库错误' });
                } else if (err.type === 'notfound') {
                    console.error('用户不存在', { userId });
                    return res.status(404).json({ error: '用户不存在' });
                } else if (err.type === 'wrongpw') {
                    console.error('原密码错误', { userId, oldPassword, dbPassword: err.dbPassword });
                    return res.status(400).json({ error: '原密码错误' });
                } else if (err.type === 'update') {
                    console.error('更新密码出错', err.error, { userId });
                    return res.status(500).json({ error: '修改密码失败' });
                } else {
                    console.error('未知错误', err, { userId });
                    return res.status(500).json({ error: '未知错误' });
                }
            });
    } catch (error) {
        console.error('catch块捕获到异常', error);
        res.status(500).json({ error: '修改密码失败' });
    }
});

// 启动服务器 - 监听所有网络接口
app.listen(PORT, '0.0.0.0', () => {
    console.log(`服务器运行在 http://0.0.0.0:${PORT}`);
    console.log(`本地访问: http://localhost:${PORT}`);
    console.log(`外部访问: http://你的服务器IP:${PORT}`);
});
