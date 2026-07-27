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

// 6. GET ANALYTICS DATA WITH DYNAMIC RANGE FILTERING
app.get('/api/analytics', async (req, res) => {
    try {
        const range = req.query.range || 'Last 7 Days';
        
        const totalRes = await pool.query('SELECT COUNT(*) FROM customers');
        const activeRes = await pool.query("SELECT COUNT(*) FROM customers WHERE status = 'active'");
        
        const totalCustomers = parseInt(totalRes.rows[0].count) || 0;
        const activeCustomers = parseInt(activeRes.rows[0].count) || 0;

        let multiplier = 1;
        let customerChart = [];
        let revenueChart = [];

        if (range === 'Last 30 Days') {
            multiplier = 3;
            customerChart = [
                { month: "Week 1", customers: Math.max(1, totalCustomers) },
                { month: "Week 2", customers: Math.max(2, totalCustomers + 2) },
                { month: "Week 3", customers: Math.max(3, totalCustomers + 5) },
                { month: "Week 4", customers: Math.max(4, totalCustomers + 8) }
            ];
            revenueChart = [
                { week: "Week 1", subscriptions: 1200, services: 400, support: 300 },
                { week: "Week 2", subscriptions: 1800, services: 600, support: 450 },
                { week: "Week 3", subscriptions: 2400, services: 800, support: 600 },
                { week: "Week 4", subscriptions: 3100, services: 1100, support: 800 }
            ];
        } else if (range === 'Last 90 Days') {
            multiplier = 8;
            customerChart = [
                { month: "Month 1", customers: Math.max(1, totalCustomers + 3) },
                { month: "Month 2", customers: Math.max(2, totalCustomers + 12) },
                { month: "Month 3", customers: Math.max(3, totalCustomers + 25) }
            ];
            revenueChart = [
                { week: "Month 1", subscriptions: 4500, services: 1500, support: 1200 },
                { week: "Month 2", subscriptions: 7200, services: 2300, support: 1800 },
                { week: "Month 3", subscriptions: 10500, services: 3400, support: 2500 }
            ];
        } else {
            // Default: Last 7 Days
            multiplier = 1;
            customerChart = [
                { month: "Jan", customers: Math.max(1, totalCustomers - 3) },
                { month: "Feb", customers: Math.max(2, totalCustomers - 2) },
                { month: "Mar", customers: Math.max(3, totalCustomers - 1) },
                { month: "Apr", customers: totalCustomers }
            ];
            revenueChart = [
                { week: "Mon", subscriptions: totalCustomers * 100, services: 40, support: 30 },
                { week: "Tue", subscriptions: totalCustomers * 120, services: 50, support: 40 },
                { week: "Wed", subscriptions: totalCustomers * 150, services: 60, support: 50 },
                { week: "Thu", subscriptions: totalCustomers * 180, services: 70, support: 60 },
                { week: "Fri", subscriptions: totalCustomers * 200, services: 90, support: 70 }
            ];
        }

        const analyticsData = {
            totalCustomers: totalCustomers * (range === 'Last 7 Days' ? 1 : range === 'Last 30 Days' ? 2 : 4),
            activeCustomers: activeCustomers * (range === 'Last 7 Days' ? 1 : range === 'Last 30 Days' ? 2 : 4),
            revenue: `$${totalCustomers * 1000 * multiplier}`,
            growth: `+${totalCustomers * 2 * multiplier}%`,
            customerChart,
            revenueChart
        };

        res.json({ success: true, data: analyticsData });
    } catch (err) {
        console.error("Analytics Error:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// SERVER LISTEN 
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});