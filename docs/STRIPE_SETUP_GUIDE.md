# 🔐 Stripe Payment Setup - Donations System

## 📋 Übersicht

DuneBot nutzt **Stripe Checkout** für sichere Donation-Zahlungen. Diese Anleitung zeigt dir, wie du Stripe richtig einrichtest.

---

## 🚀 Schritt 1: Stripe Account erstellen

1. Gehe zu **https://dashboard.stripe.com/register**
2. Erstelle einen Account (Business-Typ empfohlen)
3. Verifiziere deine Email-Adresse
4. Wechsle in den **Test-Modus** (Toggle oben rechts)

---

## 🔑 Schritt 2: API-Keys abrufen

### Test-Keys (für Entwicklung):

1. Gehe zu: **https://dashboard.stripe.com/test/apikeys**
2. Kopiere die folgenden Keys:
   - **Publishable Key** (beginnt mit `pk_test_...`)
   - **Secret Key** (beginnt mit `sk_test_...`)

### In `.env` eintragen:

```bash
# apps/dashboard/.env
STRIPE_SECRET_KEY=sk_test_51QKBu...dein_test_key
STRIPE_PUBLISHABLE_KEY=pk_test_51QKBu...dein_test_key
```

⚠️ **WICHTIG**: 
- `sk_test_` = Test-Modus (keine echten Zahlungen)
- `sk_live_` = Live-Modus (echte Zahlungen) - erst nach Verifizierung!

---

## 🪝 Schritt 3: Webhook einrichten

Webhooks erlauben es Stripe, deinen Server über erfolgreiche Zahlungen zu informieren.

### 3.1 Webhook-Endpunkt erstellen:

1. Gehe zu: **https://dashboard.stripe.com/test/webhooks**
2. Klicke auf **"Add endpoint"**
3. Trage ein:
   - **Endpoint URL**: `https://dev.firenetworks.de/api/superadmin/stripe-webhook`
   - **Description**: `DuneBot Donations Webhook (DEV)`
4. Wähle folgende Events:
   - ✅ `checkout.session.completed`
   - ✅ `payment_intent.succeeded`
   - ✅ `payment_intent.payment_failed`
5. Klicke auf **"Add endpoint"**

### 3.2 Webhook Secret kopieren:

1. Klicke auf den neu erstellten Webhook
2. Im Abschnitt **"Signing secret"** klicke auf **"Reveal"**
3. Kopiere den Wert (beginnt mit `whsec_...`)
4. Trage ihn in `.env` ein:

```bash
STRIPE_WEBHOOK_SECRET=whsec_...dein_webhook_secret
```

---

## 🧪 Schritt 4: Test-Zahlungen durchführen

### Test-Kreditkarten (Stripe Test-Modus):

| Karte | Nummer | CVC | Datum | Ergebnis |
|-------|--------|-----|-------|----------|
| **Visa (Erfolg)** | `4242 4242 4242 4242` | Beliebig | Zukunft | ✅ Erfolg |
| **Visa (Fehler)** | `4000 0000 0000 0002` | Beliebig | Zukunft | ❌ Abgelehnt |
| **Mastercard** | `5555 5555 5555 4444` | Beliebig | Zukunft | ✅ Erfolg |
| **3D Secure** | `4000 0027 6000 3184` | Beliebig | Zukunft | 🔐 Authentifizierung |

### Test durchführen:

1. Öffne: `https://dev.firenetworks.de/guild/1403034310172475416/plugins/core/donate`
2. Klicke auf **"Jetzt spenden"**
3. Wähle einen Betrag (z.B. €5)
4. Nutze eine Test-Kreditkarte
5. Schließe den Checkout ab

### Was passiert jetzt?

1. **Stripe Checkout** öffnet sich in neuem Tab
2. Zahlung wird verarbeitet
3. **Webhook** benachrichtigt deinen Server
4. **Donation** wird in DB gespeichert
5. **Supporter-Badge** wird vergeben
6. User wird zu `/donate/success` weitergeleitet

---

## 📊 Schritt 5: Zahlungen überprüfen

### Im Dashboard:

1. **Stripe Dashboard**: https://dashboard.stripe.com/test/payments
2. **DuneBot SuperAdmin**: `/guild/1403034310172475416/plugins/superadmin/donations`

### In der Datenbank:

