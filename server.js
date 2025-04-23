const express = require("express");
const nodemailer = require("nodemailer");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: "postgresql://breadski_db_user:tt1Cx4TGFVW3fNR3p62a6S26hblArm2Q@dpg-d0491615pdvs73c5hlvg-a.frankfurt-postgres.render.com/breadski_db"
});

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "your-email@gmail.com",       // <- zamień na swój e-mail
    pass: "your-email-password-or-app-password"
  }
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
    console.error("Error fetching products:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/next-order-number", async (req, res) => {
  try {
    const result = await pool.query(`
      UPDATE order_counters
      SET last_order_number = last_order_number + 1
      RETURNING last_order_number;
    `);
    res.json({ orderNumber: result.rows[0].last_order_number });
  } catch (error) {
    console.error("Error generating order number:", error.message);
    res.status(500).json({ error: "Failed to generate order number" });
  }
});

app.post("/send", async (req, res) => {
  const { login, subject, message } = req.body;

  try {
    const result = await pool.query("SELECT name FROM clients WHERE login = $1", [login.toUpperCase()]);
    const client = result.rows[0];

    if (!client) {
      return res.status(404).json({ error: "Client not found in database" });
    }

    await transporter.sendMail({
      from: '"Breadski Orders" <your-email@gmail.com>',
      to: "recipient@example.com", // <- zamień na adres docelowy
      subject,
      text: message
    });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Email sending error:", error.message);
    res.status(500).json({ error: "Failed to send email" });
  }
});

app.listen(port, () => {
  console.log(`✅ Server is running on port ${port}`);
});
