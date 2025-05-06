const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Resident = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

// Register Resident
router.post("/register", async (req, res) => {
  const { name, email, password, address, contact } = req.body;
  if (!name || !email || !password) return res.status(400).json({ message: "All fields required" });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const newResident = new Resident({ name, email, password: hashedPassword, address, contact });
    await newResident.save();

    res.status(201).json({ message: "Resident registered successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error registering resident", error });
  }
});

// Login Resident
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const resident = await Resident.findOne({ email });

  if (!resident) return res.status(404).json({ message: "Resident not found" });

  const isMatch = await bcrypt.compare(password, resident.password);
  if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

  const token = jwt.sign({ id: resident._id, email: resident.email }, process.env.JWT_SECRET, { expiresIn: "7d" });

  res.status(200).json({ message: "Login successful", token });
});

// Get Resident Profile
router.get("/profile", authMiddleware, async (req, res) => {
  const resident = await Resident.findById(req.user.id);
  if (!resident) return res.status(404).json({ message: "Resident not found" });

  res.json(resident);
});

module.exports = router;
