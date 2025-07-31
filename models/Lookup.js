const mongoose = require("mongoose");

const lookupSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
  },
  lookupname: {
    type: String,
    required: true,
  },
  DisplayName: {
    type: String,
  },
  Parentlookupid: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Lookup",
  },
  lookuptypeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "LookupType",
    required: true,
  },
  isdeleted: {
    type: Boolean,
    default: false,
  },
  isactive: {
    type: Boolean,
    default: true,
  },
  userid: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  createdAt: { type: Date, default: undefined },
  updatedAt: { type: Date, default: undefined },
});

module.exports = mongoose.model("Lookup", lookupSchema);
