const express = require("express");
const router = express.Router();

// Controller
const authController = require("../controllers/auth.controller");

// OAuth-Routen
router.get("/login", authController.login);
router.get("/callback", authController.callback);
router.get("/logout", authController.logout);
router.get("/server-selector", authController.getServerSelector);

// Token-Anzeige (nur OAuth2)
router.get("/tokens", authController.getTokens);

module.exports = router;