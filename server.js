const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

pool.on('connect', () => {
    console.log('Connected to PostgreSQL Database!');
});

// 1. GET ALL CUSTOMERS
app.get('/api/customers', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM customers ORDER BY id DESC');
        res.json({
            success: true,
            data: result.rows
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ success: false, error: 'Server Error' });
    }
});

// 2. ADD NEW CUSTOMER (POST)
app.post('/api/customers', async (req, res) => {
    const { name, email, phone, status, user_id, website } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO customers (name, email, phone, status, user_id, website)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [name, email, phone, status || 'active', user_id, website]
        );

        res.status(201).json({ success: true, data: result.rows[0] });
    } catch (err) {
        console.error("Postgres Error:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. UPDATE CUSTOMER (PUT)
app.put('/api/customers/:id', async (req, res) => {
    const { id } = req.params;
    const { name, email, phone, status, website } = req.body;
    try {
        const result = await pool.query(
            `UPDATE customers
             SET name = $1, email = $2, phone = $3, status = $4, website = $5
             WHERE id = $6 
             RETURNING *`,
            [name, email, phone, status, website, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Customer ID not found' });
        }

        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. DELETE CUSTOMER (DELETE)
app.delete('/api/customers/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM customers WHERE id = $1', [id]);
        res.json({ success: true, message: 'Customer deleted successfully' });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 5. TOGGLE STATUS ONLY (PATCH)
app.patch('/api/customers/:id/status', async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    try {
        const result = await pool.query(
            `UPDATE customers SET status = $1 WHERE id = $2 RETURNING *`,
            [status, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Customer not found' });
        }
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        console.error("Patch Error:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});