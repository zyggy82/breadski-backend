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

// POST new product
app.post("/products", async (req, res) => {
  const { name, category, active } = req.body;
  try {
    await pool.query(
      "INSERT INTO products (name, category, active) VALUES ($1, $2, $3)",
      [name, category, active]
    );
    res.sendStatus(201);
  } catch (error) {
    console.error("Error adding product:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// PUT update product
app.put("/products/:id", async (req, res) => {
  const { id } = req.params;
  const { name, category, active } = req.body;
  try {
    await pool.query(
      "UPDATE products SET name = $1, category = $2, active = $3 WHERE id = $4",
      [name, category, active, id]
    );
    res.sendStatus(200);
  } catch (error) {
    console.error("Error updating product:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE product
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

app.get("/products-full", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM products ORDER BY category, name");
    res.json(result.rows);
  } catch (error) {
    console.error("Error loading full products:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// GET all messages
app.get("/messages", async (req, res) => {
  try {
    const result = await pool.query("SELECT id, content, created_at, recipients FROM messages ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (error) {
    console.error("Message fetch error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// POST new message
app.post("/messages", async (req, res) => {
  const { content, recipients } = req.body;
  try {
    await pool.query(
      "INSERT INTO messages (content, recipients) VALUES ($1, $2)",
      [content, recipients]
    );
    res.sendStatus(201);
  } catch (error) {
    console.error("Message insert error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// GET all orders
app.get("/orders", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, client_login, client_name, created_at, delivery_date, order_type, message, products FROM orders ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Order fetch error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// GET groups assigned to a client
app.get("/client-groups/:clientId", async (req, res) => {
  const { clientId } = req.params;
  try {
    const result = await pool.query(
      "SELECT group_name FROM client_product_groups WHERE client_id = $1",
      [clientId]
    );
    res.json(result.rows.map(r => r.group_name));
  } catch (error) {
    console.error("Error fetching client groups:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// POST assign a group to a client
app.post("/client-groups", async (req, res) => {
  const { client_id, group_name } = req.body;
  try {
    await pool.query(
      "INSERT INTO client_product_groups (client_id, group_name) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [client_id, group_name]
    );
    res.sendStatus(201);
  } catch (error) {
    console.error("Error assigning group to client:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE a group from a client
app.delete("/client-groups", async (req, res) => {
  const { client_id, group_name } = req.body;
  try {
    await pool.query(
      "DELETE FROM client_product_groups WHERE client_id = $1 AND group_name = $2",
      [client_id, group_name]
    );
    res.sendStatus(200);
  } catch (error) {
    console.error("Error removing client group:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// GET all product groups
app.get("/groups", async (req, res) => {
  try {
    const result = await pool.query("SELECT id, name FROM product_groups ORDER BY name");
    res.json(result.rows);
  } catch (error) {
    console.error("Group fetch error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.listen(3000, () => {
  console.log("✅ Server is running on port 3000");
});