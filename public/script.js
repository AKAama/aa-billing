// 全局变量
let participants = [];
let selectedParticipants = [];
let bills = [];
let selectedImages = []; // 存储选中的图片文件
let isAdminVerified = false; // 管理员验证状态
let adminVerificationTime = 0; // 管理员验证时间戳
const ADMIN_CACHE_DURATION = 30 * 60 * 1000; // 30分钟缓存时间
let currentUser = null; // 当前登录用户
let sessionId = null; // 会话ID
let allUsers = [];

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', function () {
    loadParticipants();
    loadBills();
    checkLoginStatus();
    fillParticipantSelect(); // 页面初始化时也刷新下拉框
    // 展开/收起添加账单表单
    document.getElementById('toggleAddBillBtn').onclick = function () {
        const section = document.getElementById('addBillSection');
        if (section.style.display === 'none') {
            section.style.display = 'block';
            this.textContent = '收起账单表单';
        } else {
            section.style.display = 'none';
            this.textContent = '添加账单';
        }
    };
    // 修正：绑定管理员密码输入框回车事件，防止未渲染时报错
    const adminPasswordInput = document.getElementById('adminPassword');
    if (adminPasswordInput) {
        adminPasswordInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') {
                verifyAdmin();
            }
        });
    }
});

// 加载参与者列表（改为加载所有用户，过滤掉超级管理员）
async function loadParticipants() {
    try {
        const response = await fetch('/api/users');
        allUsers = (await response.json())
            .filter(u => u.display_name !== '超级管理员' && u.username !== 'admin')
            .map(u => ({ ...u, id: Number(u.id) }));
        participants = allUsers;
        renderParticipants();
        updatePayerSelect();
        fillParticipantSelect(); // 每次加载后都刷新下拉框
    } catch (error) {
        console.error('加载用户失败:', error);
    }
}

// 更新付款人选择下拉框
function updatePayerSelect() {
    const payerSelect = document.getElementById('payer');
    payerSelect.innerHTML = '<option value="">请选择付款人</option>';
    allUsers.filter(u => u.display_name !== '超级管理员' && u.username !== 'admin').forEach(user => {
        const option = document.createElement('option');
        option.value = user.id;
        option.textContent = user.display_name;
        payerSelect.appendChild(option);
    });
}

// 渲染参与者列表
function renderParticipants() {
    const container = document.getElementById('participantsList');
    container.innerHTML = '';
    selectedParticipants.forEach(userId => {
        const user = allUsers.find(u => u.id == userId);
        if (user) {
            const tag = document.createElement('div');
            tag.className = 'participant-tag selected';
            tag.textContent = user.display_name;
            tag.onclick = () => {
                // 取消选择
                selectedParticipants = selectedParticipants.filter(id => id !== userId);
                updateSelectedCount();
                renderParticipants();
                fillParticipantSelect();
            };
            container.appendChild(tag);
        }
    });
}

// 更新选中参与者数量显示
function updateSelectedCount() {
    const countElement = document.getElementById('selectedCount');
    const count = selectedParticipants.length;
    if (count > 0) {
        const names = selectedParticipants.map(id => {
            const user = allUsers.find(u => u.id == id);
            return user ? user.display_name : id;
        });
        countElement.textContent = `已选择：${count}人 (${names.join('、')})`;
    } else {
        countElement.textContent = '已选择：0人';
    }
}

// 添加新参与者
async function addParticipant() {
    const select = document.getElementById('newParticipantSelect');
    const userId = select.value;
    if (!userId) {
        alert('请选择参与者');
        return;
    }
    if (!selectedParticipants.includes(userId)) {
        selectedParticipants.push(userId);
        updateSelectedCount();
        renderParticipants();
        fillParticipantSelect();
    }
}

