# Signaturschlüssel

`start-release.jks` ist der **Startschlüssel** (Alias `farty`, Passwort `pupsfloss2026`). Er liegt bewusst im
Repository, damit die CI ohne weitere Einrichtung sofort eine installierbare, signierte APK bauen kann und sich
die App über ihre Update-Funktion selbst aktualisieren kann (alle Builds tragen dieselbe Signatur).

Weil Schlüssel und Passwort öffentlich sind, kann man jederzeit auf einen **eigenen, geheimen** Schlüssel wechseln –
ohne dass installierte Apps neu installiert werden müssen (Schlüsselrotation, APK Signature Scheme v3, wie beim
medevac-sim). Dazu in GitHub unter **Settings → Environments → release** diese Secrets anlegen:

- `ANDROID_KEYSTORE_BASE64` – Keystore-Datei, base64-kodiert
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

Sobald sie vorhanden sind, signiert die CI jedes Release mit „Startschlüssel → eigener Schlüssel“.
Optional unter *Required reviewers* sich selbst eintragen: Dann muss jedes Release per Klick freigegeben werden.
