// models/Admin.js
const mongoose = require("mongoose");

const adminSchema = new mongoose.Schema({
    fullName: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    status: { type: String, required: true }, // e.g., Brgy. Captain, Secretary
    password: { type: String, required: true },
});

const Admin = mongoose.model("Admin", adminSchema);

module.exports = Admin;
