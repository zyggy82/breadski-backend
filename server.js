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
    const result = await pool.query(
      `SELECT
         c.name,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT dd.day), NULL) AS delivery_days,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT cpg.group_name), NULL) AS groups
       FROM clients c
       LEFT JOIN client_delivery_days dd ON c.id = dd.client_id
       LEFT JOIN client_product_groups cpg ON c.id = cpg.client_id
       WHERE c.login = $1 AND c.password = $2
       GROUP BY c.id`,
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

    if (delivery_days && delivery_days.length > 0) {
      for (const day of delivery_days) {
        await pool.query("INSERT INTO client_delivery_days (client_id, day) VALUES ($1, $2)", [clientId, day]);
      }
    }

    if (groups && groups.length > 0) {
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
  const clientLogin = login.toUpperCase();

  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");

    if (password && password.trim() !== "") {
      await tx.query(
        "UPDATE clients SET login = $1, name = $2, password = $3 WHERE id = $4",
        [clientLogin, name, password, clientId]
      );
    } else {
      await tx.query(
        "UPDATE clients SET login = $1, name = $2 WHERE id = $3",
        [clientLogin, name, clientId]
      );
    }

    await tx.query("DELETE FROM client_product_groups WHERE client_id = $1", [clientId]);
    await tx.query("DELETE FROM client_delivery_days WHERE client_id = $1", [clientId]);

    if (Array.isArray(groups)) {
      for (const grp of groups) {
        await tx.query("INSERT INTO client_product_groups (client_id, group_name) VALUES ($1, $2)", [clientId, grp]);
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

app.post("/products", async (req, res) => {
  const { login, day } = req.body;
  try {
    const result = await pool.query(
      `SELECT
         p.id,
         p.name,
         p.category,
         p.group_id,
         pg.name AS group_name
       FROM products p
       JOIN product_groups pg ON p.group_id = pg.id
       JOIN product_delivery_days pdd ON p.id = pdd.product_id
       JOIN client_product_groups cpg ON pg.name = cpg.group_name
       JOIN clients c ON cpg.client_id = c.id
       WHERE c.login = $1 AND pdd.day = $2 AND p.active = TRUE
       ORDER BY p.group_id, p.name`,
      [login.toUpperCase(), day]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Product fetch error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

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

app.post("/login", async (req, res) => {
  const { login, password } = req.body;
  try {
    const result = await pool.query(
      `SELECT
         c.name,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT dd.day), NULL) AS delivery_days,
         ARRAY_REMOVE(ARRAY_AGG(DISTINCT cpg.group_name), NULL) AS groups
       FROM clients c
       LEFT JOIN client_delivery_days dd ON c.id = dd.client_id
       LEFT JOIN client_product_groups cpg ON c.id = cpg.client_id
       WHERE c.login = $1 AND c.password = $2
       GROUP BY c.id`,
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

app.listen(3000, () => { console.log("✅ Server is running on port 3000"); });