// controllers/lookup.controller.js (ESM)

import Lookup from "../models/Lookup.js";

// GET /lookups
export async function getAllLookup(req, res) {
  try {
    const lookups = await Lookup.find({})
      .populate({ path: "lookuptypeId", select: "code lookuptype displayname" })
      .populate({ path: "Parentlookupid", select: "lookupname" })
      .lean();

    const formattedLookups = lookups.map((lookup) => ({
      _id: lookup?._id,
      code: lookup?.code,
      lookupname: lookup?.lookupname,
      DisplayName: lookup?.DisplayName,
      Parentlookupid: lookup?.Parentlookupid
        ? lookup?.Parentlookupid._id
        : null,
      Parentlookup: lookup?.Parentlookupid
        ? lookup?.Parentlookupid.lookupname
        : null,
      lookuptypeId: {
        _id: lookup?.lookuptypeId ? lookup?.lookuptypeId?._id : null,
        code: lookup?.lookuptypeId ? lookup?.lookuptypeId?.code : null,
        lookuptype: lookup?.lookuptypeId
          ? lookup?.lookuptypeId?.lookuptype
          : null,
      },
      isactive: lookup?.isactive,
      isdeleted: lookup?.isdeleted,
    }));

    return res.status(200).json(formattedLookups);
  } catch (error) {
    console.error("Error fetching lookups:", error);
    return res
      .status(500)
      .json({ error: "An error occurred while fetching lookups" });
  }
}

// GET /lookups/:id
export async function getLookup(req, res) {
  try {
    const { id } = req.params;

    const lookup = await Lookup.findById(id)
      .populate({ path: "lookuptypeId", select: "code lookuptype displayname" })
      .populate({ path: "Parentlookupid", select: "lookupname" })
      .lean();

    if (!lookup) {
      return res.status(404).json({ error: "Lookup not found" });
    }

    const formattedLookup = {
      _id: lookup._id,
      code: lookup.code,
      lookupname: lookup.lookupname,
      DisplayName: lookup.DisplayName,
      Parentlookupid: lookup.Parentlookupid ? lookup.Parentlookupid._id : null,
      Parentlookup: lookup.Parentlookupid
        ? lookup.Parentlookupid.lookupname
        : null,
      lookuptypeId: {
        _id: lookup.lookuptypeId ? lookup.lookuptypeId._id : null,
        code: lookup.lookuptypeId ? lookup.lookuptypeId.code : null,
        lookuptype: lookup.lookuptypeId ? lookup.lookuptypeId.lookuptype : null,
      },
      isactive: lookup.isactive,
      isdeleted: lookup.isdeleted,
    };

    return res.status(200).json(formattedLookup);
  } catch (error) {
    console.error("Error fetching lookup:", error);
    return res.status(500).json({ error: "Server error" });
  }
}

// POST /lookups
export async function createNewLookup(req, res) {
  try {
    const {
      code,
      lookupname,
      DisplayName,
      Parentlookupid,
      lookuptypeId,
      isdeleted,
      isactive,
      userid,
    } = req.body;

    if (!code || !lookupname || !userid) {
      return res
        .status(400)
        .json({ error: "Code, Lookup, and User ID are required" });
    }

    const lookup = await Lookup.create({
      code,
      lookupname,
      DisplayName,
      Parentlookupid,
      lookuptypeId,
      isdeleted: typeof isdeleted === "boolean" ? isdeleted : false,
      isactive,
      userid,
    });

    return res.status(201).json(lookup);
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ error: error.message });
    }
    if (error.code === 11000) {
      return res.status(400).json({ error: "Code must be unique" });
    }
    console.error("Error creating lookup:", error);
    return res.status(500).json({ error: "Server error" });
  }
}

// PUT /lookups
export async function updateLookup(req, res) {
  try {
    const {
      id,
      code,
      lookupname,
      DisplayName,
      Parentlookupid,
      lookuptypeId,
      isdeleted,
      isactive,
      userid,
    } = req.body;

    const lookup = await Lookup.findById(id);
    if (!lookup) {
      return res.status(404).json({ error: "Lookup not found" });
    }

    if (code != null) lookup.code = code;
    if (lookupname != null) lookup.lookupname = lookupname;
    if (DisplayName != null) lookup.DisplayName = DisplayName;
    if (Parentlookupid != null) lookup.Parentlookupid = Parentlookupid;
    if (lookuptypeId != null) lookup.lookuptypeId = lookuptypeId;
    if (typeof isdeleted !== "undefined") lookup.isdeleted = isdeleted;
    if (typeof isactive !== "undefined") lookup.isactive = isactive;
    if (userid != null) lookup.userid = userid;

    await lookup.save();
    return res.status(200).json(lookup);
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ error: error.message });
    }
    console.error("Error updating lookup:", error);
    return res.status(500).json({ error: "Server error" });
  }
}

// DELETE /lookups
export async function deleteLookup(req, res) {
  try {
    const id = req?.body?.id;
    if (!id) return res.status(400).json({ message: "Lookup ID required." });

    const lookup = await Lookup.findById(id);
    if (!lookup) {
      return res.status(404).json({ message: `No lookup matches ID ${id}.` });
    }

    const result = await lookup.deleteOne({ _id: id });
    return res.status(200).json(result);
  } catch (error) {
    console.error("Error deleting lookup:", error);
    return res.status(500).json({ error: "Server error" });
  }
}

export default {
  getAllLookup,
  getLookup,
  createNewLookup,
  updateLookup,
  deleteLookup,
};