// 添加账单
async function addBill() {
    withAdminPermission(async () => {
        const description = document.getElementById('description').value.trim();
        const amount = parseFloat(document.getElementById('amount').value);
        const payer = document.getElementById('payer').value;
        if (!description) {
            alert('请输入账单描述');
            return;
        }
        if (!amount || amount <= 0) {
            alert('请输入有效的金额');
            return;
        }
        if (!payer) {
            alert('请选择付款人');
            return;
        }
        if (selectedParticipants.length === 0) {
            alert('请选择参与者');
            return;
        }
        try {
            const response = await fetch('/api/bills', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    description,
                    amount,
                    payer, // userId
                    participants: selectedParticipants // userId数组
                })
            });
            if (response.ok) {
                const result = await response.json();
                const billId = result.billId;

                // 上传图片
                if (selectedImages.length > 0) {
                    for (let image of selectedImages) {
                        const formData = new FormData();
                        formData.append('image', image);

                        await fetch(`/api/bills/${billId}/images`, {
                            method: 'POST',
                            body: formData
                        });
                    }
                }

                // 清空表单
                document.getElementById('description').value = '';
                document.getElementById('amount').value = '';
                document.getElementById('payer').value = '';
                selectedParticipants = [];
                selectedImages = [];
                document.getElementById('imageUpload').value = '';

                // 取消所有参与者的选择状态
                document.querySelectorAll('.participant-tag').forEach(tag => {
                    tag.classList.remove('selected');
                });

                // 更新选中数量显示
                updateSelectedCount();

                // 清空图片预览
                document.getElementById('imagePreview').innerHTML = '';

                // 重新加载账单列表
                loadBills();
            } else {
                alert('添加账单失败');
            }
        } catch (error) {
            console.error('添加账单失败:', error);
            alert('添加账单失败');
        }
    });
}

// 加载账单列表
async function loadBills() {
    try {
        const response = await fetch('/api/bills');
        bills = await response.json();
        renderBills();
        renderSummary();
    } catch (error) {
        console.error('加载账单失败:', error);
    }
}

// 渲染账单列表
function renderBills() {
    const container = document.getElementById('billsList');
    container.innerHTML = '';
    if (bills.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999;">暂无账单</p>';
        return;
    }
    bills.forEach(bill => {
        const billElement = document.createElement('div');
        billElement.className = 'bill-item';

        // 用participantNames渲染
        const participantsChips = bill.participantNames.map((name, idx) =>
            `<span class="participant-chip" data-participant-id="${bill.participants[idx]}">${name}</span>`
        ).join('');
        const date = new Date(bill.created_at).toLocaleDateString('zh-CN');

        // 🔧 修复权限检查逻辑
        let canComment = false;
        if (currentUser) {
            const currentUserId = parseInt(currentUser.id, 10);
            const participantIds = bill.participants.map(id => parseInt(id, 10));
            canComment = participantIds.includes(currentUserId) || currentUser.isAdmin;
        }

        billElement.innerHTML = `
            <button class="delete-btn" onclick="deleteBill(${bill.id})">×</button>
            <div class="bill-header">
                <span class="bill-description">${bill.description}</span>
                <span class="bill-amount">¥${bill.amount.toFixed(2)}</span>
            </div>
            <div class="bill-details">
                付款人：<span style="color: #27ae60; font-weight: bold;">${bill.payerName}</span> | 
                每人应付：¥${bill.per_person.toFixed(2)} | 创建时间：${date}
            </div>
            <div class="bill-participants" id="bill-participants-${bill.id}">
                ${participantsChips}
            </div>
            <div class="bill-approval-status" id="bill-approval-${bill.id}">
                <div class="approval-loading">加载确认状态中...</div>
            </div>
            <div class="bill-images" id="bill-images-${bill.id}">
                <div class="images-loading">加载图片中...</div>
            </div>
            <div class="bill-comments" id="bill-comments-${bill.id}"></div>
            <div class="add-comment-section">
                <div class="comment-input-group">
                    ${currentUser ? `<span class="commenter-display">${currentUser.displayName}</span>` : ''}
                    <input type="text" id="comment-content-${bill.id}" class="comment-input" placeholder="写下你的留言..." ${(canComment ? '' : 'disabled')}>
                    <button onclick="addComment(${bill.id})" class="add-comment-btn" ${(canComment ? '' : 'disabled')}>留言</button>
                </div>
            </div>
        `;
        container.appendChild(billElement);
        loadBillImages(bill.id);
        loadBillComments(bill.id);
        loadBillApprovalStatus(bill.id);
    });
}

