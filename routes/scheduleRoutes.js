const express = require("express");
const Schedule = require("../models/Schedule");
const { format, parseISO, isAfter } = require('date-fns');
const router = express.Router();

// Create a new appointment
router.post("/", async (req, res) => {
    try {
        const newAppointment = new Schedule(req.body);
        await newAppointment.save();
        
        // Notify all connected clients about the new appointment
        req.app.get('io').emit('appointment-update', { 
            type: 'created', 
            appointment: newAppointment 
        });
        
        res.status(201).json({ message: "✅ Appointment submitted successfully!" });
    } catch (error) {
        console.error("Error submitting appointment:", error);
        res.status(400).json({ error: error.message || "❌ Error submitting appointment" });
    }
});

// Get all appointments with filtering options
router.get("/", async (req, res) => {
    try {
        const { status, upcoming } = req.query;
        const currentDate = new Date();
        
        let query = {};
        
        // Status filter
        if (status) {
            query.status = status;
        }
        
        // Upcoming filter
        if (upcoming === 'true') {
            query.preferredDate = { $gte: currentDate };
        }
        
        const appointments = await Schedule.find(query)
            .sort({ preferredDate: 1, preferredTime: 1 });
            
        // Format dates for better readability
        const formattedAppointments = appointments.map(appointment => ({
            ...appointment._doc,
            formattedDate: format(parseISO(appointment.preferredDate.toISOString()), 'MMM dd, yyyy'),
            formattedTime: appointment.preferredTime
        }));
        
        res.status(200).json(formattedAppointments);
    } catch (error) {
        console.error("Error fetching schedules:", error);
        res.status(500).json({ error: "❌ Server error" });
    }
});

// Get appointments for a specific user
router.get("/user", async (req, res) => {
    try {
        const { email, status } = req.query;
        let query = { userEmail: email };
        
        if (status) {
            query.status = status;
        }
        
        const appointments = await Schedule.find(query)
            .sort({ preferredDate: 1 });
            
        const formattedAppointments = appointments.map(appointment => ({
            ...appointment._doc,
            formattedDate: format(parseISO(appointment.preferredDate.toISOString()), 'MMM dd, yyyy'),
            formattedTime: appointment.preferredTime
        }));
        
        res.status(200).json(formattedAppointments);
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
        
        // Notify all clients about the update
        req.app.get('io').emit('appointment-update', { 
            type: 'updated', 
            appointment 
        });
        
        res.status(200).json({ 
            message: "✅ Appointment approved successfully!",
            appointment 
        });
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
        
        // Notify all clients about the update
        req.app.get('io').emit('appointment-update', { 
            type: 'updated', 
            appointment 
        });
        
        res.status(200).json({ 
            message: "✅ Appointment rejected successfully!",
            appointment 
        });
    } catch (error) {
        res.status(500).json({ error: "❌ Server error" });
    }
});

module.exports = router;