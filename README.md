# 🏋️ Gym Booker v3 — Peoples Fitness Bad Homburg

Automatische Kursbuchung mit echtem Browser (Playwright).

## Deploy auf Render.com

### 1. GitHub Repo erstellen & Code pushen

```bash
git init
git add .
git commit -m "init"
git remote add origin https://github.com/DEIN_USERNAME/gym-booker-v3.git
git push -u origin main
```

### 2. Render.com

1. Geh auf **render.com** → New → **Web Service**
2. Verbinde dein GitHub Repo
3. Render erkennt `render.yaml` automatisch
4. Klick **Deploy**

Der Build dauert ~5 Minuten (Playwright + Chromium werden installiert).

### 3. Fertig!

Öffne die Render URL, logge dich mit deinen Gym-Zugangsdaten ein, wähle Kurse aus dem live Stundenplan.

## Wie es funktioniert

- **Login**: Echter Chromium Browser loggt sich auf member.peoplesfitness.de ein
- **Stundenplan**: Lädt echte Kursdaten direkt von der API
- **Buchung**: Browser klickt den Buchen-Button automatisch
- **Cron**: Alle 5 Minuten prüft der Server ob ein Buchungsfenster offen ist
- **Datenbank**: SQLite speichert User und Buchungen persistent

## Umgebungsvariablen (automatisch gesetzt)

- `JWT_SECRET` — wird von Render automatisch generiert
- `DB_PATH` — Pfad zur SQLite Datenbank
