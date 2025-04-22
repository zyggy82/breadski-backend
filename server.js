const express = require("express");
const nodemailer = require("nodemailer");
const cors = require("cors");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

app.post("/send", async (req, res) => {
  const { subject, message } = req.body;

  const transporter = nodemailer.createTransport({
    host: "lh164.dnsireland.com",
    port: 587,
    secure: false,
    auth: {
      user: "apk@thebreadskibrothers.ie",
      pass: "N]dKOKe#V%o1",
    },
  });

  const mailOptions = {
    from: '"Breadski Orders" <apk@thebreadskibrothers.ie>',
    to: "orders@thebreadskibrothers.ie",
    subject,
    text: message,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log("✅ Email sent!");
    res.status(200).send("Email sent!");
  } catch (error) {
    console.error("❌ Błąd podczas wysyłania:", error);
    res.status(500).send("Nie udało się wysłać emaila");
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});