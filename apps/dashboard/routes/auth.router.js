const express = require("express");
const router = express.Router();

// Controller
const authController = require("../controllers/auth.controller");

// Security Middlewares
const { authLimiter } = require("../middlewares/security/rate-limiter.middleware");
const { csrfProtection } = require("../middlewares/security/csrf-protection.middleware");

// OAuth-Routen (mit Rate Limiting)
router.get("/login", authLimiter, authController.login);
router.get("/callback", authLimiter, authController.callback);
router.get("/logout", authController.logout);
router.get("/server-selector", authController.getServerSelector);

// Server-Auswahl (setzt active_guild) - mit CSRF Protection
router.post("/select-guild/:guildId", csrfProtection, authController.setActiveGuild);

// Token-Anzeige (nur OAuth2)
router.get("/tokens", authController.getTokens);

module.exports = router;