// 加载账单图片
async function loadBillImages(billId) {
    try {
        const response = await fetch(`/api/bills/${billId}/images`);
        const images = await response.json();

        const imagesContainer = document.getElementById(`bill-images-${billId}`);
        if (images.length === 0) {
            imagesContainer.innerHTML = '';
            return;
        }

        let imagesHTML = '<div class="bill-images-title">📷 账单图片：</div>';
        images.forEach(image => {
            imagesHTML += `
                <div class="bill-image-item">
                    <img src="/uploads/${image.filename}" alt="${image.original_name}" onclick="showImageModal('/uploads/${image.filename}')">
                    <button onclick="deleteBillImage(${billId}, ${image.id})" class="delete-image-btn">×</button>
                </div>
            `;
        });

        imagesContainer.innerHTML = imagesHTML;
    } catch (error) {
        console.error('加载图片失败:', error);
    }
}

// 删除账单图片
async function deleteBillImage(billId, imageId) {
    withAdminPermission(async () => {
        if (!confirm('确定要删除这张图片吗？')) {
            return;
        }

        try {
            const response = await fetch(`/api/bills/${billId}/images/${imageId}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                loadBillImages(billId);
            } else {
                alert('删除图片失败');
            }
        } catch (error) {
            console.error('删除图片失败:', error);
            alert('删除图片失败');
        }
    });
}

// 显示图片模态框
function showImageModal(imageSrc) {
    const modal = document.createElement('div');
    modal.className = 'image-modal';
    modal.innerHTML = `
        <div class="image-modal-content">
            <span class="close-modal" onclick="this.parentElement.parentElement.remove()">&times;</span>
            <img src="${imageSrc}" alt="大图">
        </div>
    `;
    document.body.appendChild(modal);

    modal.onclick = function (e) {
        if (e.target === modal) {
            modal.remove();
        }
    };
}

// 删除账单
async function deleteBill(id) {
    withAdminPermission(async () => {
        if (!confirm('确定要删除这个账单吗？')) {
            return;
        }

        try {
            const response = await fetch(`/api/bills/${id}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                loadBills();
            } else {
                alert('删除账单失败');
            }
        } catch (error) {
            console.error('删除账单失败:', error);
            alert('删除账单失败');
        }
    });
}

// 渲染统计信息 - 带调试版本
function renderSummary() {
    const container = document.getElementById('summary');
    if (bills.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #999;">暂无统计数据</p>';
        return;
    }

    // ✅ 1. 初始化 summaryHTML
    let summaryHTML = '';

    // 过滤出已确认的账单
    const confirmedBills = bills.filter(bill => {
        return true; // 暂时显示所有账单
    });

    console.log('=== 详细调试信息 ===');
    console.log('1. confirmedBills:', confirmedBills);

    // 计算总金额
    const totalAmount = confirmedBills.reduce((sum, bill) => sum + bill.amount, 0);

    // ✅ 2. 确保所有 ID 都是 Number 类型
    const personalBalance = {};
    allUsers.forEach(user => {
        const userId = Number(user.id);
        personalBalance[userId] = 0;
    });

    console.log('2. 初始 personalBalance:', personalBalance);

    confirmedBills.forEach(bill => {
        console.log(`处理账单: ${bill.description}`);

        // ✅ 3. 确保类型一致
        const payerId = Number(bill.payer);
        const participantIds = bill.participants.map(id => Number(id));

        console.log(`  付款人: ${payerId} (类型: ${typeof payerId})`);
        console.log(`  参与者: ${participantIds} (类型: ${participantIds.map(p => typeof p)})`);
        console.log(`  金额: ${bill.amount}, 人均: ${bill.per_person}`);

        // 付款人增加余额
        if (personalBalance[payerId] !== undefined) {
            personalBalance[payerId] += bill.amount;
            console.log(`  ${payerId} 付款后余额: ${personalBalance[payerId]}`);
        } else {
            console.log(`  警告: 付款人 ${payerId} 不在 personalBalance 中`);
        }

        // 参与者减少余额
        participantIds.forEach(uid => {
            if (personalBalance[uid] !== undefined) {
                personalBalance[uid] -= bill.per_person;
                console.log(`  ${uid} 分摊后余额: ${personalBalance[uid]}`);
            } else {
                console.log(`  警告: 参与者 ${uid} 不在 personalBalance 中`);
            }
        });
    });

    console.log('4. 计算后的 personalBalance:', personalBalance);

    // 计算转账建议
    const transferSuggestions = calculateTransfers(personalBalance);
    console.log('6. transferSuggestions:', transferSuggestions);

    // ✅ 4. 显示统计信息和转账建议
    allUsers.forEach(user => {
        const userId = Number(user.id);
        const balance = personalBalance[userId] || 0;
        const color = balance > 0 ? '#27ae60' : balance < 0 ? '#e74c3c' : '#7f8c8d';
        const prefix = balance > 0 ? '+' : '';
        const isCurrentUser = currentUser && userId === Number(currentUser.id);

        summaryHTML += `<div class="summary-item" style="${isCurrentUser ? 'background:#fffbe6;font-weight:bold;' : ''}">
            <span>${isCurrentUser ? '你' : user.display_name}</span>
            <span style="color:${color}">${prefix}¥${balance.toFixed(2)}</span>
        </div>`;

        // ✅ 5. 确保严格的类型比较
        const payList = transferSuggestions.filter(sug => Number(sug.from) === userId);
        const recvList = transferSuggestions.filter(sug => Number(sug.to) === userId);

        console.log(`用户 ${user.display_name} (ID: ${userId})`);
        console.log(`  payList:`, payList);
        console.log(`  recvList:`, recvList);

        if (payList.length > 0) {
            payList.forEach(sug => {
                const toUser = allUsers.find(u => Number(u.id) === Number(sug.to));
                if (toUser) {
                    const isToCurrentUser = currentUser && Number(toUser.id) === Number(currentUser.id);
                    summaryHTML += `<div class="summary-item transfer-detail" style="margin-left:2em;color:#e67e22;">
                        ${isCurrentUser ? '你' : user.display_name} 应向 ${isToCurrentUser ? '你' : toUser.display_name} 转账 ¥${sug.amount.toFixed(2)}
                    </div>`;
                }
            });
        }

        if (recvList.length > 0) {
            recvList.forEach(sug => {
                const fromUser = allUsers.find(u => Number(u.id) === Number(sug.from));
                if (fromUser) {
                    const isFromCurrentUser = currentUser && Number(fromUser.id) === Number(currentUser.id);
                    summaryHTML += `<div class="summary-item transfer-detail" style="margin-left:2em;color:#27ae60;">
                        ${isCurrentUser ? '你' : user.display_name} 应收 ${isFromCurrentUser ? '你' : fromUser.display_name} ¥${sug.amount.toFixed(2)}
                    </div>`;
                }
            });
        }
    });

    container.innerHTML = summaryHTML;
}

