const mongoose = require("mongoose");

const lookupTypeSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
  },
  lookuptype: {
    type: String,
    required: true,
  },
  displayname: {
    type: String,
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

module.exports = mongoose.model("LookupType", lookupTypeSchema);
