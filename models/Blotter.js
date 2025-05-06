const mongoose = require("mongoose");

const blotterSchema = new mongoose.Schema({
    incident: { type: String, required: true },
    date: { type: String, required: true },
    reporter: { type: String, required: true },
    description: { type: String },
}, { collection: "blotter" });

const Blotter = mongoose.model("Blotter", blotterSchema, "blotter");

module.exports = Blotter;