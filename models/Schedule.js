const mongoose = require("mongoose");

const ScheduleSchema = new mongoose.Schema({
    fullName: { type: String, required: true },
    address: { type: String, required: true },
    purpose: { type: String, required: true },
    preferredDate: { type: Date, required: true },
    preferredTime: { type: String, required: true },
    userEmail: { type: String, required: true }, // Associate schedules with users
    status: { type: String, default: "Pending" }, // Default status is "Pending"
    createdAt: { type: Date, default: Date.now } // Track when the schedule was created
});

module.exports = mongoose.model("Schedule", ScheduleSchema);