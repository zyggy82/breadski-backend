const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: "postgresql://breadski_db_user:tt1Cx4TGFVW3fNR3p62a6S26hblArm2Q@dpg-d0491615pdvs73c5hlvg-a.frankfurt-postgres.render.com/breadski_db",
  ssl: { rejectUnauthorized: false }
});

let orderCounter = 1;

// Login
app.post("/login", async (req, res) => {
  const { login, password } = req.body;
  try {
    const result = await pool.query(
      "SELECT name, delivery_days FROM clients WHERE login = $1 AND password = $2",
      [login.toUpperCase(), password]
    );
    if (result.rows.length === 0) return res.status(401).json({ error: "Invalid login or password" });
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Login error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// Get products for client app
app.post("/products", async (req, res) => {
  try {
    const result = await pool.query("SELECT category, name FROM products WHERE active = true ORDER BY category, name");
    res.json(result.rows);
  } catch (error) {
    console.error("Product fetch error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// Admin: Get all products (full)
app.get("/products-full", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM products ORDER BY category, name");
    res.json(result.rows);
  } catch (error) {
    console.error("Error loading full products:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// Admin: CRUD products
app.post("/products", async (req, res) => {
  const { name, category, active } = req.body;
  try {
    await pool.query("INSERT INTO products (name, category, active) VALUES ($1, $2, $3)", [name, category, active]);
    res.sendStatus(201);
  } catch (error) {
    console.error("Error adding product:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/products/:id", async (req, res) => {
  const { id } = req.params;
  const { name, category, active } = req.body;
  try {
    await pool.query("UPDATE products SET name = $1, category = $2, active = $3 WHERE id = $4", [name, category, active, id]);
    res.sendStatus(200);
  } catch (error) {
    console.error("Error updating product:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/products/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM products WHERE id = $1", [id]);
    res.sendStatus(200);
  } catch (error) {
    console.error("Error deleting product:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// Admin: Get all clients (with product groups)
app.get("/clients", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        c.id, c.login, c.name, c.delivery_days, 
        ARRAY_REMOVE(ARRAY_AGG(cpg.group_name), NULL) AS groups
      FROM clients c
      LEFT JOIN client_product_groups cpg ON c.id = cpg.client_id
      GROUP BY c.id
      ORDER BY c.id
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Client fetch error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/clients", async (req, res) => {
  const { login, name, delivery_days, password, groups } = req.body;
  try {
    const clientResult = await pool.query(
      "INSERT INTO clients (login, name, delivery_days, password) VALUES ($1, $2, $3, $4) RETURNING id",
      [login.toUpperCase(), name, delivery_days.split(",").map(d => d.trim()), password]
    );
    const clientId = clientResult.rows[0].id;
    for (const groupId of groups || []) {
      await pool.query("INSERT INTO client_product_groups (client_id, group_id) VALUES ($1, $2)", [clientId, groupId]);
    }
    res.sendStatus(201);
  } catch (error) {
    console.error("Client insert error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/clients/:id", async (req, res) => {
  const { id } = req.params;
  const { login, name, delivery_days, password, groups } = req.body;
  try {
    await pool.query("UPDATE clients SET login = $1, name = $2, delivery_days = $3, password = $4 WHERE id = $5", [
      login.toUpperCase(), name, delivery_days.split(",").map(d => d.trim()), password, id
    ]);
    await pool.query("DELETE FROM client_product_groups WHERE client_id = $1", [id]);
    for (const groupId of groups || []) {
      await pool.query("INSERT INTO client_product_groups (client_id, group_id) VALUES ($1, $2)", [id, groupId]);
    }
    res.sendStatus(200);
  } catch (error) {
    console.error("Client update error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/clients/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM clients WHERE id = $1", [id]);
    res.sendStatus(200);
  } catch (error) {
    console.error("Client delete error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// Product groups (for assignment)
app.get("/groups", async (req, res) => {
  try {
    const result = await pool.query("SELECT id, name FROM product_groups ORDER BY name");
    res.json(result.rows);
  } catch (error) {
    console.error("Group fetch error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// Messages
app.get("/messages", async (req, res) => {
  try {
    const result = await pool.query("SELECT id, content, created_at, recipients FROM messages ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (error) {
    console.error("Message fetch error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/messages", async (req, res) => {
  const { content, recipients } = req.body;
  try {
    await pool.query("INSERT INTO messages (content, recipients) VALUES ($1, $2)", [content, recipients]);
    res.sendStatus(201);
  } catch (error) {
    console.error("Message insert error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// Email sending
app.post("/send", async (req, res) => {
  const { login, subject, message } = req.body;
  try {
    const result = await pool.query("SELECT name FROM clients WHERE login = $1", [login.toUpperCase()]);
    const client = result.rows[0];
    if (!client) return res.status(404).json({ error: "Client not found" });

    const transporter = nodemailer.createTransport({
      host: "lh164.dnsireland.com",
      port: 465,
      secure: true,
      auth: {
        user: "apk@thebreadskibrothers.ie",
        pass: "N]dKOKe#V%o1"
      }
    });

    await transporter.sendMail({
      from: '"Breadski Orders" <apk@thebreadskibrothers.ie>',
      to: "orders@thebreadskibrothers.ie",
      subject,
      text: message
    });

    res.sendStatus(200);
  } catch (error) {
    console.error("Email sending error:", error.message);
    res.status(500).json({ error: "Failed to send email" });
  }
});

// Order number for frontend
app.get("/next-order-number", (req, res) => {
  res.json({ orderNumber: orderCounter++ });
});

app.listen(3000, () => {
  console.log("✅ Server is running on port 3000");
});