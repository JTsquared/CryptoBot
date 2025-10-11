import mongoose from 'mongoose';

const ApiKeySchema = new mongoose.Schema({
  guildId: { type: String, required: true, index: true },
  keyHash: { type: String, required: true, unique: true }, // SHA-256 hash of API key
  name: { type: String, default: 'Default API Key' }, // User-friendly name
  createdBy: { type: String, required: true }, // Discord ID of creator
  createdAt: { type: Date, default: Date.now },
  lastUsedAt: { type: Date, default: null },
  isActive: { type: Boolean, default: true },
  // Permissions (for future expansion)
  permissions: {
    type: [String],
    default: ['prizepool:read', 'prizepool:write']
  }
});

// Index is already created via unique: true in schema, no need to duplicate

const ApiKey = mongoose.model('ApiKey', ApiKeySchema);
export default ApiKey;
