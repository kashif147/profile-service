const Lookup = require("../models/Lookup");

const getAllLookup = async (req, res) => {
  try {
    const lookups = await Lookup.find({})
      .populate({
        path: "lookuptypeId",
        select: "code lookuptype displayname",
      })
      .populate({
        path: "Parentlookupid",
        select: "lookupname",
      });

    const formattedLookups = lookups.map((lookup) => ({
      _id: lookup?._id,
      code: lookup?.code,
      lookupname: lookup?.lookupname,
      DisplayName: lookup?.DisplayName,
      Parentlookupid: lookup?.Parentlookupid ? lookup?.Parentlookupid._id : null,
      Parentlookup: lookup?.Parentlookupid ? lookup?.Parentlookupid.lookupname : null,
      lookuptypeId: {
        _id: lookup?.lookuptypeId ? lookup?.lookuptypeId?._id : null,
        code: lookup?.lookuptypeId ? lookup?.lookuptypeId?.code : null,
        lookuptype: lookup?.lookuptypeId ? lookup?.lookuptypeId?.lookuptype : null,
      },
      isactive: lookup?.isactive,
      isdeleted: lookup?.isdeleted,
    }));
    res.status(200).json(formattedLookups);
  } catch (error) {
    console.error("Error fetching lookups:", error);
    res.status(500).json({ error: "An error occurred while fetching lookups" });
  }
};

const getLookup = async (req, res) => {
  try {
    const { id } = req.params;
    const lookup = await Lookup.findById(id)
      .populate({
        path: "lookuptypeId",
        select: "code lookuptype displayname",
      })
      .populate({
        path: "Parentlookupid",
        select: "lookupname",
      });

    if (!lookup) {
      return res.status(404).json({ error: "Lookup not found" });
    }

    const formattedLookup = {
      _id: lookup._id,
      code: lookup.code,
      lookupname: lookup.lookupname,
      DisplayName: lookup.DisplayName,
      Parentlookupid: lookup.Parentlookupid ? lookup.Parentlookupid._id : null,
      Parentlookup: lookup.Parentlookupid ? lookup.Parentlookupid.lookupname : null,
      lookuptypeId: {
        _id: lookup.lookuptypeId ? lookup.lookuptypeId._id : null,
        code: lookup.lookuptypeId ? lookup.lookuptypeId.code : null,
        lookuptype: lookup.lookuptypeId ? lookup.lookuptypeId.lookuptype : null,
      },
      isactive: lookup.isactive,
      isdeleted: lookup.isdeleted,
    };

    res.status(200).json(formattedLookup);
  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
};

const createNewLookup = async (req, res) => {
  try {
    const { code, lookupname, DisplayName, Parentlookupid, lookuptypeId, isdeleted, isactive, userid } = req.body;

    if (!code || !lookupname || !userid) {
      return res.status(400).json({ error: "Code, Lookup, User ID are required" });
    }

    const lookup = await Lookup.create({
      code: req.body.code,
      lookupname: req.body.lookupname,
      DisplayName: req.body.DisplayName,
      Parentlookupid: req.body.Parentlookupid,
      lookuptypeId: req.body.lookuptypeId,
      isdeleted: req.body.isdeleted || false,
      isactive: req.body.isactive,
      userid: req.body.userid,
    });

    res.status(201).json(lookup);
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ error: error.message });
    }
    if (error.code === 11000) {
      return res.status(400).json({ error: "Code must be unique" });
    }
    res.status(500).json({ error: "Server error" });
  }
};

const updateLookup = async (req, res) => {
  try {
    const { id, code, lookupname, DisplayName, Parentlookupid, lookuptypeId, isdeleted, isactive, userid } = req.body;

    const lookup = await Lookup.findById(id);
    if (!lookup) {
      return res.status(404).json({ error: "Lookup not found" });
    }

    if (code) lookup.code = code;
    if (lookupname) lookup.lookupname = lookupname;
    if (DisplayName) lookup.DisplayName = DisplayName;
    if (Parentlookupid) lookup.Parentlookupid = Parentlookupid;
    if (lookuptypeId) lookup.lookuptypeId = lookuptypeId;
    if (typeof isdeleted !== "undefined") lookup.isdeleted = isdeleted;
    if (typeof isactive !== "undefined") lookup.isactive = isactive;
    if (userid) lookup.userid = userid;

    await lookup.save();
    res.json(lookup);
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: "Server error" });
  }
};

const deleteLookup = async (req, res) => {
  if (!req?.body?.id) return res.status(400).json({ message: "Lookup ID required." });

  const lookup = await Lookup.findOne({ _id: req.body.id }).exec();
  if (!lookup) {
    return res.status(240).json({ message: ` No lookups matches ID ${req.body.id}. ` });
  }

  const result = await lookup.deleteOne({ _id: req.body.id });
  res.json(result);
};

module.exports = {
  getAllLookup,
  getLookup,
  createNewLookup,
  updateLookup,
  deleteLookup,
};
