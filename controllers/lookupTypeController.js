const LookupType = require("../models/LookupType");

const getAllLookupType = async (req, res) => {
  try {
    const lookupTypes = await LookupType.find();
    if (!lookupTypes) return res.status(204).json({ message: "No Lookup types found." });
    res.json(lookupTypes);
  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
};

const getLookupType = async (req, res) => {
  try {
    const { id } = req.params;
    const lookupType = await LookupType.findById(id);
    if (!lookupType) {
      return res.status(404).json({ error: "LookupType not found" });
    }
    res.json(lookupType);
  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
};

const createNewLookupType = async (req, res) => {
  try {
    const { code, lookuptype, DisplayName, isdeleted, isactive, userid } = req.body;

    if (!code || !lookuptype || !userid) {
      return res.status(400).json({ error: "Code, LookupType, User ID are required" });
    }

    const lookupType = await LookupType.create({
      code: req.body.code,
      lookuptype: req.body.lookuptype,
      displayname: req.body.DisplayName,
      isdeleted: req.body.isdeleted || false,
      isactive: req.body.isactive || true,
      userid: req.body.userid,
    });

    res.status(201).json(lookupType);
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

const updateLookupType = async (req, res) => {
  try {
    const { id, code, lookuptype, displayname, isdeleted, isactive, userid } = req.body;
    const lookupTypes = await LookupType.findById(id);
    if (!lookupTypes) {
      return res.status(404).json({ error: "LookupType not found" });
    }

    if (code) lookupTypes.code = code;
    if (lookuptype) lookupTypes.lookuptype = lookuptype;
    if (displayname) lookupTypes.displayname = displayname;
    if (typeof isdeleted !== "undefined") lookupTypes.isdeleted = isdeleted;
    if (typeof isactive !== "undefined") lookupTypes.isactive = isactive;
    if (userid) lookupTypes.userid = userid;

    await lookupTypes.save();
    res.json(lookupTypes);
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: "Server error" });
  }
};

const deleteLookupType = async (req, res) => {
  if (!req?.body?.id) return res.status(400).json({ message: "LookupType ID required." });

  const lookuptype = await LookupType.findOne({ _id: req.body.id }).exec();
  if (!lookuptype) {
    return res.status(240).json({ message: ` No lookuptype matches ID ${req.body.id}. ` });
  }

  const result = await lookuptype.deleteOne({ _id: req.body.id });
  res.json(result);
};

module.exports = {
  getAllLookupType,
  getLookupType,
  createNewLookupType,
  updateLookupType,
  deleteLookupType,
};
