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

app.get("/next-order-number", (req, res) => {
  res.json({ orderNumber: orderCounter++ });
});

app.post("/login", async (req, res) => {
  const { login, password } = req.body;
  try {
    const result = await pool.query(
      "SELECT name, delivery_days FROM clients WHERE login = $1 AND password = $2",
      [login.toUpperCase(), password]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid login or password" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Login error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/products", async (req, res) => {
  try {
    const result = await pool.query("SELECT category, name FROM products ORDER BY category, name");
    res.json(result.rows);
  } catch (error) {
    console.error("Product fetch error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// GET all clients
app.get("/clients", async (req, res) => {
  try {
    const result = await pool.query("SELECT id, login, name, delivery_days FROM clients ORDER BY login");
    res.json(result.rows);
  } catch (error) {
    console.error("Client fetch error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// POST new client
app.post("/clients", async (req, res) => {
  const { login, name, delivery_days, password } = req.body;
  try {
    await pool.query(
      "INSERT INTO clients (login, name, delivery_days, password) VALUES ($1, $2, $3, $4)",
      [login.toUpperCase(), name, delivery_days.split(",").map(day => day.trim()), password]
    );
    res.sendStatus(201);
  } catch (error) {
    console.error("Client insert error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// PUT update client
app.put("/clients/:id", async (req, res) => {
  const { id } = req.params;
  const { login, name, delivery_days, password } = req.body;
  try {
    await pool.query(
      "UPDATE clients SET login = $1, name = $2, delivery_days = $3, password = $4 WHERE id = $5",
      [login.toUpperCase(), name, delivery_days.split(",").map(day => day.trim()), password, id]
    );
    res.sendStatus(200);
  } catch (error) {
    console.error("Client update error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE client
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

app.post("/send", async (req, res) => {
  const { login, subject, message } = req.body;

  try {
    const result = await pool.query("SELECT name FROM clients WHERE login = $1", [login.toUpperCase()]);
    const client = result.rows[0];

    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

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

app.get("/clients", async (req, res) => {
  try {
    const result = await pool.query("SELECT id, login, name, delivery_days FROM clients ORDER BY id");
    res.json(result.rows);
  } catch (error) {
    console.error("Client fetch error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.listen(3000, () => {
  console.log("✅ Server is running on port 3000");
});