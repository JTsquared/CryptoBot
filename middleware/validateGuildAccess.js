/**
 * Middleware to validate that external API requests can only access their own guild's data
 *
 * CRITICAL SECURITY: This middleware MUST be applied to every route that accepts a guildId parameter
 *
 * How it works:
 * 1. If request is from localhost (HardcoreRumble bot) → Allow access to any guild
 * 2. If request is external (with API key) → Only allow access to the key's guild
 *
 * Usage in routes:
 *   router.get("/balances/:guildId", validateGuildAccess, async (req, res) => { ... })
 */
export function validateGuildAccess(req, res, next) {
  // Skip validation for localhost requests (internal bot)
  if (!req.isExternalRequest) {
    return next();
  }

  // For external requests, extract the requested guildId
  const requestedGuildId = req.params.guildId || req.body?.guildId || req.query?.guildId;

  // If no guildId in request, we can't validate (route might not be guild-specific)
  if (!requestedGuildId) {
    console.warn('⚠️  Route accessed with API key but no guildId found in request');
    return next(); // Let route handler decide if guildId is required
  }

  // Validate the API key's guild matches the requested guild
  if (req.apiGuildId !== requestedGuildId) {
    console.warn(`🚨 BLOCKED: API key for guild ${req.apiGuildId} tried to access guild ${requestedGuildId}`);
    return res.status(403).json({
      success: false,
      error: 'Forbidden - API key does not have access to this guild'
    });
  }

  // Guild matches, allow access
  next();
}

/**
 * Stricter version: REQUIRES guildId to be present and validated
 * Use this for routes that MUST have a guildId
 */
export function requireGuildAccess(req, res, next) {
  // Skip validation for localhost requests
  if (!req.isExternalRequest) {
    return next();
  }

  const requestedGuildId = req.params.guildId || req.body?.guildId || req.query?.guildId;

  // REQUIRE guildId to be present
  if (!requestedGuildId) {
    console.warn('🚨 BLOCKED: External request to guild-specific route without guildId');
    return res.status(400).json({
      success: false,
      error: 'Bad Request - guildId is required'
    });
  }

  // Validate the API key's guild matches the requested guild
  if (req.apiGuildId !== requestedGuildId) {
    console.warn(`🚨 BLOCKED: API key for guild ${req.apiGuildId} tried to access guild ${requestedGuildId}`);
    return res.status(403).json({
      success: false,
      error: 'Forbidden - API key does not have access to this guild'
    });
  }

  // Guild matches, allow access
  next();
}