// 计算最优转账方案
function calculateTransfers(balances) {
    console.log('calculateTransfers 输入:', balances);

    // ✅ 确保所有键都是 Number 类型
    const normalizedBalances = {};
    Object.entries(balances).forEach(([id, balance]) => {
        normalizedBalances[Number(id)] = balance;
    });

    // 只处理非零余额
    const users = Object.entries(normalizedBalances)
        .map(([id, balance]) => ({ id: Number(id), balance: balance }))
        .filter(u => Math.abs(u.balance) > 0.01); // 避免浮点数精度问题

    console.log('处理的用户:', users);

    const payers = users.filter(u => u.balance < 0).sort((a, b) => a.balance - b.balance);
    const receivers = users.filter(u => u.balance > 0).sort((a, b) => b.balance - a.balance);

    console.log('需要付款的用户 (payers):', payers);
    console.log('应该收款的用户 (receivers):', receivers);

    const suggestions = [];
    let i = 0, j = 0;

    while (i < payers.length && j < receivers.length) {
        const payer = payers[i];
        const receiver = receivers[j];
        const amount = Math.min(-payer.balance, receiver.balance);

        if (amount > 0.01) { // 避免处理很小的金额
            suggestions.push({
                from: Number(payer.id),
                to: Number(receiver.id),
                amount: Math.round(amount * 100) / 100 // 保留两位小数
            });
            payer.balance += amount;
            receiver.balance -= amount;
        }

        if (Math.abs(payer.balance) < 0.01) i++;
        if (Math.abs(receiver.balance) < 0.01) j++;
    }

    console.log('生成的转账建议:', suggestions);
    return suggestions;
}

// 回车键快捷操作
const newParticipantInput = document.getElementById('newParticipant');
if (newParticipantInput) {
    newParticipantInput.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
            addParticipant();
        }
    });
}

const descriptionInput = document.getElementById('description');
if (descriptionInput) {
    descriptionInput.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
            document.getElementById('amount').focus();
        }
    });
}

const amountInput = document.getElementById('amount');
if (amountInput) {
    amountInput.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
            addBill();
        }
    });
}

