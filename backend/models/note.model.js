const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const noteSchema = new Schema({
    title: {type: String, default: ""},
    content: {type: String, default: ""},
    tags: {type: [String], default: []},
    isPinned: {type: Boolean, default: false},
    userId: {type: String, required: true},
    createdOn: { type: Date, default: () => new Date() },
});

module.exports = mongoose.model("Note", noteSchema);