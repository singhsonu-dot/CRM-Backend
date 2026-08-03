const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const Razorpay = require('razorpay');
const crypto = require('crypto'); 
const { receiveMessageOnPort } = require('worker_threads');

const nodemailer = require("nodemailer")

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

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
); 

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS, 
    },
}); 

const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer')) {
        return res.status(401).json({ success: false, error: 'Unauthorized: No token provided' })
    }

    const token = authHeader.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
        return res.status(401).json({ success: false, error: 'Invalid or expired token' })
    }

    req.user = user;
    next();
};

const checkRole = (allowedRoles) => {
    return (req, res, next) => {
        console.log("App Metadata Role:", req.user?.app_metadata?.role)
        console.log("User Metadata Role:", req.user?.user_metadata?.role)
        const userRole = req.user?.app_metadata?.role || req.user?.user_metadata?.role || 'user';
        console.log("Final Extracted Role:", userRole)

        if (!allowedRoles.includes(userRole)) {
            return res.status(403).json({ success: false, error: 'Forbidden: Access denied for your role'});
        }
        next();

    };
};

// 1. GET ALL CUSTOMERS
app.get('/api/customers', verifyToken, async (req, res) => {
    try {
        const currentUserId = req.user.id 
        const result = await pool.query('SELECT * FROM customers WHERE user_id =$1 ORDER BY id DESC', [currentUserId]); 
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
app.post('/api/customers', verifyToken, async (req, res) => {
    const { name, email, phone, status, website } = req.body;
    const currentUserId = req.user.id 
    try {
        const result = await pool.query(
            `INSERT INTO customers (name, email, phone, status, user_id, website)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [name, email, phone, status || 'active', currentUserId, website]
        );

        res.status(201).json({ success: true, data: result.rows[0] });
    } catch (err) {
        console.error("Postgres Error:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. UPDATE CUSTOMER (PUT)
app.put('/api/customers/:id', verifyToken, async (req, res) => {
    const { id } = req.params;
    const { name, email, phone, status, website } = req.body;
    try {
        const result = await pool.query(
            `UPDATE customers
             SET name = $1, email = $2, phone = $3, status = $4, website = $5
             WHERE id = $6 AND user_id = $7
             RETURNING *`,
            [name, email, phone, status, website, id, req.user.id]
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
app.delete('/api/customers/:id', verifyToken, async (req, res) => {
    const { id } = req.params
    try{
        const result = await pool.query(
            'DELETE FROM customers WHERE id = $1 AND user_id = $2 RETURNING *', 
            [id, req.user.id]
        )

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Customer not found or unauthorized' })
        }

        res.json({ success: true, message: 'Customer deleted successfully' })
    } catch (err) {
        console.error(err.message)
        res.status(500).json({ success: false, error: err.message})
    }
})

// 5. TOGGLE STATUS ONLY (PATCH)
app.patch('/api/customers/:id/status', verifyToken, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    try {
        const result = await pool.query(
            `UPDATE customers SET status = $1 WHERE id = $2 AND user_id = $3 RETURNING *`,
            [status, id, req.user.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Customer not found or unauthorized' });
        }
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        console.error("Patch Error:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 6. GET ANALYTICS DATA WITH DYNAMIC RANGE FILTERING
app.get('/api/analytics', verifyToken, async (req, res) => {
    try {
        const range = req.query.range || 'Last 7 Days';
        
        const totalRes = await pool.query('SELECT COUNT(*) FROM customers WHERE user_id =$1', [req.user.id]);
        const activeRes = await pool.query("SELECT COUNT(*) FROM customers WHERE status = 'active' AND user_id = $1", [req.user.id]);
        
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

// Endpoint 1: Create Razorpay Order
app.post('/api/subscription/create-order', verifyToken, async (req, res) => {
    try {
        const { plan } = req.body;
        let amount = 0;

        if (plan === 'pro') amount = 2900;
        if (plan === 'enterprise') amount = 9900;

        if (amount === 0) {
            return res.status(400).json({ success: false, error: "Free plan does not require payment" });
        }

        const options = {
            amount: amount * 100,
            currency: "INR",
            receipt: `receipt_${Date.now()}`,
            notes: {
                user_id: req.user.id,
                plan_type: plan
            }
        };

        const order = await razorpay.orders.create(options);
        res.json({ success: true, order, key: process.env.RAZORPAY_KEY_ID });
    } catch (err) {
        console.error("Order Creation Error:", err.message);
        res.status(500).json({ success: false, error: err.message });
    }
}); 

// Endpoint 2: Verify Payment & Upgrade Plan
app.post('/api/subscription/verify-payment', verifyToken, async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan } = req.body;

        // 1. Signature Verify 
        const body = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(body.toString())
            .digest('hex');

        if (expectedSignature !== razorpay_signature) {
            return res.status(400).json({ success: false, error: "Invalid payment signature!" });
        }

        // 2. Limit calculate 
        let customerLimit = 10;
        if (plan === 'pro') customerLimit = 100;
        if (plan === 'enterprise') customerLimit = 999999;

        // 3. Simple Clean DB Update Query (No fallback, direct users table)
        await pool.query(
            'UPDATE customers SET plan = $1, customer_limit = $2 WHERE user_id = $3',
            [plan, customerLimit, req.user.id]
        );

        return res.json({ success: true, message: `Successfully upgraded to ${plan.toUpperCase()} plan!` });

    } catch (err) {
        console.error("Verify Payment Error:", err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// Current plan fetch karne ke liye API
app.get('/api/subscription/current-plan', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;

        const result = await pool.query(
            'SELECT plan FROM customers WHERE user_id = $1 LIMIT 1',
            [userId]
        );

        if (result.rows.length === 0) {
            return res.json({ plan: 'free' }); // Default plan agar user na mile
        }

        res.json({ plan: result.rows[0].plan || 'free' });
    } catch (error) {
        console.error("Error fetching plan:", error);
        res.status(500).json({ error: "Server error" });
    }
});

// Email Route
app.post("/api/v1/send-email", async (req, res) => {
    const { to, subject, message } = req.body 

    try {
        const mailOptions = {
            from: `"CRM Dashboard" <${process.env.EMAIL_USER}>`,
            to: to || process.env.EMAIL_USER,
            subject: subject || "CRM Notification Alert",
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
                    <h2 style="color: #2563eb;">CRM Notification Alert</h2>
                    <p style="font-size: 15px; color: #333;">${message || "Your setting/notification preference was updated successfully!"}</p>
                    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
                    <p style="font-size: 12px; color: #888;">This is an automated test notification from your CRM Dashboard.</p>
                </div>
            `,
        };

        const info = await transporter.sendMail(mailOptions) 
        console.log("Email sent: ", info.messageId)

        return res.status(200).json({
            success: true,
            message: "Email sent successfully!",
            messageId: info.messageId
        });
    } catch (error) {
        console.error("Nodemailer Error: ", error);
        return res.status(500).json({
            success: false,
            message: "Failed to send email alert",
            error: error.message
        });
    }
});

// SERVER LISTEN 
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
}); 