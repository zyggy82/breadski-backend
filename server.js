// === Importy bibliotek ===
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const { Pool } = require("pg");

// === Inicjalizacja aplikacji Express ===
const app = express();
app.use(cors()); // Zezwolenie na CORS dla wszystkich połączeń
app.use(express.json()); // Parsowanie JSON w ciele żądań

// === Konfiguracja połączenia z bazą danych PostgreSQL ===
const pool = new Pool({
  connectionString: "postgresql://breadski_db_user:tt1Cx4TGFVW3fNR3p62a6S26hblArm2Q@dpg-d0491615pdvs73c5hlvg-a.frankfurt-postgres.render.com/breadski_db",
  ssl: { rejectUnauthorized: false }
});

let orderCounter = 1; // Licznik zamówień

// === Endpointy ===

// Sprawdzenie, czy API działa
app.get("/", (req, res) => {
  res.send("Breadski API is live");
});

// Zwrócenie kolejnego numeru zamówienia
app.get("/next-order-number", (req, res) => {
  res.json({ orderNumber: orderCounter++ });
});

// Logowanie użytkownika
app.post("/login", async (req, res) => {
  const { login, password } = req.body;
  try {
    const result = await pool.query(`
      SELECT
        c.login,
        c.name,
        c.route,
        c.route_add,
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

    const client = result.rows[0];
    client.route_add = client.route_add ? client.route_add.split(",") : [];
    res.json(client);
  } catch (error) {
    console.error("Login error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});


// Pobranie listy klientów
app.get("/clients", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        c.id, 
        c.login, 
        c.name, 
        c.route, 
        c.route_add, 
        c.password,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT dd.day), NULL) AS delivery_days,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT cpg.group_name), NULL) AS groups
      FROM clients c
      LEFT JOIN client_delivery_days dd ON c.id = dd.client_id
      LEFT JOIN client_product_groups cpg ON c.id = cpg.client_id
      GROUP BY c.id
      ORDER BY c.id
    `);

    const clients = result.rows.map(row => ({
      ...row,
      route_add: row.route_add ? row.route_add.split(",") : []
    }));

    res.json(clients);
  } catch (error) {
    console.error("Client fetch error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});



// Dodanie nowego klienta
app.post("/clients", async (req, res) => {
  const { login, name, delivery_days, password, groups, route } = req.body;

  // Filtrowanie pustych wartości
  const filteredDeliveryDays = Array.isArray(delivery_days)
    ? delivery_days.filter(day => day && day.trim() !== '')
    : [];

  try {
    // Wstawienie klienta
    const clientRes = await pool.query(
      "INSERT INTO clients (login, name, password, route) VALUES ($1, $2, $3, $4) RETURNING id",
      [login.toUpperCase(), name, password, route]
    );
    const clientId = clientRes.rows[0].id;

    // Dodanie dni dostaw
    for (const day of filteredDeliveryDays) {
      await pool.query(
        "INSERT INTO client_delivery_days (client_id, day) VALUES ($1, $2)",
        [clientId, day]
      );
    }

    // Dodanie grup produktów
    if (Array.isArray(groups)) {
      for (const group of groups) {
        await pool.query(
          "INSERT INTO client_product_groups (client_id, group_name) VALUES ($1, $2)",
          [clientId, group]
        );
      }
    }

    res.sendStatus(201);
  } catch (error) {
    console.error("Client insert error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// Edycja danych klienta
app.put("/clients/:id", async (req, res) => {
  const { id } = req.params;
  const { login, name, password, delivery_days, groups, route, route_add } = req.body;
  const clientId = parseInt(id, 10);

  const filteredDeliveryDays = Array.isArray(delivery_days)
    ? delivery_days.filter(day => day && day.trim() !== '')
    : [];

  const tx = await pool.connect();

  try {
    await tx.query("BEGIN");

    await tx.query(
      `UPDATE clients 
       SET login = $1, 
           name = $2, 
           route = $3, 
           route_add = $4, 
           password = $5 
       WHERE id = $6`,
      [login.toUpperCase(), name, route, route_add.join(','), password, clientId]
    );

    // Usunięcie starych powiązań
    await tx.query("DELETE FROM client_product_groups WHERE client_id = $1", [clientId]);
    await tx.query("DELETE FROM client_delivery_days WHERE client_id = $1", [clientId]);

    // Dodanie nowych powiązań
    if (Array.isArray(groups)) {
      for (const group of groups) {
        await tx.query(
          "INSERT INTO client_product_groups (client_id, group_name) VALUES ($1, $2)",
          [clientId, group]
        );
      }
    }

    for (const day of filteredDeliveryDays) {
      await tx.query(
        "INSERT INTO client_delivery_days (client_id, day) VALUES ($1, $2)",
        [clientId, day]
      );
    }

    await tx.query("COMMIT");
    res.sendStatus(200);
  } catch (err) {
    await tx.query("ROLLBACK");
    console.error("Client update error:", err.message);
    res.status(500).json({ error: "Server error" });
  } finally {
    tx.release();
  }
});


// === Usuwanie klienta ===
app.delete("/clients/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM clients WHERE id = $1", [req.params.id]);
    res.sendStatus(200);
  } catch (error) {
    console.error("Client delete error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// === Pobieranie produktów dla danego klienta na określony dzień (aplikacja mobilna) ===
app.post("/products-client", async (req, res) => {
  const { login, day } = req.body;
  try {
    const result = await pool.query(`
      SELECT
        p.id, p.name, p.category, p.group_id, pg.name AS group_name
      FROM products p
      JOIN product_groups pg ON p.group_id = pg.id
      JOIN product_delivery_days pdd ON p.id = pdd.product_id
      JOIN client_product_groups cpg ON pg.name = cpg.group_name
      JOIN clients c ON cpg.client_id = c.id
      WHERE c.login = $1 AND pdd.day = $2 AND p.active = TRUE
      ORDER BY p.group_id, p.id
    `, [login.toUpperCase(), day]);
    res.json(result.rows);
  } catch (error) {
    console.error("Product fetch error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});


// === Wysyłanie zamówienia i powiadomienia e-mail ===
app.post("/send", async (req, res) => {
  const { login, deliveryDate, orderType, note, items } = req.body;
  try {
    // Pobranie danych klienta
    const clientRes = await pool.query("SELECT id, name FROM clients WHERE login = $1", [login.toUpperCase()]);
    if (clientRes.rows.length === 0) return res.status(404).json({ error: "Client not found" });

    const { id: clientId, name: clientName } = clientRes.rows[0];

    // Pobranie kolejnego numeru zamówienia
    const numRes = await pool.query("SELECT COALESCE(MAX(order_number), 0) + 1 AS next_number FROM orders");
    const orderNumber = numRes.rows[0].next_number;

    // Dodanie zamówienia do bazy danych
    await pool.query(
      "INSERT INTO orders (client_id, order_number, delivery_date, order_type, note, items) VALUES ($1, $2, $3, $4, $5, $6::jsonb)",
      [clientId, orderNumber, deliveryDate, orderType, note, JSON.stringify(items)]
    );

    // Konfiguracja transportera SMTP
    const transporter = nodemailer.createTransport({
      host: "lh164.dnsireland.com",
      port: 465,
      secure: true,
      auth: {
        user: "apk@thebreadskibrothers.ie",
        pass: "N]dKOKe#V%o1"
      }
    });

    // Treść e-maila
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

    // Wysłanie e-maila
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

// === Pobieranie listy wiadomości ===
app.get("/messages", async (req, res) => {
  try {
    const result = await pool.query("SELECT id, content, created_at, recipients FROM messages ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (error) {
    console.error("Message fetch error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// === Dodawanie nowej wiadomości ===
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

// === Pobieranie najnowszej wiadomości dla użytkownika ===
app.get("/messages/latest/:login", async (req, res) => {
  const { login } = req.params;
  try {
    const result = await pool.query(`
      SELECT content, created_at FROM messages
      WHERE recipients IS NULL OR recipients @> ARRAY[$1]
      ORDER BY created_at DESC LIMIT 1
    `, [login.toUpperCase()]);
    res.json(result.rows[0] || null);
  } catch (error) {
    console.error("Latest message fetch error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// === Pobieranie listy grup produktów ===
app.get("/groups", async (req, res) => {
  try {
    const result = await pool.query("SELECT id, name FROM product_groups ORDER BY id");
    res.json(result.rows);
  } catch (error) {
    console.error("Group fetch error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// === Pobieranie listy unikalnych dni dostaw – posortowane alfabetycznie ===
app.get('/delivery-days', async (req, res) => {
  try {
    console.log("➡️ Pobieranie listy unikalnych dni dostaw...");

    const result = await pool.query(`
      SELECT delivery_days 
      FROM (
        SELECT DISTINCT delivery_days 
        FROM delivery_dates
      ) sub
      ORDER BY 
        CASE
          WHEN delivery_days = 'Monday' THEN 1
          WHEN delivery_days = 'Tuesday' THEN 2
          WHEN delivery_days = 'Wednesday' THEN 3
          WHEN delivery_days = 'Thursday' THEN 4
          WHEN delivery_days = 'Friday' THEN 5
          WHEN delivery_days = 'Saturday' THEN 6
          WHEN delivery_days = 'Sunday' THEN 7
          ELSE 8
        END
    `);

    const days = result.rows.map(row => row.delivery_days);
    console.log("✅ Pobrane dni dostaw:", days);
    res.json(days);
  } catch (error) {
    console.error("❌ Delivery day fetch error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});
// === Pobieranie listy unikalnych grup produktowych ===
app.get('/product-groups', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT name 
      FROM product_groups 
      WHERE name IS NOT NULL AND name <> ''
      ORDER BY name
    `);

    const groups = result.rows.map(row => row.name);
    console.log("✅ Pobrane grupy produktowe:", groups);
    res.json(groups);
  } catch (error) {
    console.error("❌ Product groups fetch error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});
// === Pobieranie listy unikalnych tras klientów ===
app.get('/routes', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT route 
      FROM clients 
      WHERE route IS NOT NULL AND route <> ''
      ORDER BY route
    `);

    // Sprawdzamy, co dokładnie zwraca SQL
    console.log("✅ Pobrane trasy:", result.rows);

    const routes = result.rows.map(row => row.route);
    res.json(routes);
  } catch (error) {
    console.error("❌ Route fetch error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});



// === Pobieranie pełnej listy produktów do panelu admina ===
app.get("/products-full", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        p.id, 
        p.name, 
        p.category, 
        p.group_id, 
        pg.name AS group_name, 
        p.active
      FROM products p
      LEFT JOIN product_groups pg ON p.group_id = pg.id
      ORDER BY p.id
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Products full fetch error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// === Dodawanie nowego produktu (panel admina) ===
app.post("/products", async (req, res) => {
  const { name, category, group_id, active } = req.body;
  try {
    await pool.query(
      "INSERT INTO products (name, category, group_id, active) VALUES ($1, $2, $3, $4)",
      [name, category, group_id, active]
    );
    res.sendStatus(201);
  } catch (error) {
    console.error("Product insert error:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});


app.listen(3000, () => {
  console.log("✅ Server is running on port 3000");
});
