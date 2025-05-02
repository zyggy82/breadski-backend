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

app.get("/", (req, res) => {
  res.send("Breadski API is live");
});

app.get("/next-order-number", (req, res) => {
  res.json({ orderNumber: orderCounter++ });
});

app.post("/login", async (req, res) => {
  const { login, password } = req.body;
  try {
    const result = await pool.query(`
      SELECT
        c.name,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT dd.day), NULL) AS delivery_days,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT cpg.group_name), NULL) AS groups
      FROM clients c
      LEFT JOIN client_delivery_days dd ON c.id = dd.client_id
      LEFT JOIN client_product_groups cpg ON c.id = cpg.client_id
      WHERE c.login = $1 AND c.password = $2
      GROUP BY c.id
    `, [login.toUpperCase(), password]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid login or password" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Login error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});
app.get("/clients", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        c.id, c.login, c.name,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT dd.day), NULL) AS delivery_days,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT cpg.group_name), NULL) AS groups
      FROM clients c
      LEFT JOIN client_delivery_days dd ON c.id = dd.client_id
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
    const clientRes = await pool.query(
      "INSERT INTO clients (login, name, password) VALUES ($1, $2, $3) RETURNING id",
      [login.toUpperCase(), name, password]
    );
    const clientId = clientRes.rows[0].id;

    if (Array.isArray(delivery_days)) {
      for (const day of delivery_days) {
        await pool.query("INSERT INTO client_delivery_days (client_id, day) VALUES ($1, $2)", [clientId, day]);
      }
    }

    if (Array.isArray(groups)) {
      for (const group of groups) {
        await pool.query("INSERT INTO client_product_groups (client_id, group_name) VALUES ($1, $2)", [clientId, group]);
      }
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
  const clientId = parseInt(id, 10);
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");

    if (password && password.trim() !== "") {
      await tx.query(
        "UPDATE clients SET login = $1, name = $2, password = $3 WHERE id = $4",
        [login.toUpperCase(), name, password, clientId]
      );
    } else {
      await tx.query(
        "UPDATE clients SET login = $1, name = $2 WHERE id = $3",
        [login.toUpperCase(), name, clientId]
      );
    }

    await tx.query("DELETE FROM client_product_groups WHERE client_id = $1", [clientId]);
    await tx.query("DELETE FROM client_delivery_days WHERE client_id = $1", [clientId]);

    if (Array.isArray(groups)) {
      for (const group of groups) {
        await tx.query("INSERT INTO client_product_groups (client_id, group_name) VALUES ($1, $2)", [clientId, group]);
      }
    }

    if (Array.isArray(delivery_days)) {
      for (const day of delivery_days) {
        await tx.query("INSERT INTO client_delivery_days (client_id, day) VALUES ($1, $2)", [clientId, day]);
      }
    }

    await tx.query("COMMIT");
    res.sendStatus(200);
  } catch (err) {
    await tx.query("ROLLBACK");
    console.error("Client update error:", err);
    res.status(500).json({ error: "Server error" });
  } finally {
    tx.release();
  }
});

app.delete("/clients/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM clients WHERE id = $1", [req.params.id]);
    res.sendStatus(200);
  } catch (error) {
    console.error("Client delete error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});
app.post("/products", async (req, res) => {
  const { login, day } = req.body;
  try {
    const result = await pool.query(
      `SELECT
         p.id, p.name, p.category, p.group_id, pg.name AS group_name
       FROM products p
       JOIN product_groups pg ON p.group_id = pg.id
       JOIN product_delivery_days pdd ON p.id = pdd.product_id
       JOIN client_product_groups cpg ON pg.name = cpg.group_name
       JOIN clients c ON cpg.client_id = c.id
       WHERE c.login = $1 AND pdd.day = $2 AND p.active = TRUE
       ORDER BY p.group_id, p.id`,
      [login.toUpperCase(), day]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Product fetch error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/send", async (req, res) => {
  const { login, deliveryDate, orderType, note, items } = req.body;
  try {
    const clientRes = await pool.query("SELECT id, name FROM clients WHERE login = $1", [login.toUpperCase()]);
    if (clientRes.rows.length === 0) return res.status(404).json({ error: "Client not found" });

    const { id: clientId, name: clientName } = clientRes.rows[0];
    const numRes = await pool.query("SELECT COALESCE(MAX(order_number), 0) + 1 AS next_number FROM orders");
    const orderNumber = numRes.rows[0].next_number;

    await pool.query(
      "INSERT INTO orders (client_id, order_number, delivery_date, order_type, note, items) VALUES ($1, $2, $3, $4, $5, $6::jsonb)",
      [clientId, orderNumber, deliveryDate, orderType, note, JSON.stringify(items)]
    );

    const transporter = nodemailer.createTransport({
      host: "lh164.dnsireland.com",
      port: 465,
      secure: true,
      auth: {
        user: "apk@thebreadskibrothers.ie",
        pass: "N]dKOKe#V%o1"
      }
    });

    const subject = `Zamówienie ${clientName} ${new Date().toLocaleDateString("pl-PL")} #${orderNumber}`;
    const text = [
      `Klient: ${clientName}`,
      `Typ: ${orderType === "full" ? "Pełne" : "Uzupełniające"}`,
      `Data dostawy: ${new Date(deliveryDate).toLocaleDateString("pl-PL")}`,
      `Notatka: ${note || "-"}`,
      "",
      "Pozycje:",
      ...items.map(i => `- ${i.name}: ${i.qty}`)
    ].join("\n");

    await transporter.sendMail({
      from: '"Breadski Orders" <apk@thebreadskibrothers.ie>',
      to: "orders@thebreadskibrothers.ie",
      subject,
      text
    });

    res.sendStatus(200);
  } catch (err) {
    console.error("Send error:", err.message);
    res.status(500).json({ error: "Failed to send order" });
  }
});

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

app.get("/messages/latest/:login", async (req, res) => {
  const { login } = req.params;
  try {
    const result = await pool.query(
      `SELECT content, created_at FROM messages
       WHERE recipients IS NULL OR recipients @> ARRAY[$1]
       ORDER BY created_at DESC LIMIT 1`,
      [login.toUpperCase()]
    );
    res.json(result.rows[0] || null);
  } catch (error) {
    console.error("Latest message fetch error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/groups", async (req, res) => {
  try {
    const result = await pool.query("SELECT id, name FROM product_groups ORDER BY id");
    res.json(result.rows);
  } catch (error) {
    console.error("Group fetch error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/product-groups", async (req, res) => {
  try {
    const result = await pool.query("SELECT id, name FROM product_groups ORDER BY id");
    res.json(result.rows);
  } catch (error) {
    console.error("Alias group fetch error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.listen(3000, () => {
  console.log("✅ Server is running on port 3000");
});
