const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const nodemailer = require("nodemailer");

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.post("/api/send-order", async (req, res) => {
  const { to, subject, text } = req.body;

  const transporter = nodemailer.createTransport({
    host: "lh164.dnsireland.com",
    port: 587,
    secure: false,
    auth: {
      user: "apk@thebreadskibrothers.ie",
      pass: "N]dKOKe#V%o1"
    }
  });

  try {
    await transporter.sendMail({
      from: '"Breadski Orders" <apk@thebreadskibrothers.ie>',
      to,
      subject,
      text
    });

    res.status(200).json({ message: "Email sent successfully" });
  } catch (error) {
    console.error("Error sending email:", error);
    res.status(500).json({ message: "Error sending email" });
  }
});

app.get("/", (req, res) => {
  res.send("Breadski backend is running.");
});

app.listen(3001, () => {
  console.log("Server running on port 3001");
});