// 检查管理员权限
function checkAdminPermission() {
    const now = Date.now();

    // 检查缓存是否有效
    if (isAdminVerified && (now - adminVerificationTime) < ADMIN_CACHE_DURATION) {
        return true;
    }

    // 缓存过期，需要重新验证
    isAdminVerified = false;
    showAdminModal();
    return false;
}

// 显示管理员验证模态框
function showAdminModal() {
    document.getElementById('adminModal').style.display = 'flex';
    document.getElementById('adminPassword').focus();
}

// 关闭管理员验证模态框
function closeAdminModal() {
    document.getElementById('adminModal').style.display = 'none';
    document.getElementById('adminPassword').value = '';
}

// 验证管理员密码
async function verifyAdmin() {
    const password = document.getElementById('adminPassword').value.trim();

    if (!password) {
        alert('请输入管理员密码');
        return;
    }

    try {
        const response = await fetch('/api/admin/verify', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ password })
        });

        if (response.ok) {
            isAdminVerified = true;
            adminVerificationTime = Date.now();
            closeAdminModal();

            // 执行之前被阻止的操作
            if (window.pendingAdminAction) {
                window.pendingAdminAction();
                window.pendingAdminAction = null;
            }
        } else {
            alert('管理员密码错误');
            document.getElementById('adminPassword').value = '';
            document.getElementById('adminPassword').focus();
        }
    } catch (error) {
        console.error('验证失败:', error);
        alert('验证失败，请重试');
    }
}

// 带管理员验证的操作包装器
function withAdminPermission(action) {
    if (checkAdminPermission()) {
        action();
    } else {
        window.pendingAdminAction = action;
    }
}

// 显示参与者管理模态框
function showParticipantModal() {
    withAdminPermission(() => {
        document.getElementById('participantModal').style.display = 'flex';
        renderParticipantModalList();

        // 添加点击外部关闭功能
        const modal = document.getElementById('participantModal');
        modal.onclick = function (e) {
            if (e.target === modal) {
                closeParticipantModal();
            }
        };
    });
}

// 关闭参与者管理模态框
function closeParticipantModal() {
    document.getElementById('participantModal').style.display = 'none';
}

// 渲染参与者管理模态框列表
function renderParticipantModalList() {
    const container = document.getElementById('participantModalList');
    container.innerHTML = '';
    if (allUsers.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: #999; padding: 40px;">暂无参与者</div>';
        return;
    }
    allUsers.forEach(user => {
        if (user.display_name === '超级管理员' || user.username === 'admin') return;
        const item = document.createElement('div');
        item.className = 'participant-modal-item';
        item.innerHTML = `
            <div class="participant-info">
                <div class="participant-avatar">${user.display_name.charAt(0)}</div>
                <div class="participant-details">
                    <div class="participant-name-modal">${user.display_name}</div>
                </div>
            </div>
            <div class="participant-actions">
                <button onclick="deleteParticipantModal('${user.id}')" class="action-btn delete-btn-modal">删除</button>
            </div>
        `;
        container.appendChild(item);
    });
}

// 添加参与者（只允许从下拉框选择）
function fillParticipantSelect() {
    const select = document.getElementById('newParticipantSelect');
    select.innerHTML = '<option value="">选择已注册用户</option>';
    allUsers.forEach(user => {
        // 过滤掉已选中的和超级管理员
        if (!selectedParticipants.includes(user.id) && user.display_name !== '超级管理员' && user.username !== 'admin') {
            const option = document.createElement('option');
            option.value = user.id;
            option.textContent = user.display_name;
            select.appendChild(option);
        }
    });
}

// 删除参与者（通过userId）
async function deleteParticipantModal(userId) {
    if (!confirm('确定要删除该参与者吗？\n注意：如果该参与者参与了现有账单，删除可能会影响账单显示。')) {
        return;
    }
    try {
        const response = await fetch(`/api/users/${userId}`, { method: 'DELETE' });
        if (response.ok) {
            selectedParticipants = selectedParticipants.filter(id => id !== userId);
            await loadParticipants();
            renderParticipants();
            fillParticipantSelect();
            alert('参与者删除成功！');
        } else {
            const errorData = await response.json();
            alert(errorData.error || '删除参与者失败');
        }
    } catch (error) {
        console.error('删除参与者失败:', error);
        alert('删除参与者失败');
    }
}

