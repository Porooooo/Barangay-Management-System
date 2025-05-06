const mongoose = require("mongoose");

const requestSchema = new mongoose.Schema({
    fullName: { type: String, required: true },
    email: { type: String, required: true },
    address: { type: String, required: true },
    documentType: { type: String, required: true },
    purpose: { type: String, required: true },
    status: { type: String, default: "Pending" }
}, { collection: "requests" }); // Use the 'requests' collection

const Request = mongoose.model("Request", requestSchema, "requests"); // Store in the 'requests' collection

module.exports = Request;