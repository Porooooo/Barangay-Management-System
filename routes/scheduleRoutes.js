const express = require("express");
const Schedule = require("../models/Schedule");

const router = express.Router();

// Create a new appointment
router.post("/", async (req, res) => {
    try {
        const newAppointment = new Schedule(req.body);
        await newAppointment.save();
        res.status(201).json({ message: "✅ Appointment submitted successfully!" });
    } catch (error) {
        console.error("Error submitting appointment:", error);
        res.status(400).json({ error: error.message || "❌ Error submitting appointment" });
    }
});

// Get all appointments for a specific user
router.get("/user", async (req, res) => {
    try {
        const userEmail = req.query.email; // Get the user's email from the query parameter
        const appointments = await Schedule.find({ userEmail: userEmail })
            .sort({ preferredDate: 1 }); // Sort by preferred date
        res.status(200).json(appointments);
    } catch (error) {
        console.error("Error fetching user schedules:", error);
        res.status(500).json({ error: "❌ Server error" });
    }
});

// Approve an appointment
router.put("/:id/approve", async (req, res) => {
    try {
        const appointment = await Schedule.findByIdAndUpdate(
            req.params.id,
            { status: "Approved" },
            { new: true }
        );
        if (!appointment) {
            return res.status(404).json({ error: "❌ Appointment not found" });
        }
        res.status(200).json({ message: "✅ Appointment approved successfully!" });
    } catch (error) {
        res.status(500).json({ error: "❌ Server error" });
    }
});

// Reject an appointment
router.put("/:id/reject", async (req, res) => {
    try {
        const appointment = await Schedule.findByIdAndUpdate(
            req.params.id,
            { status: "Rejected" },
            { new: true }
        );
        if (!appointment) {
            return res.status(404).json({ error: "❌ Appointment not found" });
        }
        res.status(200).json({ message: "✅ Appointment rejected successfully!" });
    } catch (error) {
        res.status(500).json({ error: "❌ Server error" });
    }
});

module.exports = router;