// 加载账单评论
async function loadBillComments(billId) {
    try {
        const response = await fetch(`/api/bills/${billId}/comments`);
        const comments = await response.json();
        const commentsContainer = document.getElementById(`bill-comments-${billId}`);
        if (comments.length === 0) {
            commentsContainer.innerHTML = '<div class="no-comments">暂无留言</div>';
            return;
        }
        let commentsHTML = '<div class="comments-title">💬 留言：</div>';
        comments.forEach(comment => {
            // 用displayName渲染
            const user = allUsers.find(u => u.id == comment.commenter);
            const name = user ? user.display_name : comment.commenter;
            const date = new Date(comment.created_at).toLocaleString('zh-CN');
            commentsHTML += `
                <div class="comment-item">
                    <div class="comment-header">
                        <span class="commenter-name">${name}</span>
                        <span class="comment-time">${date}</span>
                        <button onclick="deleteComment(${billId}, ${comment.id})" class="delete-comment-btn">×</button>
                    </div>
                    <div class="comment-content">${comment.content}</div>
                </div>
            `;
        });
        commentsContainer.innerHTML = commentsHTML;
    } catch (error) {
        console.error('加载评论失败:', error);
    }
}

// 添加评论
async function addComment(billId) {
    if (!currentUser) {
        alert('请先登录');
        showLoginForm();
        return;
    }

    const content = document.getElementById(`comment-content-${billId}`).value.trim();
    if (!content) {
        alert('请输入留言内容');
        return;
    }

    try {
        // 🔧 确保传递的是数字类型
        const commenterUserId = parseInt(currentUser.id, 10);

        const response = await fetch(`/api/bills/${billId}/comments`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                commenter: commenterUserId,
                content
            })
        });

        if (response.ok) {
            document.getElementById(`comment-content-${billId}`).value = '';
            loadBillComments(billId);
        } else {
            const errorData = await response.json();
            alert(errorData.error || '添加留言失败');
        }
    } catch (error) {
        console.error('添加留言失败:', error);
        alert('添加留言失败');
    }
}

// 删除评论
async function deleteComment(billId, commentId) {
    withAdminPermission(async () => {
        if (!confirm('确定要删除这条留言吗？')) {
            return;
        }

        try {
            const response = await fetch(`/api/bills/${billId}/comments/${commentId}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                loadBillComments(billId);
            } else {
                alert('删除留言失败');
            }
        } catch (error) {
            console.error('删除留言失败:', error);
            alert('删除留言失败');
        }
    });
}

// 加载账单确认状态
async function loadBillApprovalStatus(billId) {
    try {
        const response = await fetch(`/api/bills/${billId}/approvals`);
        const approvals = await response.json();
        const bill = bills.find(b => b.id == billId);
        if (!bill) return;
        const approvalContainer = document.getElementById(`bill-approval-${billId}`);
        const participantsContainer = document.getElementById(`bill-participants-${billId}`);
        // 更新参与者芯片，添加确认状态
        const participantChips = participantsContainer.querySelectorAll('.participant-chip');
        participantChips.forEach((chip, idx) => {
            const participantId = chip.getAttribute('data-participant-id');
            const participantName = chip.textContent.replace(/\s[✅⏳]$/, '');
            const isApproved = approvals.some(approval => approval.participant == participantId);
            if (isApproved) {
                chip.classList.add('approved');
                chip.innerHTML = `${participantName} ✅`;
            } else {
                chip.classList.remove('approved');
                chip.innerHTML = `${participantName} ⏳`;
            }
            // 超级管理员可以为任意人点确认，普通用户只能点自己
            if (currentUser && (currentUser.id == participantId || currentUser.isAdmin)) {
                chip.style.cursor = 'pointer';
                chip.onclick = () => toggleApproval(billId, participantId, participantName);
            } else {
                chip.style.cursor = 'default';
                chip.onclick = null;
            }
        });
        // 显示确认状态摘要
        const approvedCount = approvals.length;
        const totalCount = bill.participants.length;
        const isFullyApproved = approvedCount === totalCount;
        let statusHTML = `
            <div class="approval-summary ${isFullyApproved ? 'fully-approved' : 'pending-approval'}">
                <span class="approval-status-text">
                    ${isFullyApproved ? '✅ 账单已确认' : '⏳ 等待确认'}
                </span>
                <span class="approval-count">${approvedCount}/${totalCount} 人已确认</span>
            </div>
        `;
        // 新增：当前用户已确认的提示
        if (currentUser) {
            // 修正：类型统一为数字
            const isUserParticipant = bill.participants.map(id => Number(id)).includes(Number(currentUser.id));
            const isUserApproved = approvals.some(approval => approval.participant == currentUser.id);
            if (isUserParticipant) {
                if (isUserApproved) {
                    statusHTML += `<div class="approval-note">💡 你已确认</div>`;
                } else {
                    statusHTML += `<div class="approval-note">💡 点击你的姓名可以确认账单</div>`;
                }
            } else {
                statusHTML += `<div class="approval-note">💡 您不是此账单的参与者</div>`;
            }
        } else {
            statusHTML += `<div class="approval-note">💡 请登录后确认您的账单状态</div>`;
        }
        approvalContainer.innerHTML = statusHTML;
    } catch (error) {
        console.error('加载确认状态失败:', error);
    }
}

// 切换确认状态
async function toggleApproval(billId, participantId, participantName) {
    if (!currentUser) {
        alert('请先登录');
        showLoginForm();
        return;
    }
    // 超级管理员可以为任意人点确认，普通用户只能点自己
    if (!currentUser.isAdmin && currentUser.displayName !== participantName) {
        alert('您只能确认自己的状态');
        return;
    }
    try {
        const response = await fetch(`/api/bills/${billId}/approvals`);
        const approvals = await response.json();
        const isCurrentlyApproved = approvals.some(approval => approval.participant == participantId);
        if (isCurrentlyApproved) {
            // 取消确认
            const deleteResponse = await fetch(`/api/bills/${billId}/approve/${participantId}`, {
                method: 'DELETE',
                headers: { 'x-session-id': sessionId }
            });
            if (deleteResponse.ok) {
                loadBillApprovalStatus(billId);
                loadBills();
            } else {
                alert('取消确认失败');
            }
        } else {
            // 确认
            const approveResponse = await fetch(`/api/bills/${billId}/approve/${participantId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-session-id': sessionId
                },
                body: JSON.stringify({ approvedBy: currentUser.displayName })
            });
            if (approveResponse.ok) {
                loadBillApprovalStatus(billId);
                loadBills();
            } else {
                alert('确认失败');
            }
        }
    } catch (error) {
        console.error('切换确认状态失败:', error);
        alert('操作失败');
    }
}