```sql
SELECT * FROM donations ORDER BY created_at DESC LIMIT 10;
SELECT * FROM supporter_badges WHERE is_active = 1;
```

---

## 🔄 Schritt 6: Webhook testen

### Mit Stripe CLI (lokal):

```bash
# Stripe CLI installieren
brew install stripe/stripe-cli/stripe

# Einloggen
stripe login

# Webhook weiterleiten (für lokale Entwicklung)
stripe listen --forward-to localhost:3001/api/superadmin/stripe-webhook

# Test-Event senden
stripe trigger checkout.session.completed
```

### Mit Stripe Dashboard:

1. Gehe zu: **https://dashboard.stripe.com/test/webhooks**
2. Klicke auf deinen Webhook
3. Tab **"Test"** → **"Send test webhook"**
4. Wähle Event: `checkout.session.completed`
5. Klicke **"Send test webhook"**

---

## 🛡️ Schritt 7: Sicherheits-Checklist

- ✅ **SECRET_KEY** niemals im Frontend verwenden!
- ✅ **PUBLISHABLE_KEY** ist OK für Frontend
- ✅ **Webhook-Signatur** immer validieren
- ✅ **Test-Modus** für Entwicklung nutzen
- ✅ **Live-Keys** erst nach vollständiger Verifizierung
- ✅ `.env` in `.gitignore` (bereits erledigt)

---

## 🌐 Schritt 8: Live-Modus aktivieren

### Voraussetzungen:

1. **Business-Informationen** vollständig ausgefüllt
2. **Bank-Verbindung** hinterlegt
3. **Stripe-Verifizierung** abgeschlossen

### Live-Keys eintragen:

```bash
# In Production .env (apps/dashboard/.env)
STRIPE_SECRET_KEY=sk_live_...dein_live_key
STRIPE_PUBLISHABLE_KEY=pk_live_...dein_live_key
STRIPE_WEBHOOK_SECRET=whsec_...dein_live_webhook_secret
```

### Live-Webhook erstellen:

1. Gehe zu: **https://dashboard.stripe.com/webhooks** (LIVE-Modus!)
2. Wiederhole Schritt 3 mit Production-URL
3. URL: `https://bot.firenetworks.de/api/superadmin/stripe-webhook`

---

## 🐛 Troubleshooting

### Problem: "Nicht authentifiziert"
**Lösung**: Session-Struktur prüfen (`req.session.user.info.id`)

### Problem: Webhook wird nicht empfangen
**Lösung**: 
- Webhook-URL korrekt? (muss öffentlich erreichbar sein)
- Webhook-Secret in `.env`?
- Firewall/Reverse-Proxy erlaubt POST-Requests?

### Problem: Zahlung erfolgreich, aber keine DB-Einträge
**Lösung**:
- Webhook-Logs prüfen: `/logs/dashboard-*.log`
- Stripe-Logs prüfen: https://dashboard.stripe.com/test/logs
- DB-Schema korrekt? `donations` + `supporter_badges` Tabellen

### Problem: "Invalid API Key"
**Lösung**:
- Richtiger Test/Live-Modus?
- Key mit Leerzeichen kopiert?
- Dashboard neu gestartet nach `.env` Änderung?

---

## 📝 Badge-System

Das System vergibt automatisch Badges basierend auf Gesamtspenden:

| Badge | Betrag | Icon |
|-------|--------|------|
| **Bronze** | €5+ | 🥉 |
| **Silver** | €20+ | 🥈 |
| **Gold** | €50+ | 🥇 |
| **Platinum** | €100+ | 💎 |

Badges werden automatisch berechnet nach jeder Donation via `recalculateSupporterBadge()`.

---

## 🔗 Nützliche Links

- **Stripe Dashboard**: https://dashboard.stripe.com/
- **Stripe Docs**: https://stripe.com/docs
- **Test Cards**: https://stripe.com/docs/testing
- **Webhook Events**: https://stripe.com/docs/api/events
- **Checkout Docs**: https://stripe.com/docs/payments/checkout

---

## 📞 Support

Bei Fragen zum Stripe-Setup:
- **Discord**: DuneBot Support Server
- **Email**: support@firenetworks.de
- **Docs**: `/docs/stripe_integration_manual.md`

---

**Erstellt**: 2025-10-16  
**Version**: 1.0  
**Status**: ✅ Production Ready
