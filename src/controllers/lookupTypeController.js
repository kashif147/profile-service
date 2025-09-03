// controllers/lookupType.controller.js (ESM)

import LookupType from "../models/LookupType.js";

// GET /lookup-types
export async function getAllLookupType(req, res) {
  try {
    const lookupTypes = await LookupType.find().lean();
    if (!lookupTypes || lookupTypes.length === 0) {
      return res.status(204).json({ message: "No Lookup types found." });
    }
    return res.status(200).json(lookupTypes);
  } catch (error) {
    console.error("Error fetching lookup types:", error);
    return res.status(500).json({ error: "Server error" });
  }
}

// GET /lookup-types/:id
export async function getLookupType(req, res) {
  try {
    const { id } = req.params;
    const lookupType = await LookupType.findById(id).lean();
    if (!lookupType) {
      return res.status(404).json({ error: "LookupType not found" });
    }
    return res.status(200).json(lookupType);
  } catch (error) {
    console.error("Error fetching lookup type:", error);
    return res.status(500).json({ error: "Server error" });
  }
}

// POST /lookup-types
export async function createNewLookupType(req, res) {
  try {
    const { code, lookuptype, DisplayName, isdeleted, isactive, userid } =
      req.body;

    if (!code || !lookuptype || !userid) {
      return res
        .status(400)
        .json({ error: "Code, LookupType, and User ID are required" });
    }

    const lookupType = await LookupType.create({
      code,
      lookuptype,
      displayname: DisplayName, // maps DisplayName -> displayname
      isdeleted: typeof isdeleted === "boolean" ? isdeleted : false,
      isactive: typeof isactive === "boolean" ? isactive : true,
      userid,
    });

    return res.status(201).json(lookupType);
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ error: error.message });
    }
    if (error.code === 11000) {
      return res.status(400).json({ error: "Code must be unique" });
    }
    console.error("Error creating lookup type:", error);
    return res.status(500).json({ error: "Server error" });
  }
}

// PUT /lookup-types
export async function updateLookupType(req, res) {
  try {
    const { id, code, lookuptype, displayname, isdeleted, isactive, userid } =
      req.body;

    const lookupTypes = await LookupType.findById(id);
    if (!lookupTypes) {
      return res.status(404).json({ error: "LookupType not found" });
    }

    if (code != null) lookupTypes.code = code;
    if (lookuptype != null) lookupTypes.lookuptype = lookuptype;
    if (displayname != null) lookupTypes.displayname = displayname;
    if (typeof isdeleted !== "undefined") lookupTypes.isdeleted = isdeleted;
    if (typeof isactive !== "undefined") lookupTypes.isactive = isactive;
    if (userid != null) lookupTypes.userid = userid;

    await lookupTypes.save();
    return res.status(200).json(lookupTypes);
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ error: error.message });
    }
    console.error("Error updating lookup type:", error);
    return res.status(500).json({ error: "Server error" });
  }
}

// DELETE /lookup-types
export async function deleteLookupType(req, res) {
  try {
    const id = req?.body?.id;
    if (!id)
      return res.status(400).json({ message: "LookupType ID required." });

    const lookuptype = await LookupType.findById(id);
    if (!lookuptype) {
      return res
        .status(404)
        .json({ message: `No lookuptype matches ID ${id}.` });
    }

    const result = await lookuptype.deleteOne({ _id: id });
    return res.status(200).json(result);
  } catch (error) {
    console.error("Error deleting lookup type:", error);
    return res.status(500).json({ error: "Server error" });
  }
}

export default {
  getAllLookupType,
  getLookupType,
  createNewLookupType,
  updateLookupType,
  deleteLookupType,
};