// 检查登录状态
async function checkLoginStatus() {
    const savedSessionId = localStorage.getItem('sessionId');
    if (savedSessionId) {
        try {
            const response = await fetch('/api/auth/me', {
                headers: {
                    'x-session-id': savedSessionId
                }
            });

            if (response.ok) {
                const data = await response.json();
                currentUser = data.user;
                sessionId = savedSessionId;
                updateUserInterface();
            } else {
                // 会话过期，清除本地存储
                localStorage.removeItem('sessionId');
                updateUserInterface();
            }
        } catch (error) {
            console.error('检查登录状态失败:', error);
            localStorage.removeItem('sessionId');
            updateUserInterface();
        }
    } else {
        updateUserInterface();
    }
}

// 更新用户界面
function updateUserInterface() {
    const userInfo = document.getElementById('userInfo');
    const loginBtn = document.getElementById('loginBtn');
    const userDisplayName = document.getElementById('userDisplayName');
    if (currentUser) {
        userInfo.style.display = 'flex';
        loginBtn.style.display = 'none';
        userDisplayName.textContent = currentUser.displayName;
        loadAllUsers(); // 登录后刷新allUsers和下拉框
    } else {
        userInfo.style.display = 'none';
        loginBtn.style.display = 'block';
        allUsers = [];
        fillParticipantSelect(); // 未登录时禁用下拉框
    }
}

// 显示登录表单
function showLoginForm() {
    closeRegisterModal(); // 自动关闭注册模态框
    document.getElementById('loginModal').style.display = 'flex';
    document.getElementById('loginUsername').focus();
}

// 关闭登录模态框
function closeLoginModal() {
    document.getElementById('loginModal').style.display = 'none';
    document.getElementById('loginUsername').value = '';
    document.getElementById('loginPassword').value = '';
}

// 显示注册表单
function showRegisterForm() {
    document.getElementById('loginModal').style.display = 'none';
    document.getElementById('registerModal').style.display = 'flex';
    document.getElementById('registerUsername').focus();
}

