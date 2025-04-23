
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const { Pool } = require("pg");
const bodyParser = require("body-parser");

const app = express();
app.use(cors());
app.use(bodyParser.json());

const pool = new Pool({
  connectionString: "postgresql://breadski_db_user:tt1Cx4TGFVW3fNR3p62a6S26hblArm2Q@dpg-d0491615pdvs73c5hlvg-a.frankfurt-postgres.render.com/breadski_db",
  ssl: { rejectUnauthorized: false },
});

const transporter = nodemailer.createTransport({
  host: "lh164.dnsireland.com",
  port: 587,
  secure: false,
  auth: {
    user: "apk@thebreadskibrothers.ie",
    pass: "N]dKOKe#V%o1",
  },
});

app.post("/send", async (req, res) => {
  const { login, message } = req.body;

  try {
    const result = await pool.query("SELECT name FROM clients WHERE login = $1", [login.toUpperCase()]);
    const client = result.rows[0];

    if (!client) {
      return res.status(404).json({ error: "Nie znaleziono klienta w bazie" });
    }

    const subject = `Zamówienie [${client.name}] ${new Date().toLocaleDateString("pl-PL")}`;
    await transporter.sendMail({
      from: "apk@thebreadskibrothers.ie",
      to: "orders@thebreadskibrothers.ie",
      subject,
      text: message,
    });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Błąd podczas wysyłki:", error.message);
    res.status(500).json({ error: "Błąd serwera: " + error.message });
  }
});

app.post("/products", async (req, res) => {
  try {
    const result = await pool.query("SELECT category, name FROM products ORDER BY category, name");
    res.json(result.rows);
  } catch (error) {
    console.error("Błąd przy pobieraniu produktów:", error.message);
    res.status(500).json({ error: "Błąd serwera" });
  }
});

app.post("/login", async (req, res) => {
  const { login, password } = req.body;
  try {
    const result = await pool.query("SELECT name, delivery_days FROM clients WHERE login = $1 AND password = $2", [login.toUpperCase(), password]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Nieprawidłowy login lub hasło" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Błąd logowania:", error.message);
    res.status(500).json({ error: "Błąd serwera" });
  }
});

app.get("/", (_, res) => {
  res.send("Breadski backend + PostgreSQL is running.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});
