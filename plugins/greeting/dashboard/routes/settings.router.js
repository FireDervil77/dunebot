/**
 * Greeting - systemweite Routen
 *
 * Hier stand bis zum 2026-08-07 eine Route `GET /settings`, die
 * `greeting/settings` rendern wollte - eine View, die es im ganzen Projekt
 * nicht gibt. Der Aufruf waere also in einen Fehler gelaufen. Ihr eigener
 * Kommentar sagte bereits: "Fuer Greeting gibt es aktuell keine
 * system-weiten Settings, alle Settings sind guild-spezifisch."
 *
 * Die Datei bleibt als Platz fuer spaetere systemweite Routen bestehen; der
 * Router ist absichtlich leer.
 *
 * @module greeting/routes/settings
 */

const express = require('express');
const router = express.Router();

module.exports = router;