// 关闭注册模态框
function closeRegisterModal() {
    document.getElementById('registerModal').style.display = 'none';
    document.getElementById('registerUsername').value = '';
    document.getElementById('registerDisplayName').value = '';
    document.getElementById('registerPassword').value = '';
}

// 用户登录
async function login() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!username || !password) {
        alert('请填写用户名和密码');
        return;
    }

    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });

        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                currentUser = data.user;
                sessionId = data.sessionId;
                localStorage.setItem('sessionId', sessionId);
                closeLoginModal();
                updateUserInterface();
                await loadParticipants(); // 登录后刷新allUsers和下拉框
                await loadBills(); // 新增：登录后刷新账单列表
                alert('登录成功！');
            } else {
                alert(data.error || '登录失败');
            }
        } else {
            const errorData = await response.json();
            alert(errorData.error || '登录失败');
        }
    } catch (error) {
        console.error('登录失败:', error);
        alert('登录失败');
    }
}

// 用户注册
async function register() {
    const username = document.getElementById('registerUsername').value.trim();
    const displayName = document.getElementById('registerDisplayName').value.trim();
    const password = document.getElementById('registerPassword').value;
    if (!username || !displayName || !password) {
        alert('请填写完整信息');
        return;
    }
    try {
        const response = await fetch('/api/auth/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, displayName, password })
        });
        if (response.ok) {
            alert('注册成功！请登录');
            closeRegisterModal(); // 注册成功后关闭注册模态框
            await loadParticipants(); // 注册成功后刷新用户列表和下拉框
            showLoginForm();
        } else {
            const errorData = await response.json();
            alert(errorData.error || '注册失败');
        }
    } catch (error) {
        console.error('注册失败:', error);
        alert('注册失败');
    }
}

// 用户登出
async function logout() {
    try {
        await fetch('/api/auth/logout', {
            method: 'POST',
            headers: {
                'x-session-id': sessionId
            }
        });
    } catch (error) {
        console.error('登出失败:', error);
    }

    currentUser = null;
    sessionId = null;
    localStorage.removeItem('sessionId');
    updateUserInterface();
    alert('已登出');
}

// 更新allUsers和下拉框
function loadAllUsers() {
    // 实现加载allUsers的逻辑
}

function showChangePasswordModal() {
    document.getElementById('changePasswordModal').style.display = 'flex';
    document.getElementById('oldPassword').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('confirmNewPassword').value = '';
    document.getElementById('oldPassword').focus();
}

function closeChangePasswordModal() {
    document.getElementById('changePasswordModal').style.display = 'none';
}

async function changePassword() {
    const oldPassword = document.getElementById('oldPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmNewPassword = document.getElementById('confirmNewPassword').value;
    if (!oldPassword || !newPassword || !confirmNewPassword) {
        alert('请填写完整信息');
        return;
    }
    if (newPassword !== confirmNewPassword) {
        alert('两次输入的新密码不一致');
        return;
    }
    try {
        const response = await fetch('/api/users/change-password', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-session-id': sessionId
            },
            body: JSON.stringify({ oldPassword, newPassword })
        });
        if (response.ok) {
            alert('密码修改成功，请重新登录');
            closeChangePasswordModal();
            logout();
        } else {
            const errorData = await response.json();
            alert(errorData.error || '密码修改失败');
        }
    } catch (error) {
        alert('密码修改失败');
    }
}

// 处理图片上传
function handleImageUpload(event) {
    const files = Array.from(event.target.files);
    const maxImages = 3;

    if (selectedImages.length + files.length > maxImages) {
        alert(`最多只能上传${maxImages}张图片`);
        return;
    }

    files.forEach(file => {
        if (file.type.startsWith('image/')) {
            selectedImages.push(file);
        }
    });

    renderImagePreview();
}

// 渲染图片预览
function renderImagePreview() {
    const preview = document.getElementById('imagePreview');
    preview.innerHTML = '';

    selectedImages.forEach((file, index) => {
        const reader = new FileReader();
        reader.onload = function (e) {
            const imgContainer = document.createElement('div');
            imgContainer.className = 'image-preview-item';
            imgContainer.innerHTML = `
                <img src="${e.target.result}" alt="预览图片">
                <button onclick="removeImage(${index})" class="remove-image-btn">×</button>
            `;
            preview.appendChild(imgContainer);
        };
        reader.readAsDataURL(file);
    });
}

// 移除图片
function removeImage(index) {
    selectedImages.splice(index, 1);
    renderImagePreview();
}