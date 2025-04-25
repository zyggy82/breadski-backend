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
      `SELECT
         c.name,
         c.delivery_days,
         ARRAY_REMOVE(ARRAY_AGG(cpg.group_name),NULL) AS groups
       FROM clients c
       LEFT JOIN client_product_groups cpg
         ON c.id = cpg.client_id
       WHERE c.login = $1
         AND c.password = $2
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


// CLIENTS
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
    const clientRes = await pool.query(
      "INSERT INTO clients (login, name, delivery_days, password) VALUES ($1, $2, $3, $4) RETURNING id",
      [login.toUpperCase(), name, delivery_days.split(",").map(d => d.trim()), password]
    );
    const clientId = clientRes.rows[0].id;

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

// PUT update client + its groups, with optional password change
app.put("/clients/:id", async (req, res) => {
  const { id } = req.params;
  const { login, name, delivery_days, password, groups } = req.body;

  const clientId = parseInt(id, 10);
  const clientLogin = login.toUpperCase();
  const daysArray = delivery_days.split(",").map((d) => d.trim());

  // SQL do aktualizacji klienta z hasłem
  const clientUpdWithPwd = `
    UPDATE clients
       SET login = $1,
           name = $2,
           delivery_days = $3,
           password = $4
     WHERE id = $5
  `;
  // SQL do aktualizacji klienta bez zmiany hasła
  const clientUpdNoPwd = `
    UPDATE clients
       SET login = $1,
           name = $2,
           delivery_days = $3
     WHERE id = $4
  `;

  const deleteOldGroups = `
    DELETE FROM client_product_groups
     WHERE client_id = $1
  `;
  const insertGroup = `
    INSERT INTO client_product_groups (client_id, group_name)
         VALUES ($1, $2)
  `;

  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");

    // 1) Aktualizacja danych klienta (opcjonalnie z hasłem)
    if (password && password.trim() !== "") {
      await tx.query(clientUpdWithPwd, [
        clientLogin,
        name,
        daysArray,
        password,
        clientId,
      ]);
    } else {
      await tx.query(clientUpdNoPwd, [
        clientLogin,
        name,
        daysArray,
        clientId,
      ]);
    }

    // 2) Usuń stare grupy
    await tx.query(deleteOldGroups, [clientId]);

    // 3) Wstaw nowe grupy (jeśli jakiekolwiek przyszły)
    if (Array.isArray(groups)) {
      for (const grp of groups) {
        // zakładam, że to nazwa grupy (group_name), a nie id
        await tx.query(insertGroup, [clientId, grp]);
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

// GROUPS
app.get("/groups", async (req, res) => {
  try {
    const result = await pool.query("SELECT id, name FROM product_groups ORDER BY name");
    res.json(result.rows);
  } catch (error) {
    console.error("Group fetch error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// PRODUCTS
app.get("/products-full", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.id, p.name, p.category, p.active, p.group_id, pg.name AS group_name
      FROM products p
      LEFT JOIN product_groups pg ON p.group_id = pg.id
      ORDER BY p.category, p.name
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error loading full products:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/products", async (req, res) => {
  const { login } = req.body;

  try {
    const result = await pool.query(
      `SELECT
         p.id,
         p.name,
         p.category
       FROM products p
       JOIN product_groups pg
         ON p.group_id = pg.id
       JOIN client_product_groups cpg
         ON pg.name = cpg.group_name
       JOIN clients c
         ON cpg.client_id = c.id
       WHERE c.login = $1
         AND p.active = TRUE
       ORDER BY p.category, p.name`,
      [login.toUpperCase()]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Product fetch error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});


app.put("/products/:id", async (req, res) => {
  const { id } = req.params;
  const { name, category, active, group_id } = req.body;
  try {
    await pool.query(
      "UPDATE products SET name = $1, category = $2, active = $3, group_id = $4 WHERE id = $5",
      [name, category, active, group_id || null, id]
    );
    res.sendStatus(200);
  } catch (error) {
    console.error("Error updating product:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/products/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM products WHERE id = $1", [req.params.id]);
    res.sendStatus(200);
  } catch (error) {
    console.error("Error deleting product:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// MESSAGES
app.get("/messages", async (req, res) => {
  try {
    const result = await pool.query("SELECT id, content, created_at, recipients FROM messages ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (error) {
    console.error("Message fetch error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// Pobierz wszystkie grupy produktowe
app.get("/product-groups", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT name FROM product_groups ORDER BY name"
    );
    // zwracamy tablicę obiektów { name }
    res.json(result.rows);
  } catch (error) {
    console.error("Product-groups fetch error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

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

// EMAIL SEND
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

// GET latest message for a specific login
app.get("/messages/latest/:login", async (req, res) => {
  const { login } = req.params;

  try {
    const result = await pool.query(
      `SELECT content, created_at 
       FROM messages 
       WHERE 
         recipients IS NULL 
         OR recipients @> ARRAY[$1] 
       ORDER BY created_at DESC 
       LIMIT 1`,
      [login.toUpperCase()]
    );

    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.json(null); // brak wiadomości
    }
  } catch (error) {
    console.error("Latest message fetch error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

app.listen(3000, () => {
  console.log("✅ Server is running on port 3000");
});
