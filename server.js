const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 讓 Express 自動提供 public 資料夾下的網頁 (index.html)
app.use(express.static(path.join(__dirname, 'public')));

// 連線到 Railway 提供的 PostgreSQL 資料庫
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

// 啟動時自動建立資料表 (模擬 Firebase 的 NoSQL 結構)
async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS documents (
                collection VARCHAR(50),
                id VARCHAR(255),
                data JSONB,
                PRIMARY KEY (collection, id)
            )
        `);
        console.log("✅ 資料庫初始化成功");
    } catch (err) {
        console.error("❌ 資料庫初始化失敗:", err);
    }
}
initDB();

// API: 獲取所有資料 (取代原本的 onSnapshot)
app.get('/api/data', async (req, res) => {
    try {
        const { rows } = await pool.query("SELECT * FROM documents");
        const data = { categories: [], groups: [], admins: [], stock: [], history: [] };

        rows.forEach(r => {
            if (r.collection === 'settings') {
                if (r.id === 'categories') data.categories = r.data.list || [];
                if (r.id === 'groups') data.groups = r.data.list || [];
                if (r.id === 'admins') data.admins = r.data.list || [];
            } else if (r.collection === 'stock') {
                data.stock.push(r.data);
            } else if (r.collection === 'history') {
                data.history.push({ id: r.id, ...r.data });
            }
        });

        // 歷史紀錄依照時間新到舊排序
        data.history.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// API: 寫入/更新 庫存
app.post('/api/stock/:sku', async (req, res) => {
    try {
        await pool.query(
            "INSERT INTO documents (collection, id, data) VALUES ('stock', $1, $2) ON CONFLICT (collection, id) DO UPDATE SET data = $2",
            [req.params.sku, req.body]
        );
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// API: 刪除 庫存
app.delete('/api/stock/:sku', async (req, res) => {
    try {
        await pool.query("DELETE FROM documents WHERE collection = 'stock' AND id = $1", [req.params.sku]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// API: 新增 歷史紀錄
app.post('/api/history', async (req, res) => {
    try {
        const id = crypto.randomUUID();
        await pool.query(
            "INSERT INTO documents (collection, id, data) VALUES ('history', $1, $2)",
            [id, req.body]
        );
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// API: 刪除 歷史紀錄 (回退用)
app.delete('/api/history/:id', async (req, res) => {
    try {
        await pool.query("DELETE FROM documents WHERE collection = 'history' AND id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// API: 寫入 設定檔 (類別/機群/管理員)
app.post('/api/settings/:id', async (req, res) => {
    try {
        await pool.query(
            "INSERT INTO documents (collection, id, data) VALUES ('settings', $1, $2) ON CONFLICT (collection, id) DO UPDATE SET data = $2",
            [req.params.id, req.body]
        );
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// API: 批次匯入庫存 (取代 Firebase Batch)
app.post('/api/batch_stock', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const items = req.body;
        for (let item of items) {
            await client.query(
                "INSERT INTO documents (collection, id, data) VALUES ('stock', $1, $2) ON CONFLICT (collection, id) DO UPDATE SET data = $2",
                [item.sku, item]
            );
        }
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (e) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: e.message });
    } finally {
        client.release();
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 伺服器已啟動於連接埠 ${PORT}`);
});
