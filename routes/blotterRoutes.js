const express = require("express");
const Blotter = require("../models/Blotter");

const router = express.Router();

// Create a new blotter entry
router.post("/", async (req, res) => {
    try {
        const { incident, date, reporter, description } = req.body;

        const newBlotter = new Blotter({
            incident,
            date,
            reporter,
            description,
        });

        await newBlotter.save();
        res.status(201).json({ message: "✅ Blotter entry created successfully" });
    } catch (error) {
        res.status(500).json({ error: "❌ Server error" });
    }
});

// Get all blotter entries
router.get("/", async (req, res) => {
    try {
        const blotterEntries = await Blotter.find();
        res.status(200).json(blotterEntries);
    } catch (error) {
        res.status(500).json({ error: "❌ Server error" });
    }
});

// Get a specific blotter entry
router.get("/:id", async (req, res) => {
    try {
        const id = req.params.id;
        const blotterEntry = await Blotter.findById(id);
        if (!blotterEntry) {
            return res.status(404).json({ error: "❌ Blotter entry not found" });
        }
        res.status(200).json(blotterEntry);
    } catch (error) {
        res.status(500).json({ error: "❌ Server error" });
    }
});

// Update a blotter entry
router.put("/:id", async (req, res) => {
    try {
        const id = req.params.id;
        const blotterEntry = await Blotter.findById(id);
        if (!blotterEntry) {
            return res.status(404).json({ error: "❌ Blotter entry not found" });
        }

        const { incident, date, reporter, description } = req.body;
        blotterEntry.incident = incident;
        blotterEntry.date = date;
        blotterEntry.reporter = reporter;
        blotterEntry.description = description;

        await blotterEntry.save();
        res.status(200).json({ message: "✅ Blotter entry updated successfully" });
    } catch (error) {
        res.status(500).json({ error: "❌ Server error" });
    }
});

// Delete a blotter entry
router.delete("/:id", async (req, res) => {
    try {
        const id = req.params.id;
        await Blotter.findByIdAndDelete(id);
        res.status(200).json({ message: "✅ Blotter entry deleted successfully" });
    } catch (error) {
        res.status(500).json({ error: "❌ Server error" });
    }
});

module.exports = router;